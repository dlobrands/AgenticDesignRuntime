import { describe, expect, it } from "vitest";
import {
  FrameDocumentSchema,
  analyzeSemanticConflict,
  createFrameDocument,
  createTransform,
  semanticFrameHash,
  simulateFrameOperations,
  type FrameDocument,
  type VectorPathNode,
} from "../src/index.js";

const NODE = "11111111-1111-4111-8111-111111111111";

const pathNode = (): VectorPathNode => ({
  id: NODE,
  type: "vectorPath",
  name: "Campaign curve",
  visible: true,
  locked: false,
  transform: createTransform({ x: 40, y: 50, width: 320, height: 180 }),
  opacity: 1,
  blendMode: "normal",
  commands: [
    { id: "move-1", kind: "move", to: { x: 0.05, y: 0.8 } },
    {
      id: "curve-1",
      kind: "cubic",
      control1: { x: 0.25, y: 0.1 },
      control2: { x: 0.7, y: 0.1 },
      to: { x: 0.95, y: 0.8 },
    },
    { id: "line-1", kind: "line", to: { x: 0.5, y: 0.95 } },
    { id: "close-1", kind: "close" },
  ],
  fill: { type: "solid", color: "#315CF5", opacity: 0.85 },
  stroke: {
    enabled: true,
    width: 4,
    alignment: "center",
    opacity: 1,
    paint: { type: "solid", color: "#10131A", opacity: 1 },
  },
});

const frame = (): FrameDocument => {
  const result = createFrameDocument({
    id: "22222222-2222-4222-8222-222222222222",
    slug: "vector-path",
    name: "Vector path",
    width: 800,
    height: 600,
    now: "2026-08-10T12:00:00.000Z",
  });
  result.root.children.push(pathNode());
  return result;
};

describe("bounded native vector paths", () => {
  it("validates stable normalized move/line/cubic/close commands", () => {
    expect(FrameDocumentSchema.safeParse(frame()).success).toBe(true);
    const gap = frame();
    (gap.root.children[0] as VectorPathNode).commands[0] = {
      id: "bad-line",
      kind: "line",
      to: { x: 0.5, y: 0.5 },
    };
    expect(FrameDocumentSchema.safeParse(gap).success).toBe(false);
    const outside = frame();
    const curve = (outside.root.children[0] as VectorPathNode).commands[1]!;
    if (curve.kind === "cubic") curve.control1.x = 1.1;
    expect(FrameDocumentSchema.safeParse(outside).success).toBe(false);
  });

  it("edits commands through one reversible canonical property group", async () => {
    const source = frame();
    const node = source.root.children[0] as VectorPathNode;
    const commands = structuredClone(node.commands);
    const curve = commands[1]!;
    if (curve.kind === "cubic") curve.control1 = { x: 0.18, y: 0.22 };
    const changed = simulateFrameOperations(source, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "vectorPath",
        value: { commands },
      },
    ]);
    expect((changed.frame.root.children[0] as VectorPathNode).commands).toEqual(
      commands,
    );
    const restored = simulateFrameOperations(
      changed.frame,
      changed.inverseOperations,
    );
    expect(await semanticFrameHash(restored.frame)).toBe(
      await semanticFrameHash(source),
    );
  });

  it("supports optional fill and stroke without weakening shape fills", () => {
    const source = frame();
    const withoutFill = simulateFrameOperations(source, [
      {
        kind: "updateNode",
        nodeId: NODE,
        propertyGroup: "fill",
        value: { fill: null },
      },
    ]).frame;
    expect(withoutFill.root.children[0]).not.toHaveProperty("fill");
    expect(() =>
      simulateFrameOperations(withoutFill, [
        {
          kind: "updateNode",
          nodeId: NODE,
          propertyGroup: "stroke",
          value: { stroke: null },
        },
      ]),
    ).toThrow(/fill or stroke/);
  });

  it("keeps path geometry disjoint from paint and conflicts concurrent geometry", () => {
    const base = frame();
    const node = base.root.children[0] as VectorPathNode;
    const intendedCommands = structuredClone(node.commands);
    const intendedCurve = intendedCommands[1]!;
    if (intendedCurve.kind === "cubic") intendedCurve.control1.x = 0.15;
    const intended = simulateFrameOperations(base, [
      {
        kind: "updateNode",
        nodeId: NODE,
        propertyGroup: "vectorPath",
        value: { commands: intendedCommands },
      },
    ]).frame;
    const paint = simulateFrameOperations(base, [
      {
        kind: "updateNode",
        nodeId: NODE,
        propertyGroup: "fill",
        value: {
          fill: { type: "solid", color: "#FF3366", opacity: 1 },
        },
      },
    ]).frame;
    expect(
      analyzeSemanticConflict(base, paint, intended).conflictingProperties,
    ).toEqual([]);
    const concurrentCommands = structuredClone(node.commands);
    const concurrentCurve = concurrentCommands[1]!;
    if (concurrentCurve.kind === "cubic") concurrentCurve.control1.x = 0.35;
    const overlap = simulateFrameOperations(base, [
      {
        kind: "updateNode",
        nodeId: NODE,
        propertyGroup: "vectorPath",
        value: { commands: concurrentCommands },
      },
    ]).frame;
    expect(
      analyzeSemanticConflict(base, overlap, intended).conflictingProperties,
    ).toContain(`node:${NODE}.commands`);
  });
});
