import type { TransactionPreviewResult } from "@agentic-design/core";
import type { SaveState } from "./draft-controller";

export type ProposalReviewState = {
  preview?: TransactionPreviewResult;
  saveState: SaveState;
};

export type ProposalReviewChoice = "commit" | "discard";

export const openProposalReview = (
  preview: TransactionPreviewResult,
): ProposalReviewState => ({ preview, saveState: "preview" });

export const closeProposalReview = (
  preview: TransactionPreviewResult | undefined,
  choice: ProposalReviewChoice,
): ProposalReviewState & { previewIdToCommit?: string } => ({
  preview: undefined,
  saveState: "saved",
  previewIdToCommit:
    choice === "commit" && preview ? preview.previewId : undefined,
});
