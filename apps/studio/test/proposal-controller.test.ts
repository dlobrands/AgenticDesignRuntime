import { describe, expect, it } from "vitest";
import type { TransactionPreviewResult } from "@tva-agentic-design/core";
import {
  closeProposalReview,
  openProposalReview,
} from "../src/proposal-controller";

const preview = {
  previewId: "preview-1",
  mode: "preview",
  affectedNodes: [],
  warnings: [],
} as unknown as TransactionPreviewResult;

describe("proposal controller", () => {
  it("opens an inspectable preview without committing it", () => {
    expect(openProposalReview(preview)).toEqual({
      preview,
      saveState: "preview",
    });
  });

  it("returns a commit directive only after explicit approval", () => {
    expect(closeProposalReview(preview, "commit")).toEqual({
      preview: undefined,
      saveState: "saved",
      previewIdToCommit: "preview-1",
    });
    expect(closeProposalReview(preview, "discard")).toEqual({
      preview: undefined,
      saveState: "saved",
      previewIdToCommit: undefined,
    });
  });
});
