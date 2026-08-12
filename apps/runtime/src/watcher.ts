import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import {
  FrameDocumentSchema,
  RuntimeError,
  asRuntimeError,
  fullDocumentHash,
  semanticFrameHash,
  stableStringify,
  structuredDiff,
} from "@tva-agentic-design/core";
import { deriveExternalOperations } from "./external-diff.js";
import { writeFileAtomic } from "./fs-safe.js";
import type { TransactionEngine } from "./transaction-engine.js";
import type { ProjectState, WorkspaceState } from "./types.js";

const locateFrame = (
  workspace: WorkspaceState,
  targetPath: string,
): { project: ProjectState; frameId: string } | undefined => {
  for (const project of workspace.projects.values()) {
    for (const reference of project.document.frames) {
      if (
        path.resolve(project.directory, reference.path) ===
        path.resolve(targetPath)
      )
        return { project, frameId: reference.id };
    }
  }
  return undefined;
};

export class WorkspaceWatcher {
  readonly workspace: WorkspaceState;
  readonly engine: TransactionEngine;
  #watcher?: FSWatcher;

  constructor(workspace: WorkspaceState, engine: TransactionEngine) {
    this.workspace = workspace;
    this.engine = engine;
  }

  async start(): Promise<void> {
    if (this.#watcher) return;
    this.#watcher = watch(path.join(this.workspace.root, "projects"), {
      ignoreInitial: true,
      depth: 3,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
      ignored: [/(^|[/\\])\../, /\.tmp$/, /\.sw[px]$/, /~$/],
    });
    this.#watcher.on("change", (filePath) => {
      void this.#handleFrameChange(filePath);
    });
    this.#watcher.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.engine.events.emit("diagnostics.warning", {
        code: "WATCHER_ERROR",
        message,
      });
      void this.engine.logger.warn("watcher.error", { message });
    });
    await new Promise<void>((resolve) => this.#watcher!.once("ready", resolve));
  }

  async close(): Promise<void> {
    await this.#watcher?.close();
    this.#watcher = undefined;
  }

  async #handleFrameChange(filePath: string): Promise<void> {
    const located = locateFrame(this.workspace, filePath);
    if (!located) return;
    const current = located.project.frames.get(located.frameId);
    if (!current) return;
    const started = performance.now();
    let raw = "";
    let proposal: unknown;
    try {
      raw = await readFile(filePath, "utf8");
      proposal = JSON.parse(raw);
      const parsed = FrameDocumentSchema.parse(proposal);
      const fileHash = await fullDocumentHash(parsed);
      if (this.engine.consumeSelfWrite(filePath, fileHash)) return;
      if (
        (await semanticFrameHash(parsed)) === (await semanticFrameHash(current))
      ) {
        await this.#restoreCanonical(filePath, current);
        return;
      }
      const operations = deriveExternalOperations(current, parsed);
      await this.engine.execute({
        schemaVersion: 1,
        mode: "commit",
        runtimeId: this.workspace.runtimeId,
        workspaceId: this.workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: located.project.document.id,
          frameId: current.id,
        },
        baseRevision: parsed.revision,
        actor: { source: "filesystem", id: "external-frame-edit" },
        operations,
      });
      located.project.externalConflicts.delete(current.id);
      await this.engine.metrics.update({
        lastExternalReloadDurationMs: performance.now() - started,
      });
    } catch (error) {
      const runtimeError =
        error instanceof RuntimeError ? error : asRuntimeError(error);
      const recoveryPath = path.join(
        this.workspace.root,
        ".design-runtime",
        "recovery",
        `${located.project.document.slug}-${current.slug}-${Date.now()}-${randomUUID()}.rejected.json`,
      );
      await writeFileAtomic(
        recoveryPath,
        raw || stableStringify(proposal ?? null, true),
      );
      await this.#restoreCanonical(filePath, current);
      const payload = {
        projectId: located.project.document.id,
        frameId: current.id,
        code:
          runtimeError.code === "INVALID_OPERATION"
            ? "EXTERNAL_EDIT_NOT_REPRESENTABLE"
            : runtimeError.code,
        message: runtimeError.message,
        recoveryPath: path.relative(this.workspace.root, recoveryPath),
        diff:
          proposal && typeof proposal === "object"
            ? structuredDiff(current, proposal)
            : [],
        timestamp: new Date().toISOString(),
      };
      located.project.externalConflicts.set(current.id, payload);
      this.engine.events.emit("frame.external-edit.rejected", payload);
      await this.engine.logger.warn("frame.external-edit.rejected", {
        ...payload,
        diff: undefined,
      });
    }
  }

  async #restoreCanonical(
    filePath: string,
    frame: typeof FrameDocumentSchema._output,
  ): Promise<void> {
    const hash = await fullDocumentHash(frame);
    this.engine.markSelfWrite(filePath, hash);
    await writeFileAtomic(filePath, stableStringify(frame, true));
  }
}
