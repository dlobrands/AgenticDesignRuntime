import { describe, expect, it } from "vitest";
import {
  FrameDocumentSchema,
  createFrameDocument,
  createTransform,
  frameResizeOperations,
  semanticChanges,
  simulateFrameOperations,
  type RectangleNode,
  type GroupNode,
} from "../src/index.js";

const nodeId = "22222222-2222-4222-8222-222222222222";

const frame = () => {
  const result = createFrameDocument({
    id: "11111111-1111-4111-8111-111111111111",
    slug: "resize-frame",
    name: "Resize frame",
    width: 1000,
    height: 1000,
    now: "2026-08-10T12:00:00.000Z",
  });
  const node: RectangleNode = {
    id: nodeId,
    type: "rectangle",
    name: "Card",
    visible: true,
    locked: false,
    transform: createTransform({ x: 700, y: 400, width: 200, height: 100 }),
    opacity: 1,
    blendMode: "normal",
    fill: { type: "solid", color: "#315CF5", opacity: 1 },
    cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
  };
  result.root.children.push(node);
  return result;
};

describe("frame resizing", () => {
  it("keeps legacy nodes valid and validates optional resize constraints", () => {
    const source = frame();
    expect(FrameDocumentSchema.safeParse(source).success).toBe(true);
    source.root.children[0]!.resizeConstraints = {
      horizontal: "right",
      vertical: "middle",
    };
    expect(FrameDocumentSchema.safeParse(source).success).toBe(true);
    expect(
      FrameDocumentSchema.safeParse({
        ...source,
        root: {
          ...source.root,
          children: [
            {
              ...source.root.children[0],
              resizeConstraints: { horizontal: "near", vertical: "top" },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("sets and removes constraints reversibly with an independent footprint", () => {
    const source = frame();
    const changed = simulateFrameOperations(source, [
      {
        kind: "updateNode",
        nodeId,
        propertyGroup: "resizeConstraints",
        value: {
          constraints: { horizontal: "right", vertical: "middle" },
        },
      },
    ]);
    expect(changed.frame.root.children[0]!.resizeConstraints).toEqual({
      horizontal: "right",
      vertical: "middle",
    });
    expect(semanticChanges(source, changed.frame)).toEqual([
      expect.objectContaining({
        property: `node:${nodeId}.resizeConstraints`,
      }),
    ]);
    expect(
      simulateFrameOperations(changed.frame, changed.inverseOperations).frame,
    ).toEqual(source);
  });

  it("compiles constrained resize into one reversible canonical transaction", () => {
    const source = frame();
    source.canvas.guides = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        axis: "vertical",
        position: 900,
      },
    ];
    source.canvas.safeArea = { top: 80, right: 80, bottom: 80, left: 80 };
    source.root.children[0]!.resizeConstraints = {
      horizontal: "right",
      vertical: "middle",
    };
    const operations = frameResizeOperations({
      frame: source,
      width: 600,
      height: 800,
      strategy: "constraints",
    });
    expect(operations).toHaveLength(2);
    const changed = simulateFrameOperations(source, operations);
    expect(changed.frame.canvas).toMatchObject({
      width: 600,
      height: 800,
      guides: [{ axis: "vertical", position: 600 }],
      safeArea: { top: 80, right: 80, bottom: 80, left: 80 },
    });
    expect(changed.frame.root.children[0]!.transform).toMatchObject({
      x: 300,
      y: 300,
      width: 200,
      height: 100,
      scaleX: 1,
      scaleY: 1,
    });
    expect(
      simulateFrameOperations(changed.frame, changed.inverseOperations).frame,
    ).toEqual(source);
  });

  it("supports canvas-only and proportional visual scaling strategies", () => {
    const source = frame();
    expect(
      frameResizeOperations({
        frame: source,
        width: 500,
        height: 750,
        strategy: "canvasOnly",
      }),
    ).toHaveLength(1);
    const scaled = simulateFrameOperations(
      source,
      frameResizeOperations({
        frame: source,
        width: 500,
        height: 750,
        strategy: "scale",
      }),
    ).frame;
    expect(scaled.root.children[0]!.transform).toMatchObject({
      x: 350,
      y: 300,
      width: 200,
      height: 100,
      scaleX: 0.5,
      scaleY: 0.75,
    });
  });

  it("stretches container content through scale while preserving its geometry", () => {
    const source = frame();
    const group: GroupNode = {
      id: "44444444-4444-4444-8444-444444444444",
      type: "group",
      name: "Container",
      visible: true,
      locked: false,
      transform: createTransform({ x: 100, y: 100, width: 200, height: 200 }),
      resizeConstraints: { horizontal: "stretch", vertical: "top" },
      opacity: 1,
      blendMode: "pass-through",
      children: [],
    };
    source.root.children = [group];
    const resized = simulateFrameOperations(
      source,
      frameResizeOperations({
        frame: source,
        width: 1200,
        height: 1000,
        strategy: "constraints",
      }),
    ).frame;
    expect(resized.root.children[0]!.transform).toMatchObject({
      x: 100,
      width: 200,
      scaleX: 2,
    });
  });
});
