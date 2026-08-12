import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createBaselineEntry,
  reconstructRevision,
  semanticFrameHash,
  simulateFrameOperations,
  validateFrame,
  type HistoryEntry,
  type SemanticOperation,
} from "@tva-agentic-design/core";
import { nodeCountFixture } from "../fixtures/performance.js";
import { planFrameReconciliation } from "../../packages/renderer-pixi/src/reconciliation.js";

type Measurement = {
  name: string;
  samples: number;
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
};

const round = (value: number): number => Number(value.toFixed(3));
const percentile = (sorted: number[], ratio: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]!;
const measure = (
  name: string,
  samples: number,
  operation: (index: number) => void,
): Measurement => {
  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    operation(index);
    durations.push(performance.now() - started);
  }
  durations.sort((left, right) => left - right);
  const result = {
    name,
    samples,
    minMs: round(durations[0]!),
    medianMs: round(percentile(durations, 0.5)),
    p95Ms: round(percentile(durations, 0.95)),
    maxMs: round(durations.at(-1)!),
  };
  process.stdout.write(`ADR_PERF ${JSON.stringify(result)}\n`);
  return result;
};

describe("reference performance fixtures", () => {
  it.each([50, 250, 300, 500])(
    "validates the %i-node fixture inside the reload target",
    (count) => {
      const frame = nodeCountFixture(count);
      let report = validateFrame(frame);
      const result = measure(`validate-${count}-nodes`, 20, () => {
        report = validateFrame(frame);
      });
      expect(report.valid).toBe(true);
      expect(report.nodeCount).toBe(count);
      expect(result.p95Ms).toBeLessThan(750);
    },
  );

  it("enforces the warning and hard-limit boundaries", () => {
    expect(
      validateFrame(nodeCountFixture(301)).warnings.some(
        (warning) => warning.code === "FRAME_COMPLEXITY_WARNING",
      ),
    ).toBe(true);
    expect(
      validateFrame(nodeCountFixture(501)).errors.some(
        (error) => error.code === "FRAME_LIMIT_EXCEEDED",
      ),
    ).toBe(true);
  });

  it("reconstructs a 250-revision frame with exact semantic state", async () => {
    let current = nodeCountFixture(1);
    const baseline = await createBaselineEntry({
      id: randomUUID(),
      transactionId: randomUUID(),
      projectId: randomUUID(),
      frame: current,
      timestamp: current.createdAt,
    });
    const history: HistoryEntry[] = [baseline];
    const nodeId = current.root.children[0]!.id;
    for (let revision = 1; revision <= 250; revision += 1) {
      const operation: SemanticOperation = {
        kind: "updateNode",
        nodeId,
        propertyGroup: "transform",
        value: { x: revision },
      };
      const beforeHash = await semanticFrameHash(current);
      const simulation = simulateFrameOperations(current, [operation], {
        nextRevision: revision,
        now: new Date(
          Date.parse(current.createdAt) + revision * 1_000,
        ).toISOString(),
      });
      const transactionId = randomUUID();
      history.push({
        id: randomUUID(),
        transactionId,
        timestamp: simulation.frame.updatedAt,
        scope: "frame",
        projectId: baseline.projectId,
        frameId: current.id,
        previousRevision: revision - 1,
        revision,
        actor: { source: "system", id: "performance-fixture" },
        kind: "mutation",
        label: `Revision ${revision}`,
        operations: [operation],
        inverseOperations: simulation.inverseOperations,
        beforeHash,
        afterHash: await semanticFrameHash(simulation.frame),
      });
      current = simulation.frame;
    }
    const started = performance.now();
    const reconstructed = await reconstructRevision(history, current.id, 250);
    const duration = performance.now() - started;
    process.stdout.write(
      `ADR_PERF ${JSON.stringify({
        name: "reconstruct-250-revisions",
        samples: 1,
        durationMs: round(duration),
      })}\n`,
    );
    expect(await semanticFrameHash(reconstructed)).toBe(
      await semanticFrameHash(current),
    );
    expect(duration).toBeLessThan(750);
  });

  it("plans repeated transform, paint, and hierarchy previews at 250 nodes", () => {
    const base = nodeCountFixture(250);
    const transformed = structuredClone(base);
    transformed.root.children[125]!.transform.x += 12;
    const painted = structuredClone(base);
    const paintTarget = painted.root.children[125]!;
    if (paintTarget.type !== "rectangle") throw new Error("Fixture mismatch.");
    paintTarget.fill = { type: "solid", color: "#8B5CF6", opacity: 1 };
    const reordered = structuredClone(base);
    const [moved] = reordered.root.children.splice(125, 1);
    reordered.root.children.splice(80, 0, moved!);

    const transform = measure("plan-transform-250-nodes", 120, () => {
      expect(planFrameReconciliation(base, transformed).mode).toBe(
        "incremental",
      );
    });
    const paint = measure("plan-paint-250-nodes", 120, () => {
      expect(planFrameReconciliation(base, painted)).toMatchObject({
        mode: "full",
        reason: "node-content",
      });
    });
    const hierarchy = measure("plan-hierarchy-250-nodes", 120, () => {
      expect(planFrameReconciliation(base, reordered)).toMatchObject({
        mode: "incremental",
        dirty: ["hierarchy"],
      });
    });
    expect(transform.p95Ms).toBeLessThan(50);
    expect(paint.p95Ms).toBeLessThan(50);
    expect(hierarchy.p95Ms).toBeLessThan(50);
  });

  it("simulates repeated drag commits without changing unrelated IDs", () => {
    const base = nodeCountFixture(250);
    const nodeId = base.root.children[125]!.id;
    const unrelatedId = base.root.children[126]!.id;
    const result = measure("simulate-drag-250-nodes", 120, (index) => {
      const simulation = simulateFrameOperations(base, [
        {
          kind: "updateNode",
          nodeId,
          propertyGroup: "transform",
          value: { x: 120 + index },
        },
      ]);
      expect(simulation.frame.root.children[126]!.id).toBe(unrelatedId);
    });
    expect(result.p95Ms).toBeLessThan(50);
  });
});
