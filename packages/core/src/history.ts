import { z } from "zod";
import type { ActorSource, FrameDocument } from "./model.js";
import type { Actor, FrameOperation, SemanticOperation } from "./operations.js";
import { ActorSchema, SemanticOperationSchema } from "./operations.js";
import { FrameDocumentSchema } from "./schema.js";
import { RuntimeError } from "./errors.js";
import { semanticFrameHash } from "./canonical.js";
import { simulateFrameOperations } from "./simulate.js";
import type { ValidationContext } from "./validation.js";

export type HistoryKind =
  | "baseline"
  | "mutation"
  | "externalEdit"
  | "undo"
  | "redo"
  | "restore"
  | "recovery";

export type HistoryEntry = {
  id: string;
  transactionId: string;
  timestamp: string;
  scope: "project" | "frame";
  projectId: string;
  frameId?: string;
  previousRevision: number;
  revision: number;
  actor: Actor;
  kind: HistoryKind;
  label: string;
  operations: SemanticOperation[];
  inverseOperations: SemanticOperation[];
  beforeHash: string;
  afterHash: string;
  undoOf?: string;
  redoOf?: string;
  restoreTargetRevision?: number;
  baseline?: FrameDocument;
};

export const HistoryEntrySchema: z.ZodType<HistoryEntry> = z
  .object({
    id: z.string().uuid(),
    transactionId: z.string().uuid(),
    timestamp: z.string().datetime(),
    scope: z.enum(["project", "frame"]),
    projectId: z.string().uuid(),
    frameId: z.string().uuid().optional(),
    previousRevision: z.number().int().min(0),
    revision: z.number().int().min(0),
    actor: ActorSchema,
    kind: z.enum([
      "baseline",
      "mutation",
      "externalEdit",
      "undo",
      "redo",
      "restore",
      "recovery",
    ]),
    label: z.string().min(1),
    operations: z.array(SemanticOperationSchema),
    inverseOperations: z.array(SemanticOperationSchema),
    beforeHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    afterHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    undoOf: z.string().uuid().optional(),
    redoOf: z.string().uuid().optional(),
    restoreTargetRevision: z.number().int().min(0).optional(),
    baseline: FrameDocumentSchema.optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.scope === "frame" && !entry.frameId) {
      context.addIssue({
        code: "custom",
        message: "Frame history requires frameId.",
        path: ["frameId"],
      });
    }
    if (
      entry.scope === "frame" &&
      entry.kind === "baseline" &&
      !entry.baseline
    ) {
      context.addIssue({
        code: "custom",
        message: "Baseline entries require a complete frame.",
        path: ["baseline"],
      });
    }
  });

export const createBaselineEntry = async (input: {
  id: string;
  transactionId: string;
  projectId: string;
  frame: FrameDocument;
  timestamp: string;
  actor?: { source: ActorSource; id: string };
}): Promise<HistoryEntry> => {
  const hash = await semanticFrameHash(input.frame);
  return {
    id: input.id,
    transactionId: input.transactionId,
    timestamp: input.timestamp,
    scope: "frame",
    projectId: input.projectId,
    frameId: input.frame.id,
    previousRevision: 0,
    revision: 0,
    actor: input.actor ?? { source: "system", id: "runtime" },
    kind: "baseline",
    label: `Created “${input.frame.name}”`,
    operations: [],
    inverseOperations: [],
    beforeHash: hash,
    afterHash: hash,
    baseline: structuredClone(input.frame),
  };
};

const frameEntries = (
  entries: readonly HistoryEntry[],
  frameId: string,
): HistoryEntry[] =>
  entries
    .filter((entry) => entry.scope === "frame" && entry.frameId === frameId)
    .sort((left, right) => left.revision - right.revision);

export const findBaseline = (
  entries: readonly HistoryEntry[],
  frameId: string,
): HistoryEntry => {
  const baseline = frameEntries(entries, frameId).find(
    (entry) => entry.kind === "baseline" && entry.revision === 0,
  );
  if (!baseline?.baseline) {
    throw new RuntimeError(
      "HISTORY_RECOVERY_REQUIRED",
      `Frame ${frameId} has no valid revision-zero baseline.`,
      { frameId },
    );
  }
  return baseline;
};

export const reconstructRevision = async (
  entries: readonly HistoryEntry[],
  frameId: string,
  targetRevision: number,
  validation?: ValidationContext,
): Promise<FrameDocument> => {
  const baseline = findBaseline(entries, frameId);
  let frame = structuredClone(baseline.baseline!);
  if (targetRevision === 0) return frame;
  const candidates = frameEntries(entries, frameId).filter(
    (entry) => entry.revision > 0 && entry.revision <= targetRevision,
  );
  let expectedRevision = 1;
  for (const entry of candidates) {
    if (
      entry.revision !== expectedRevision ||
      entry.previousRevision !== expectedRevision - 1
    ) {
      throw new RuntimeError(
        "HISTORY_HASH_MISMATCH",
        `History is discontinuous at revision ${entry.revision}.`,
        { frameId, revision: entry.revision },
      );
    }
    const result = simulateFrameOperations(frame, entry.operations, {
      validation,
      nextRevision: entry.revision,
      now: entry.timestamp,
    });
    frame = result.frame;
    const hash = await semanticFrameHash(frame);
    if (hash !== entry.afterHash) {
      throw new RuntimeError(
        "HISTORY_HASH_MISMATCH",
        `History hash does not match revision ${entry.revision}.`,
        {
          frameId,
          revision: entry.revision,
          expected: entry.afterHash,
          actual: hash,
        },
      );
    }
    expectedRevision += 1;
  }
  if (frame.revision !== targetRevision) {
    throw new RuntimeError(
      "HISTORY_RECOVERY_REQUIRED",
      `Revision ${targetRevision} could not be reconstructed.`,
      { frameId, targetRevision },
    );
  }
  return frame;
};

export const reconstructRevisionBackward = async (
  current: FrameDocument,
  entries: readonly HistoryEntry[],
  targetRevision: number,
  validation?: ValidationContext,
): Promise<FrameDocument> => {
  if (targetRevision > current.revision) {
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Cannot restore a future revision.",
      { targetRevision, currentRevision: current.revision },
    );
  }
  let frame = structuredClone(current);
  const candidates = frameEntries(entries, current.id)
    .filter(
      (entry) =>
        entry.revision > targetRevision && entry.revision <= current.revision,
    )
    .sort((left, right) => right.revision - left.revision);
  for (const entry of candidates) {
    const result = simulateFrameOperations(frame, entry.inverseOperations, {
      validation,
      nextRevision: entry.previousRevision,
      now: entry.timestamp,
    });
    frame = result.frame;
    const hash = await semanticFrameHash(frame);
    if (hash !== entry.beforeHash) {
      throw new RuntimeError(
        "HISTORY_HASH_MISMATCH",
        `Inverse history hash does not match revision ${entry.previousRevision}.`,
        {
          frameId: current.id,
          revision: entry.previousRevision,
        },
      );
    }
  }
  if (frame.revision !== targetRevision) {
    return reconstructRevision(entries, current.id, targetRevision, validation);
  }
  return frame;
};

export const findUndoCandidate = (
  entries: readonly HistoryEntry[],
  frameId: string,
): HistoryEntry | undefined => {
  const ordered = frameEntries(entries, frameId);
  const undone = new Set<string>();
  for (const entry of ordered) {
    if (entry.kind === "undo" && entry.undoOf) undone.add(entry.undoOf);
    if (entry.kind === "redo" && entry.redoOf) undone.delete(entry.redoOf);
  }
  return [...ordered]
    .reverse()
    .find(
      (entry) =>
        ["mutation", "externalEdit", "restore"].includes(entry.kind) &&
        !undone.has(entry.transactionId),
    );
};

export const findRedoCandidate = (
  entries: readonly HistoryEntry[],
  frameId: string,
): HistoryEntry | undefined => {
  const ordered = frameEntries(entries, frameId);
  const last = ordered.at(-1);
  if (last?.kind !== "undo" || !last.undoOf) return undefined;
  return ordered.find((entry) => entry.transactionId === last.undoOf);
};

export const resolveHistoryDirective = (
  operation: Extract<FrameOperation, { kind: "undo" | "redo" }>,
  entries: readonly HistoryEntry[],
  frameId: string,
): {
  operations: SemanticOperation[];
  kind: "undo" | "redo";
  target: HistoryEntry;
} => {
  const target =
    operation.kind === "undo"
      ? findUndoCandidate(entries, frameId)
      : findRedoCandidate(entries, frameId);
  if (!target)
    throw new RuntimeError(
      "INVALID_OPERATION",
      `Nothing is available to ${operation.kind}.`,
    );
  return {
    operations:
      operation.kind === "undo" ? target.inverseOperations : target.operations,
    kind: operation.kind,
    target,
  };
};
