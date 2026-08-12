import { describe, expect, it } from "vitest";
import { DesignRuntimeApiError } from "@agentic-design/client";
import type {
  FrameOperation,
  TransactionPreviewResult,
} from "@agentic-design/core";
import {
  safeRebaseConflict,
  semanticConflictFromError,
} from "../src/conflict-controller";

const nodeId = "11111111-1111-4111-8111-111111111111";
const property = `node:${nodeId}.transform.x`;
const operations: FrameOperation[] = [
  {
    kind: "updateNode",
    nodeId,
    propertyGroup: "transform",
    value: { x: 40 },
  },
];

describe("conflict controller", () => {
  it("builds a reviewed safe-rebase state without committing it", () => {
    const preview: TransactionPreviewResult = {
      previewId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      projectId: "44444444-4444-4444-8444-444444444444",
      frameId: "55555555-5555-4555-8555-555555555555",
      baseRevision: 2,
      operationHash: `sha256:${"a".repeat(64)}`,
      diff: [],
      warnings: [],
      affectedNodes: [nodeId],
      expiresAt: "2026-08-10T12:01:00.000Z",
      rebase: {
        fromRevision: 0,
        toRevision: 2,
        intendedChanges: [{ property, before: 0, after: 40, nodeId }],
        interveningChanges: [
          {
            property: `node:${nodeId}.fill`,
            before: "#000000",
            after: "#FFFFFF",
            nodeId,
          },
        ],
      },
    };
    const conflict = safeRebaseConflict(preview, operations, 1, 2);
    expect(conflict).toMatchObject({
      kind: "safe-rebase",
      baseRevision: 0,
      canonicalRevision: 2,
      previewId: preview.previewId,
      affectedProperties: [property],
    });
  });

  it("keeps only structured semantic evidence from overlap errors", () => {
    const conflict = semanticConflictFromError(
      new DesignRuntimeApiError({
        code: "SEMANTIC_CONFLICT",
        message: "Concurrent property edit.",
        status: 409,
        details: {
          affectedNodeIds: [nodeId, 42],
          affectedProperties: [property, null],
          intendedChanges: [
            { property, before: 0, after: 40, nodeId },
            { invalid: true },
          ],
          interveningChanges: [{ property, before: 0, after: 20, nodeId }],
        },
      }),
      operations,
      0,
      2,
    );
    expect(conflict).toMatchObject({
      kind: "overlap",
      affectedNodeIds: [nodeId],
      affectedProperties: [property],
      intendedChanges: [{ property, before: 0, after: 40, nodeId }],
      interveningChanges: [{ property, before: 0, after: 20, nodeId }],
    });
  });

  it("separates stale directives and ignores unrelated API failures", () => {
    expect(
      semanticConflictFromError(
        new DesignRuntimeApiError({
          code: "STALE_REVISION",
          message: "History moved.",
          status: 409,
        }),
        operations,
        1,
        2,
      ),
    ).toMatchObject({ kind: "stale-directive" });
    expect(
      semanticConflictFromError(
        new DesignRuntimeApiError({
          code: "FRAME_VALIDATION_FAILED",
          message: "Invalid.",
          status: 400,
        }),
        operations,
        1,
        2,
      ),
    ).toBeUndefined();
  });
});
