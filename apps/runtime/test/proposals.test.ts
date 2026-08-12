import { describe, expect, it } from "vitest";
import type {
  FrameTransactionRequest,
  TransactionPreviewResult,
} from "@agentic-design/core";
import { buildProposalView } from "../src/proposals";

const previewId = "00000000-0000-4000-8000-000000000101";
const nodeId = "00000000-0000-4000-8000-000000000102";

describe("canonical preview proposal view", () => {
  it("retains exact identity, provenance, operations, and diff without sharing mutable state", () => {
    const request: FrameTransactionRequest = {
      schemaVersion: 1,
      runtimeId: "00000000-0000-4000-8000-000000000103",
      workspaceId: "00000000-0000-4000-8000-000000000104",
      mode: "preview",
      scope: {
        kind: "frame",
        projectId: "00000000-0000-4000-8000-000000000105",
        frameId: "00000000-0000-4000-8000-000000000106",
      },
      baseRevision: 7,
      actor: { source: "mcp", id: "proposal-agent" },
      operations: [
        {
          kind: "updateNode",
          nodeId,
          propertyGroup: "transform",
          value: { x: 120 },
        },
      ],
    };
    const result: TransactionPreviewResult = {
      workspaceId: request.workspaceId,
      projectId: request.scope.projectId,
      frameId: request.scope.frameId,
      baseRevision: 7,
      previewId,
      operationHash: "operation-hash",
      diff: [
        {
          kind: "changed",
          path: "/root/children/0/transform/x",
          before: 40,
          after: 120,
        },
      ],
      warnings: [],
      affectedNodes: [nodeId],
      expiresAt: "2026-08-10T16:05:00.000Z",
      previewImageUrl: "/api/previews/image.png",
    };

    const proposal = buildProposalView({ request, result });

    expect(proposal).toMatchObject({
      proposalId: previewId,
      previewId,
      state: "open",
      baseRevision: 7,
      operationHash: "operation-hash",
      author: { source: "mcp", id: "proposal-agent" },
      explanations: ["Changed /root/children/0/transform/x"],
      previewImageUrl: "/api/previews/image.png",
    });
    expect(proposal.operations).toEqual(request.operations);
    expect(proposal.diff).toEqual(result.diff);

    proposal.operations[0] = {
      kind: "updateNode",
      nodeId,
      propertyGroup: "transform",
      value: { x: 999 },
    };
    proposal.diff[0]!.after = 999;
    expect(request.operations[0]!.kind).toBe("updateNode");
    expect(result.diff[0]!.after).toBe(120);
  });

  it("explains a no-diff proposal without inventing visual changes", () => {
    const request: FrameTransactionRequest = {
      schemaVersion: 1,
      runtimeId: "00000000-0000-4000-8000-000000000103",
      workspaceId: "00000000-0000-4000-8000-000000000104",
      mode: "preview",
      scope: {
        kind: "frame",
        projectId: "00000000-0000-4000-8000-000000000105",
        frameId: "00000000-0000-4000-8000-000000000106",
      },
      baseRevision: 7,
      actor: { source: "http", id: "automation" },
      operations: [
        {
          kind: "updateNode",
          nodeId,
          propertyGroup: "transform",
          value: { x: 40 },
        },
      ],
    };
    const result: TransactionPreviewResult = {
      workspaceId: request.workspaceId,
      projectId: request.scope.projectId,
      frameId: request.scope.frameId,
      baseRevision: 7,
      previewId,
      operationHash: "empty-hash",
      diff: [],
      warnings: [],
      affectedNodes: [],
      expiresAt: "2026-08-10T16:05:00.000Z",
    };

    expect(buildProposalView({ request, result }).explanations).toEqual([
      "Proposes 1 canonical operation.",
    ]);
  });
});
