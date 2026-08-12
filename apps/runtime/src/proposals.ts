import type {
  TransactionProposalView,
  TransactionRequest,
  TransactionPreviewResult,
} from "@tva-agentic-design/core";

export const buildProposalView = (input: {
  request: TransactionRequest;
  result: TransactionPreviewResult;
}): TransactionProposalView => {
  const explanations = input.result.diff.length
    ? input.result.diff.map(
        (entry) =>
          `${entry.kind[0]!.toUpperCase()}${entry.kind.slice(1)} ${entry.path}`,
      )
    : [
        `Proposes ${input.request.operations.length} canonical operation${input.request.operations.length === 1 ? "" : "s"}.`,
      ];
  return {
    schemaVersion: 1,
    proposalId: input.result.previewId,
    previewId: input.result.previewId,
    state: "open",
    scope: input.request.scope,
    baseRevision: input.request.baseRevision,
    operationHash: input.result.operationHash,
    author: input.request.actor,
    operations: structuredClone(input.request.operations),
    explanations,
    diff: structuredClone(input.result.diff),
    warnings: structuredClone(input.result.warnings),
    affectedNodes: [...input.result.affectedNodes],
    expiresAt: input.result.expiresAt,
    ...(input.result.previewImageUrl
      ? { previewImageUrl: input.result.previewImageUrl }
      : {}),
  };
};
