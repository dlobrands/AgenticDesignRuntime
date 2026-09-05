import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  createTransform,
  type TransactionRequest,
} from "@tva-agentic-design/core";
import { openWorkspace, closeWorkspace } from "./workspace.js";
import { RuntimeLogger, RuntimeMetrics } from "./logger.js";
import { RuntimeEventBus } from "./events.js";
import { TransactionEngine } from "./transaction-engine.js";
import { startRuntimeServer } from "./server.js";
import { allocateLoopbackPort } from "./lifecycle.js";

// Runs only in a disposable workspace. Uses the production transaction and renderer paths.
export async function runtimeHealth(studioDirectory: string) {
  const root = await mkdtemp(path.join(tmpdir(), "adr-health-"));
  let workspace: Awaited<ReturnType<typeof openWorkspace>> | undefined;
  let server: Awaited<ReturnType<typeof startRuntimeServer>> | undefined;
  try {
    workspace = await openWorkspace(root, {
      descriptorDirectory: path.join(root, "descriptors"),
    });
    workspace.config.server.port = await allocateLoopbackPort();
    const logger = new RuntimeLogger({
      directory: path.join(root, ".design-runtime", "logs"),
      ...workspace.config.logging,
    });
    const metrics = new RuntimeMetrics(
      path.join(root, ".design-runtime", "metrics"),
      workspace.startedAt,
    );
    const engine = new TransactionEngine({
      workspace,
      logger,
      metrics,
      events: new RuntimeEventBus(workspace),
    });
    const commit = async (
      scope: TransactionRequest["scope"],
      baseRevision: number | null,
      operations: TransactionRequest["operations"],
    ) => {
      const result = await engine.execute({
        schemaVersion: 1,
        mode: "preview",
        runtimeId: workspace!.runtimeId,
        workspaceId: workspace!.config.workspaceId,
        scope,
        baseRevision,
        actor: { source: "system", id: "health" },
        operations,
      });
      if (!("previewId" in result))
        throw new Error("Health transaction did not produce a preview.");
      await engine.commitPreview(result.previewId);
    };
    const projectId = randomUUID();
    const frameId = randomUUID();
    await commit({ kind: "workspace" }, null, [
      { kind: "createProject", projectId, slug: "health", name: "Health" },
    ]);
    await commit({ kind: "project", projectId }, 0, [
      {
        kind: "createFrame",
        frameId,
        slug: "health",
        name: "Health",
        width: 32,
        height: 32,
      },
    ]);
    const project = workspace.projects.get(projectId)!;
    const frame = project.frames.get(frameId)!;
    await commit({ kind: "frame", projectId, frameId }, frame.revision, [
      {
        kind: "createNode",
        parentId: frame.root.id,
        node: {
          id: randomUUID(),
          type: "rectangle",
          name: "Health signal",
          visible: true,
          locked: false,
          transform: createTransform({ x: 0, y: 0, width: 32, height: 32 }),
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#315CF5", opacity: 1 },
          cornerRadius: {
            topLeft: 0,
            topRight: 0,
            bottomLeft: 0,
            bottomRight: 0,
          },
        },
      },
    ]);
    server = await startRuntimeServer({ workspace, engine, studioDirectory });
    const rendered = await server.exportWorker.render(
      project,
      project.frames.get(frameId)!,
    );
    const { data, info } = await sharp(rendered.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const center = (16 * info.width + 16) * 4;
    if (
      info.width !== 32 ||
      info.height !== 32 ||
      Math.abs(data[center]! - 49) > 2 ||
      Math.abs(data[center + 1]! - 92) > 2 ||
      Math.abs(data[center + 2]! - 245) > 2 ||
      data[center + 3] !== 255
    )
      throw new Error(
        "Runtime health render did not match the expected pixels.",
      );
    return {
      status: "healthy",
      renderVerified: true,
      versions: rendered.versions,
    };
  } finally {
    await server?.close();
    if (workspace) await closeWorkspace(workspace);
    await rm(root, { recursive: true, force: true });
  }
}
