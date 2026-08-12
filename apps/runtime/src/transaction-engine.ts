import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  AssetManifestSchema,
  FontManifestSchema,
  HistoryEntrySchema,
  ProjectDocumentSchema,
  RuntimeError,
  TransactionRequestSchema,
  analyzeSemanticConflict,
  createProjectDocument,
  fullDocumentHash,
  listNodes,
  reconstructRevision,
  resolveHistoryDirective,
  semanticFrameHash,
  sha256,
  simulateFrameOperations,
  stableStringify,
  structuredDiff,
  validateFrame,
  validateFrameBrandBindings,
  type HistoryEntry,
  type FrameTransactionRequest,
  type FrameDocument,
  type SemanticOperation,
  type TransactionCommitResult,
  type TransactionPreviewResult,
  type TransactionRequest,
  type TextNode,
  type ValidationContext,
} from "@tva-agentic-design/core";
import type { RuntimeEventBus } from "./events.js";
import { ensureDirectory } from "./fs-safe.js";
import { persistJournaled } from "./journal.js";
import type { RuntimeLogger, RuntimeMetrics } from "./logger.js";
import {
  projectFileTargets,
  simulateProjectOperations,
} from "./project-operations.js";
import { KeyedQueue } from "./queue.js";
import type { ProjectState, WorkspaceState } from "./types.js";
import {
  requireFrame,
  requireProject,
  resolveRegisteredFile,
} from "./workspace.js";

type PreviewRecord = {
  id: string;
  request: TransactionRequest;
  operationHash: string;
  expiresAt: number;
  result: TransactionPreviewResult;
  frame?: FrameDocument;
};

const PREVIEW_TTL_MS = 5 * 60_000;

export const transactionMutationDomain = (
  scope: TransactionRequest["scope"],
): string =>
  scope.kind === "workspace" ? "workspace" : `project:${scope.projectId}`;

const projectStateHash = (
  project: Pick<ProjectState, "document" | "assets" | "fonts"> & {
    frames?: ReadonlyMap<string, FrameDocument>;
  },
): Promise<string> =>
  sha256(
    stableStringify({
      document: project.document,
      assets: project.assets,
      fonts: project.fonts,
      frames: project.frames
        ? [...project.frames.entries()].sort(([left], [right]) =>
            left.localeCompare(right),
          )
        : [],
    }),
  );

const historyPath = (project: ProjectState): string =>
  path.join(project.directory, "history", "operations.jsonl");

export class TransactionEngine {
  readonly workspace: WorkspaceState;
  readonly events: RuntimeEventBus;
  readonly logger: RuntimeLogger;
  readonly metrics: RuntimeMetrics;
  readonly #queues = new KeyedQueue();
  readonly #previews = new Map<string, PreviewRecord>();
  readonly #selfWrites = new Map<string, Map<string, number>>();
  #textMeasurer?: (
    projectId: string,
    nodes: readonly TextNode[],
  ) => Promise<
    Array<{ nodeId: string; width: number; height: number; lines: number }>
  >;

  constructor(input: {
    workspace: WorkspaceState;
    events: RuntimeEventBus;
    logger: RuntimeLogger;
    metrics: RuntimeMetrics;
  }) {
    this.workspace = input.workspace;
    this.events = input.events;
    this.logger = input.logger;
    this.metrics = input.metrics;
  }

  async execute(
    input: unknown,
  ): Promise<TransactionCommitResult | TransactionPreviewResult> {
    return this.#execute(input, false, false);
  }

  async commitVerifiedImport(input: {
    projectId: string;
    baseRevision: number;
    actor: TransactionRequest["actor"];
    operation: Extract<
      SemanticOperation,
      { kind: "importAsset" | "importFont" }
    >;
  }): Promise<TransactionCommitResult> {
    const result = await this.#execute(
      {
        schemaVersion: 1,
        mode: "commit",
        runtimeId: this.workspace.runtimeId,
        workspaceId: this.workspace.config.workspaceId,
        scope: { kind: "project", projectId: input.projectId },
        baseRevision: input.baseRevision,
        actor: input.actor,
        operations: [input.operation],
      },
      true,
      false,
    );
    if (!("status" in result) || result.status !== "committed")
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Verified imports must commit immediately.",
      );
    return result;
  }

  async executeVerifiedBrandPin(input: {
    projectId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: TransactionRequest["actor"];
    operations: SemanticOperation[];
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const result = await this.#execute(
      {
        schemaVersion: 1,
        mode: input.mode,
        runtimeId: this.workspace.runtimeId,
        workspaceId: this.workspace.config.workspaceId,
        scope: { kind: "project", projectId: input.projectId },
        baseRevision: input.baseRevision,
        actor: input.actor,
        operations: input.operations,
      },
      true,
      true,
    );
    return result;
  }

  async #execute(
    input: unknown,
    verifiedImport: boolean,
    verifiedBrandPin: boolean,
  ): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const started = performance.now();
    let request: TransactionRequest;
    try {
      request = TransactionRequestSchema.parse(input) as TransactionRequest;
      this.#assertRuntime(request);
      const importOperations = request.operations.filter(
        (
          operation,
        ): operation is Extract<
          SemanticOperation,
          { kind: "importAsset" | "importFont" }
        > =>
          operation.kind === "importAsset" || operation.kind === "importFont",
      );
      if (importOperations.length > 0 && !verifiedImport)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Asset and font manifests can only be registered by the verified runtime import boundary.",
        );
      const pinOperations = request.operations.filter(
        (operation) =>
          operation.kind === "pinBrandKit" ||
          operation.kind === "migrateBrandKit",
      );
      if (
        verifiedImport &&
        importOperations.length !== request.operations.length &&
        !(
          verifiedBrandPin &&
          pinOperations.length === 1 &&
          importOperations.length + 1 === request.operations.length
        )
      )
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Verified import commits cannot contain unrelated operations.",
        );
      let result: TransactionCommitResult | TransactionPreviewResult;
      if (request.scope.kind === "workspace") {
        result = await this.#queues.run(
          transactionMutationDomain(request.scope),
          () => this.#executeWorkspace(request),
        );
      } else {
        const projectId = request.scope.projectId;
        result = await this.#queues.run(
          transactionMutationDomain(request.scope),
          async () => {
            if (verifiedImport) {
              const project = requireProject(this.workspace, projectId);
              for (const operation of importOperations) {
                const record =
                  operation.kind === "importAsset"
                    ? operation.asset
                    : operation.font;
                await resolveRegisteredFile(
                  project,
                  record,
                  operation.kind === "importAsset" ? "asset" : "font",
                );
              }
            }
            return request.scope.kind === "project"
              ? this.#executeProject(request)
              : this.#executeFrame(request);
          },
        );
      }
      await this.metrics.update({
        lastTransactionDurationMs: performance.now() - started,
      });
      return result;
    } catch (error) {
      await this.metrics.increment("rejectionCount");
      const runtimeError =
        error instanceof RuntimeError
          ? error
          : new RuntimeError(
              "INVALID_OPERATION",
              error instanceof Error ? error.message : String(error),
            );
      this.events.emit("transaction.rejected", {
        code: runtimeError.code,
        message: runtimeError.message,
      });
      await this.logger.warn("transaction.rejected", {
        code: runtimeError.code,
        durationMs: performance.now() - started,
      });
      throw runtimeError;
    }
  }

  async commitPreview(previewId: string): Promise<TransactionCommitResult> {
    const preview = this.#previews.get(previewId);
    if (!preview || preview.expiresAt <= Date.now()) {
      this.#previews.delete(previewId);
      this.events.emit("operation.preview.expired", { previewId });
      throw new RuntimeError(
        "STALE_PREVIEW",
        "The preview has expired or does not exist.",
        { previewId },
        409,
      );
    }
    const currentHash = await this.#operationHash(preview.request);
    if (currentHash !== preview.operationHash) {
      throw new RuntimeError(
        "STALE_PREVIEW",
        "The preview operation hash no longer matches.",
        { previewId },
        409,
      );
    }
    this.#previews.delete(previewId);
    const result = await this.execute({ ...preview.request, mode: "commit" });
    if (!("status" in result) || result.status !== "committed")
      throw new RuntimeError(
        "STALE_PREVIEW",
        "Preview did not produce a commit.",
      );
    return result;
  }

  getPreviewFrame(previewId: string): {
    request: TransactionRequest;
    frame: FrameDocument;
    expiresAt: string;
  } {
    const preview = this.#previews.get(previewId);
    if (!preview || preview.expiresAt <= Date.now()) {
      this.#previews.delete(previewId);
      this.events.emit("operation.preview.expired", { previewId });
      throw new RuntimeError(
        "STALE_PREVIEW",
        "The preview has expired or does not exist.",
        { previewId },
        409,
      );
    }
    if (!preview.frame)
      throw new RuntimeError(
        "INVALID_OPERATION",
        "This preview does not contain a renderable frame.",
      );
    return {
      request: preview.request,
      frame: structuredClone(preview.frame),
      expiresAt: new Date(preview.expiresAt).toISOString(),
    };
  }

  getPreviewProposal(previewId: string): {
    request: TransactionRequest;
    result: TransactionPreviewResult;
  } {
    const preview = this.#previews.get(previewId);
    if (!preview || preview.expiresAt <= Date.now()) {
      this.#previews.delete(previewId);
      this.events.emit("operation.preview.expired", { previewId });
      throw new RuntimeError(
        "STALE_PREVIEW",
        "The preview has expired or does not exist.",
        { previewId },
        409,
      );
    }
    return {
      request: structuredClone(preview.request),
      result: structuredClone(preview.result),
    };
  }

  consumeSelfWrite(filePath: string, hash: string): boolean {
    const records = this.#selfWrites.get(filePath);
    if (!records) return false;
    const now = Date.now();
    for (const [candidate, expiresAt] of records)
      if (expiresAt < now) records.delete(candidate);
    const expiresAt = records.get(hash);
    if (expiresAt === undefined) {
      if (records.size === 0) this.#selfWrites.delete(filePath);
      return false;
    }
    records.delete(hash);
    if (records.size === 0) this.#selfWrites.delete(filePath);
    return true;
  }

  markSelfWrite(filePath: string, hash: string, ttlMs = 10_000): void {
    const records = this.#selfWrites.get(filePath) ?? new Map<string, number>();
    const now = Date.now();
    for (const [candidate, expiresAt] of records)
      if (expiresAt < now) records.delete(candidate);
    records.set(hash, now + ttlMs);
    this.#selfWrites.set(filePath, records);
  }

  clearSelfWrite(filePath: string, hash: string): void {
    const records = this.#selfWrites.get(filePath);
    if (!records) return;
    records.delete(hash);
    if (records.size === 0) this.#selfWrites.delete(filePath);
  }

  setTextMeasurer(
    measurer: (
      projectId: string,
      nodes: readonly TextNode[],
    ) => Promise<
      Array<{ nodeId: string; width: number; height: number; lines: number }>
    >,
  ): void {
    this.#textMeasurer = measurer;
  }

  async #executeWorkspace(
    request: TransactionRequest,
  ): Promise<TransactionCommitResult | TransactionPreviewResult> {
    if (
      request.operations.length !== 1 ||
      request.operations[0]?.kind !== "createProject"
    ) {
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Workspace transactions support exactly one createProject operation.",
      );
    }
    const operation = request.operations[0];
    if (this.workspace.projects.has(operation.projectId))
      throw new RuntimeError("INVALID_OPERATION", "Project ID already exists.");
    const now = new Date().toISOString();
    const document = createProjectDocument({
      id: operation.projectId,
      slug: operation.slug,
      name: operation.name,
      now,
    });
    ProjectDocumentSchema.parse(document);
    const assets = AssetManifestSchema.parse({ schemaVersion: 1, assets: [] });
    const fonts = FontManifestSchema.parse({ schemaVersion: 1, fonts: [] });
    const operationHash = await this.#operationHash(request);

    if (request.mode === "preview") {
      return this.#storePreview(
        request,
        operationHash,
        operation.projectId,
        undefined,
        0,
        structuredDiff(null, document),
        [],
      );
    }

    const directory = path.join(this.workspace.root, "projects", document.slug);
    if (
      await stat(directory)
        .then(() => true)
        .catch(() => false)
    ) {
      throw new RuntimeError(
        "INVALID_OPERATION",
        `Project slug ${document.slug} is already reserved.`,
      );
    }
    await Promise.all(
      ["frames", "assets", "fonts", "history", "exports"].map((name) =>
        ensureDirectory(path.join(directory, name)),
      ),
    );
    const transactionId = randomUUID();
    const beforeHash = await sha256("null");
    const afterHash = await projectStateHash({ document, assets, fonts });
    const entry: HistoryEntry = {
      id: randomUUID(),
      transactionId,
      timestamp: now,
      scope: "project",
      projectId: document.id,
      previousRevision: 0,
      revision: 0,
      actor: request.actor,
      kind: "baseline",
      label: `Created project “${document.name}”`,
      operations: [...request.operations],
      inverseOperations: [],
      beforeHash,
      afterHash,
    };
    HistoryEntrySchema.parse(entry);
    const persistenceStarted = performance.now();
    await persistJournaled({
      root: this.workspace.root,
      transactionId,
      scope: "workspace",
      previousRevision: 0,
      revision: 0,
      beforeHash,
      afterHash,
      targets: [
        { targetPath: path.join(directory, "project.json"), after: document },
        {
          targetPath: path.join(directory, "assets", "assets.json"),
          after: assets,
        },
        {
          targetPath: path.join(directory, "fonts", "fonts.json"),
          after: fonts,
        },
      ],
      historyPath: path.join(directory, "history", "operations.jsonl"),
      historyLines: [entry],
    });
    const state: ProjectState = {
      directory,
      document,
      frames: new Map(),
      assets,
      fonts,
      history: [entry],
      blockedFrames: new Map(),
      externalConflicts: new Map(),
    };
    this.workspace.projects.set(document.id, state);
    await this.metrics.update({
      commitCount: this.metrics.state.commitCount + 1,
      lastPersistenceDurationMs: performance.now() - persistenceStarted,
    });
    const result: TransactionCommitResult = {
      transactionId,
      projectId: document.id,
      previousRevision: 0,
      revision: 0,
      status: "committed",
      actor: request.actor,
      ...(request.actor.sessionId
        ? { originSessionId: request.actor.sessionId }
        : {}),
      affectedNodes: [],
      warnings: [],
      historyEntryId: entry.id,
      stateHash: afterHash,
    };
    this.events.emit("transaction.committed", result);
    return result;
  }

  async #executeProject(
    request: TransactionRequest,
  ): Promise<TransactionCommitResult | TransactionPreviewResult> {
    if (request.scope.kind !== "project")
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Expected a project transaction.",
      );
    const project = requireProject(this.workspace, request.scope.projectId);
    if (request.baseRevision !== project.document.revision) {
      await this.metrics.increment("revisionConflicts");
      throw new RuntimeError(
        "STALE_REVISION",
        `Expected project revision ${project.document.revision}, received ${request.baseRevision}.`,
        {
          expected: project.document.revision,
          received: request.baseRevision,
        },
        409,
      );
    }
    const now = new Date().toISOString();
    let operations: SemanticOperation[] = [...request.operations];
    let historyKind: HistoryEntry["kind"] = "mutation";
    let undoOf: string | undefined;
    let redoOf: string | undefined;
    let forcedLabel: string | undefined;
    const directive = operations[0];
    if (
      (directive?.kind === "undo" || directive?.kind === "redo") &&
      operations.length === 1
    ) {
      const entries = project.history
        .filter((entry) => entry.scope === "project")
        .sort((left, right) => left.revision - right.revision);
      if (directive.kind === "undo") {
        const undone = new Set(
          entries
            .filter((entry) => entry.kind === "undo" && entry.undoOf)
            .map((entry) => entry.undoOf!),
        );
        for (const entry of entries.filter(
          (candidate) => candidate.kind === "redo" && candidate.redoOf,
        ))
          undone.delete(entry.redoOf!);
        const target = [...entries]
          .reverse()
          .find(
            (entry) =>
              entry.kind === "mutation" && !undone.has(entry.transactionId),
          );
        if (!target)
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Nothing is available to undo at project scope.",
          );
        operations = target.inverseOperations;
        historyKind = "undo";
        undoOf = target.transactionId;
        forcedLabel = `Undid ${target.label}`;
      } else {
        const last = entries.at(-1);
        const target =
          last?.kind === "undo" && last.undoOf
            ? entries.find((entry) => entry.transactionId === last.undoOf)
            : undefined;
        if (!target)
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Project redo is available only immediately after undo.",
          );
        operations = target.operations;
        historyKind = "redo";
        redoOf = target.transactionId;
        forcedLabel = `Redid ${target.label}`;
      }
    } else if (
      operations.some(
        (operation) =>
          operation.kind === "undo" ||
          operation.kind === "redo" ||
          operation.kind === "restoreRevision",
      )
    ) {
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Project history directives cannot be batched or restore a frame revision.",
      );
    }
    const simulation = await simulateProjectOperations({
      project,
      operations,
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
      brandKits: [...this.workspace.brandKits.values()].flat(),
    });
    for (const frame of simulation.frames.values()) {
      const pin = simulation.document.brandKitPin;
      const kit = pin
        ? this.workspace.brandKits
            .get(pin.kitId)
            ?.find((candidate) => candidate.revision === pin.revision)
        : undefined;
      validateFrameBrandBindings({
        frame,
        ...(pin ? { pin } : {}),
        ...(kit ? { kit } : {}),
      });
    }
    const beforeHash = await projectStateHash(project);
    const afterHash = await projectStateHash(simulation);
    const operationHash = await this.#operationHash(request);
    if (request.mode === "preview") {
      const diff = structuredDiff(project.document, simulation.document);
      for (const frameId of simulation.changedFrameIds) {
        const before = project.frames.get(frameId);
        const after = simulation.frames.get(frameId);
        if (before && after)
          diff.push(...structuredDiff(before, after, `/frames/${frameId}`));
      }
      return this.#storePreview(
        request,
        operationHash,
        project.document.id,
        undefined,
        project.document.revision,
        diff,
        [],
      );
    }

    const transactionId = randomUUID();
    const entry: HistoryEntry = {
      id: randomUUID(),
      transactionId,
      timestamp: now,
      scope: "project",
      projectId: project.document.id,
      previousRevision: project.document.revision,
      revision: simulation.document.revision,
      actor: request.actor,
      kind: historyKind,
      label: forcedLabel ?? simulation.label,
      operations,
      inverseOperations: simulation.inverseOperations,
      beforeHash,
      afterHash,
      ...(undoOf ? { undoOf } : {}),
      ...(redoOf ? { redoOf } : {}),
    };
    HistoryEntrySchema.parse(entry);
    const targets = projectFileTargets(project, simulation);
    const targetHashes = new Map(
      await Promise.all(
        targets.map(
          async (target) =>
            [target.targetPath, await fullDocumentHash(target.after)] as const,
        ),
      ),
    );
    const persistenceStarted = performance.now();
    try {
      await persistJournaled({
        root: this.workspace.root,
        transactionId,
        scope: "project",
        previousRevision: project.document.revision,
        revision: simulation.document.revision,
        beforeHash,
        afterHash,
        targets,
        historyPath: historyPath(project),
        historyLines: [entry, ...simulation.baselineEntries],
        onPhase: (phase) => {
          if (phase !== "temporary-written") return;
          for (const [targetPath, hash] of targetHashes)
            this.markSelfWrite(targetPath, hash);
        },
      });
    } catch (error) {
      for (const [targetPath, hash] of targetHashes)
        this.clearSelfWrite(targetPath, hash);
      throw error;
    }
    project.document = simulation.document;
    project.frames = simulation.frames;
    project.assets = simulation.assets;
    project.fonts = simulation.fonts;
    project.history.push(entry, ...simulation.baselineEntries);
    await this.metrics.update({
      commitCount: this.metrics.state.commitCount + 1,
      lastPersistenceDurationMs: performance.now() - persistenceStarted,
    });
    const result: TransactionCommitResult = {
      transactionId,
      projectId: project.document.id,
      previousRevision: entry.previousRevision,
      revision: entry.revision,
      status: "committed",
      actor: request.actor,
      ...(request.actor.sessionId
        ? { originSessionId: request.actor.sessionId }
        : {}),
      affectedNodes: [],
      warnings: [],
      historyEntryId: entry.id,
      stateHash: afterHash,
    };
    this.events.emit("transaction.committed", result);
    return result;
  }

  async #executeFrame(
    request: TransactionRequest,
  ): Promise<TransactionCommitResult | TransactionPreviewResult> {
    if (request.scope.kind !== "frame")
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Expected a frame transaction.",
      );
    const frameRequest = request as FrameTransactionRequest;
    const project = requireProject(
      this.workspace,
      frameRequest.scope.projectId,
    );
    const current = requireFrame(project, frameRequest.scope.frameId);
    const validation = {
      assets: project.assets.assets,
      fonts: project.fonts.fonts,
      capabilities: this.workspace.capabilities,
    };
    if (frameRequest.baseRevision !== current.revision) {
      await this.metrics.increment("revisionConflicts");
      const hasHistoryDirective = frameRequest.operations.some((operation) =>
        ["undo", "redo", "restoreRevision"].includes(operation.kind),
      );
      if (
        hasHistoryDirective ||
        frameRequest.baseRevision < 0 ||
        frameRequest.baseRevision > current.revision
      )
        throw new RuntimeError(
          "STALE_REVISION",
          `Expected frame revision ${current.revision}, received ${frameRequest.baseRevision}.`,
          {
            expected: current.revision,
            received: frameRequest.baseRevision,
          },
          409,
        );
      const base = await reconstructRevision(
        project.history,
        current.id,
        frameRequest.baseRevision,
        validation,
      );
      const intended = (
        await this.#simulateFrameWithText(
          project,
          base,
          [...frameRequest.operations],
          validation,
        )
      ).simulation.frame;
      const analysis = analyzeSemanticConflict(base, current, intended);
      if (analysis.conflictingProperties.length > 0)
        throw new RuntimeError(
          "SEMANTIC_CONFLICT",
          "The intended change overlaps canonical changes made after its base revision.",
          {
            baseRevision: frameRequest.baseRevision,
            currentRevision: current.revision,
            affectedNodeIds: analysis.affectedNodeIds,
            affectedProperties: analysis.conflictingProperties,
            intendedChanges: analysis.intendedChanges,
            interveningChanges: analysis.interveningChanges,
          },
          409,
        );
      const rebased = await this.#executeFrame({
        ...frameRequest,
        mode: "preview",
        baseRevision: current.revision,
      });
      if ("status" in rebased)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "A safe rebase must produce a reviewed preview.",
        );
      rebased.rebase = {
        fromRevision: frameRequest.baseRevision,
        toRevision: current.revision,
        intendedChanges: analysis.intendedChanges,
        interveningChanges: analysis.interveningChanges,
      };
      this.events.emit("operation.rebased", {
        previewId: rebased.previewId,
        projectId: project.document.id,
        frameId: current.id,
        ...rebased.rebase,
      });
      return rebased;
    }

    let operations: SemanticOperation[] = [...request.operations];
    let historyKind: HistoryEntry["kind"] =
      request.actor.source === "filesystem" ? "externalEdit" : "mutation";
    let undoOf: string | undefined;
    let redoOf: string | undefined;
    let restoreTargetRevision: number | undefined;
    let forcedLabel: string | undefined;
    const directive = request.operations.find((operation) =>
      ["undo", "redo", "restoreRevision"].includes(operation.kind),
    );
    if (directive) {
      if (request.operations.length !== 1)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "History directives cannot be batched with other operations.",
        );
      if (directive.kind === "undo" || directive.kind === "redo") {
        const resolved = resolveHistoryDirective(
          directive,
          project.history,
          current.id,
        );
        operations = resolved.operations;
        historyKind = resolved.kind;
        if (resolved.kind === "undo") undoOf = resolved.target.transactionId;
        else redoOf = resolved.target.transactionId;
        forcedLabel =
          resolved.kind === "undo"
            ? `Undid ${resolved.target.label}`
            : `Redid ${resolved.target.label}`;
      } else if (directive.kind === "restoreRevision") {
        if (directive.revision >= current.revision)
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Restore target must be an earlier revision.",
          );
        const entries = project.history
          .filter(
            (entry) =>
              entry.scope === "frame" &&
              entry.frameId === current.id &&
              entry.revision > directive.revision &&
              entry.revision <= current.revision,
          )
          .sort((left, right) => right.revision - left.revision);
        operations = entries.flatMap((entry) => entry.inverseOperations);
        historyKind = "restore";
        restoreTargetRevision = directive.revision;
        forcedLabel = `Restored revision ${directive.revision}`;
      }
    }
    if (operations.length === 0)
      throw new RuntimeError(
        "INVALID_OPERATION",
        "The transaction does not change frame state.",
      );

    const now = new Date().toISOString();
    const prepared = await this.#simulateFrameWithText(
      project,
      current,
      operations,
      validation,
      now,
    );
    operations = prepared.operations;
    const simulation = prepared.simulation;
    const pin = project.document.brandKitPin;
    const kit = pin
      ? this.workspace.brandKits
          .get(pin.kitId)
          ?.find((candidate) => candidate.revision === pin.revision)
      : undefined;
    validateFrameBrandBindings({
      frame: simulation.frame,
      ...(pin ? { pin } : {}),
      ...(kit ? { kit } : {}),
    });
    const report = validateFrame(simulation.frame, validation);
    if (!report.valid) {
      await this.metrics.increment("validationFailures");
      throw new RuntimeError(report.errors[0]!.code, report.errors[0]!.message);
    }
    const beforeHash = await semanticFrameHash(current);
    const afterHash = await semanticFrameHash(simulation.frame);
    const operationHash = await this.#operationHash(request);
    if (request.mode === "preview") {
      return this.#storePreview(
        request,
        operationHash,
        project.document.id,
        current.id,
        current.revision,
        structuredDiff(current, simulation.frame),
        simulation.affectedNodes,
        report.warnings,
        simulation.frame,
      );
    }

    const transactionId = randomUUID();
    const entry: HistoryEntry = {
      id: randomUUID(),
      transactionId,
      timestamp: now,
      scope: "frame",
      projectId: project.document.id,
      frameId: current.id,
      previousRevision: current.revision,
      revision: simulation.frame.revision,
      actor: request.actor,
      kind: historyKind,
      label: forcedLabel ?? simulation.label,
      operations,
      inverseOperations: simulation.inverseOperations,
      beforeHash,
      afterHash,
      ...(undoOf ? { undoOf } : {}),
      ...(redoOf ? { redoOf } : {}),
      ...(restoreTargetRevision !== undefined ? { restoreTargetRevision } : {}),
    };
    HistoryEntrySchema.parse(entry);
    const reference = project.document.frames.find(
      (frame) => frame.id === current.id,
    );
    if (!reference)
      throw new RuntimeError(
        "FRAME_FILE_INVALID",
        "Frame is no longer active in the project.",
      );
    const framePath = path.join(project.directory, reference.path);
    const frameHash = await fullDocumentHash(simulation.frame);
    const persistenceStarted = performance.now();
    try {
      await persistJournaled({
        root: this.workspace.root,
        transactionId,
        scope: "frame",
        previousRevision: current.revision,
        revision: simulation.frame.revision,
        beforeHash,
        afterHash,
        targets: [{ targetPath: framePath, after: simulation.frame }],
        historyPath: historyPath(project),
        historyLines: [entry],
        onPhase: (phase) => {
          if (phase === "temporary-written")
            this.markSelfWrite(framePath, frameHash);
        },
      });
    } catch (error) {
      this.clearSelfWrite(framePath, frameHash);
      throw error;
    }
    project.frames.set(current.id, simulation.frame);
    project.history.push(entry);
    await this.metrics.update({
      commitCount: this.metrics.state.commitCount + 1,
      lastPersistenceDurationMs: performance.now() - persistenceStarted,
    });
    const result: TransactionCommitResult = {
      transactionId,
      projectId: project.document.id,
      frameId: current.id,
      previousRevision: current.revision,
      revision: simulation.frame.revision,
      status: "committed",
      actor: request.actor,
      ...(request.actor.sessionId
        ? { originSessionId: request.actor.sessionId }
        : {}),
      affectedNodes: simulation.affectedNodes,
      warnings: report.warnings,
      historyEntryId: entry.id,
      stateHash: afterHash,
    };
    this.events.emit("transaction.committed", result);
    this.events.emit("frame.validation.changed", {
      projectId: project.document.id,
      frameId: current.id,
      report,
    });
    await this.logger.info("transaction.committed", {
      transactionId,
      projectId: project.document.id,
      frameId: current.id,
      revision: simulation.frame.revision,
      operationCount: operations.length,
    });
    return result;
  }

  async #simulateFrameWithText(
    project: ProjectState,
    source: FrameDocument,
    requestedOperations: SemanticOperation[],
    validation: ValidationContext,
    now?: string,
  ) {
    let operations = requestedOperations;
    let simulation = simulateFrameOperations(source, operations, {
      validation,
      nextRevision: source.revision + 1,
      ...(now ? { now } : {}),
    });
    const autoTextNodes = listNodes(simulation.frame)
      .filter(
        (node): node is TextNode =>
          node.type === "text" && node.textBox.mode !== "fixed",
      )
      .map((node) =>
        node.textBox.mode === "autoWidth"
          ? { ...node, textBox: { ...node.textBox, wrapping: "none" as const } }
          : node,
      );
    if (autoTextNodes.length === 0 || !this.#textMeasurer)
      return { operations, simulation };
    const measurements = await this.#textMeasurer(
      project.document.id,
      autoTextNodes,
    );
    const byId = new Map(
      measurements.map((measurement) => [measurement.nodeId, measurement]),
    );
    const sizingOperations: SemanticOperation[] = [];
    for (const node of autoTextNodes) {
      const measurement = byId.get(node.id);
      if (!measurement)
        throw new RuntimeError(
          "EXPORT_FAILED",
          `Pinned Chromium did not measure text node ${node.id}.`,
        );
      const value: Partial<TextNode["transform"]> = {};
      if (node.textBox.mode === "autoWidth") {
        const width = Math.max(1, Math.ceil(measurement.width));
        if (Math.abs(width - node.transform.width) > 0.01) value.width = width;
      }
      const height = Math.max(1, Math.ceil(measurement.height));
      if (Math.abs(height - node.transform.height) > 0.01)
        value.height = height;
      if (Object.keys(value).length > 0)
        sizingOperations.push({
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "transform",
          value,
        });
    }
    if (sizingOperations.length > 0) {
      operations = [...operations, ...sizingOperations];
      simulation = simulateFrameOperations(source, operations, {
        validation,
        nextRevision: source.revision + 1,
        ...(now ? { now } : {}),
      });
    }
    return { operations, simulation };
  }

  #assertRuntime(request: TransactionRequest): void {
    if (request.runtimeId !== this.workspace.runtimeId) {
      throw new RuntimeError(
        "INVALID_RUNTIME_CAPABILITY",
        "Runtime ID does not match the active process.",
        undefined,
        401,
      );
    }
    if (request.workspaceId !== this.workspace.config.workspaceId) {
      throw new RuntimeError(
        "WORKSPACE_MISMATCH",
        "Workspace ID does not match the active workspace.",
        undefined,
        409,
      );
    }
  }

  async #operationHash(request: TransactionRequest): Promise<string> {
    return sha256(
      stableStringify({
        workspaceId: request.workspaceId,
        scope: request.scope,
        baseRevision: request.baseRevision,
        operations: request.operations,
      }),
    );
  }

  #storePreview(
    request: TransactionRequest,
    operationHash: string,
    projectId: string,
    frameId: string | undefined,
    baseRevision: number,
    diff: ReturnType<typeof structuredDiff>,
    affectedNodes: string[],
    warnings: Array<{ code: string; message: string; nodeIds?: string[] }> = [],
    frame?: FrameDocument,
  ): TransactionPreviewResult {
    const previewId = randomUUID();
    const expiresAt = Date.now() + PREVIEW_TTL_MS;
    const result: TransactionPreviewResult = {
      previewId,
      workspaceId: request.workspaceId,
      projectId,
      ...(frameId ? { frameId } : {}),
      baseRevision,
      operationHash,
      diff,
      warnings,
      affectedNodes,
      ...(request.actor.sessionId
        ? { originSessionId: request.actor.sessionId }
        : {}),
      expiresAt: new Date(expiresAt).toISOString(),
      ...(request.renderPreview && frame
        ? { previewImageUrl: `/api/previews/${previewId}/render` }
        : {}),
    };
    this.#previews.set(previewId, {
      id: previewId,
      request,
      operationHash,
      expiresAt,
      result: structuredClone(result),
      ...(frame ? { frame: structuredClone(frame) } : {}),
    });
    void this.metrics.update({
      previewCount: this.metrics.state.previewCount + 1,
    });
    this.events.emit("operation.previewed", result);
    return result;
  }
}
