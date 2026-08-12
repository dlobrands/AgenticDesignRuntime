import type { DesignRuntimeApiError } from "@tva-agentic-design/client";
import type {
  FrameOperation,
  SemanticChange,
  TransactionPreviewResult,
} from "@tva-agentic-design/core";

export type ConflictState = {
  kind: "safe-rebase" | "overlap" | "stale-directive";
  message: string;
  operations: FrameOperation[];
  canonicalRevision: number;
  baseRevision: number;
  affectedNodeIds: string[];
  affectedProperties: string[];
  intendedChanges: SemanticChange[];
  interveningChanges: SemanticChange[];
  previewId?: string;
};

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (candidate): candidate is string => typeof candidate === "string",
      )
    : [];

const changes = (value: unknown): SemanticChange[] =>
  Array.isArray(value)
    ? value.filter((candidate): candidate is SemanticChange =>
        Boolean(
          candidate &&
          typeof candidate === "object" &&
          "property" in candidate &&
          typeof candidate.property === "string",
        ),
      )
    : [];

export const safeRebaseConflict = (
  preview: TransactionPreviewResult,
  operations: FrameOperation[],
  fallbackBaseRevision: number,
  canonicalRevision: number,
): ConflictState => ({
  kind: "safe-rebase",
  message:
    "Canonical changes are disjoint from your intended properties. The runtime created a new preview and did not commit it.",
  operations,
  baseRevision: preview.rebase?.fromRevision ?? fallbackBaseRevision,
  canonicalRevision,
  affectedNodeIds: preview.affectedNodes,
  affectedProperties:
    preview.rebase?.intendedChanges.map((change) => change.property) ?? [],
  intendedChanges: preview.rebase?.intendedChanges ?? [],
  interveningChanges: preview.rebase?.interveningChanges ?? [],
  previewId: preview.previewId,
});

export const semanticConflictFromError = (
  error: DesignRuntimeApiError,
  operations: FrameOperation[],
  baseRevision: number,
  canonicalRevision: number,
): ConflictState | undefined => {
  if (error.code !== "SEMANTIC_CONFLICT" && error.code !== "STALE_REVISION")
    return undefined;
  const details = error.details ?? {};
  return {
    kind: error.code === "SEMANTIC_CONFLICT" ? "overlap" : "stale-directive",
    message: error.message,
    operations,
    baseRevision,
    canonicalRevision,
    affectedNodeIds: strings(details.affectedNodeIds),
    affectedProperties: strings(details.affectedProperties),
    intendedChanges: changes(details.intendedChanges),
    interveningChanges: changes(details.interveningChanges),
  };
};
