import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createFrameDocument,
  createTransform,
  type FrameDocument,
  type RasterImageNode,
  type RectangleNode,
  type TextNode,
  type VectorPathNode,
} from "@agentic-design/core";
import { planFrameReconciliation } from "../src/reconciliation.js";

const rectangle = (name = "Card"): RectangleNode => ({
  id: randomUUID(),
  type: "rectangle",
  name,
  visible: true,
  locked: false,
  transform: createTransform({ x: 10, y: 20, width: 200, height: 120 }),
  opacity: 1,
  blendMode: "normal",
  fill: { type: "solid", color: "#315CF5", opacity: 1 },
  cornerRadius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
});

const frame = (): FrameDocument =>
  createFrameDocument({
    id: randomUUID(),
    slug: "reconciliation",
    name: "Reconciliation",
    width: 1080,
    height: 1350,
    now: "2026-08-10T12:00:00.000Z",
  });

describe("renderer reconciliation planning", () => {
  it("requires a full initial build", () => {
    expect(planFrameReconciliation(undefined, frame())).toMatchObject({
      mode: "full",
      reason: "initial",
      dirty: ["hierarchy"],
    });
  });

  it("updates placement and metadata in place by stable ID", () => {
    const previous = frame();
    const node = rectangle();
    previous.root.children.push(node);
    const next = structuredClone(previous);
    const updated = next.root.children[0]! as RectangleNode;
    updated.transform.x = 240;
    updated.transform.rotation = 12;
    updated.name = "Renamed card";
    updated.locked = true;
    expect(planFrameReconciliation(previous, next)).toEqual({
      mode: "incremental",
      dirty: ["transform"],
      changes: [
        {
          nodeId: node.id,
          transformChanged: true,
          metadataChanged: true,
          dirty: ["transform"],
        },
      ],
    });
  });

  it.each([
    [
      "geometry",
      (node: RectangleNode): void => {
        node.transform.width = 320;
      },
    ],
    [
      "paint",
      (node: RectangleNode) => {
        node.fill = { type: "solid", color: "#FF3366", opacity: 1 };
      },
    ],
    [
      "effect",
      (node: RectangleNode) => {
        node.effects = {
          outerShadow: {
            enabled: true,
            offsetX: 4,
            offsetY: 8,
            blur: 12,
            spread: 0,
            color: "#000000",
            opacity: 0.4,
          },
        };
      },
    ],
  ] as const)("rebuilds for %s changes", (category, mutate) => {
    const previous = frame();
    previous.root.children.push(rectangle());
    const next = structuredClone(previous);
    mutate(next.root.children[0]! as RectangleNode);
    expect(planFrameReconciliation(previous, next)).toMatchObject({
      mode: "full",
      reason: "node-content",
      dirty: expect.arrayContaining([category]),
    });
  });

  it("rebuilds for hierarchy order and canvas changes", () => {
    const previous = frame();
    previous.root.children.push(rectangle("One"), rectangle("Two"));
    const reordered = structuredClone(previous);
    reordered.root.children.reverse();
    expect(planFrameReconciliation(previous, reordered)).toMatchObject({
      mode: "incremental",
      dirty: ["hierarchy"],
    });
    const resized = structuredClone(previous);
    resized.canvas.width = 1200;
    expect(planFrameReconciliation(previous, resized)).toMatchObject({
      mode: "full",
      reason: "canvas",
      dirty: ["geometry"],
    });
    const inserted = structuredClone(previous);
    const added = rectangle("Three");
    inserted.root.children.push(added);
    expect(planFrameReconciliation(previous, inserted)).toMatchObject({
      mode: "full",
      reason: "hierarchy",
      dirty: ["hierarchy"],
      addedNodeIds: [added.id],
      removedNodeIds: [],
    });
    const removed = structuredClone(previous);
    removed.root.children.splice(0, 1);
    expect(planFrameReconciliation(previous, removed)).toMatchObject({
      mode: "full",
      reason: "hierarchy",
      dirty: ["hierarchy"],
      addedNodeIds: [],
      removedNodeIds: [previous.root.children[0]!.id],
    });
  });

  it("does not rebuild rendered content for canvas guide and safe-area metadata", () => {
    const previous = frame();
    previous.root.children.push(rectangle());
    const next = structuredClone(previous);
    next.canvas.guides = [
      {
        id: randomUUID(),
        axis: "vertical",
        position: 320,
      },
    ];
    next.canvas.safeArea = { top: 24, right: 32, bottom: 24, left: 32 };

    expect(planFrameReconciliation(previous, next)).toEqual({
      mode: "incremental",
      reason: "canvas-metadata",
      dirty: [],
      changes: [],
    });
  });

  it("treats template and semantic-slot metadata as non-rendered incremental state", () => {
    const previous = frame();
    const node = rectangle("Template headline");
    previous.root.children.push(node);
    const next = structuredClone(previous);
    next.root.children[0]!.templateInstance = {
      templateId: randomUUID(),
      instanceId: randomUUID(),
      sourceNodeId: node.id,
    };
    next.root.children[0]!.templateSlot = {
      slotId: randomUUID(),
      key: "headline",
      name: "Headline",
      role: "headline",
    };

    expect(planFrameReconciliation(previous, next)).toEqual({
      mode: "incremental",
      dirty: [],
      changes: [
        {
          nodeId: node.id,
          transformChanged: false,
          metadataChanged: true,
          dirty: [],
        },
      ],
    });
  });

  it("classifies text and raster asset edits for selective leaf rebuilds", () => {
    const previous = frame();
    const text: TextNode = {
      id: randomUUID(),
      type: "text",
      name: "Headline",
      visible: true,
      locked: false,
      transform: createTransform({ width: 480, height: 100 }),
      opacity: 1,
      blendMode: "normal",
      text: "Original",
      typography: {
        fontId: randomUUID(),
        fontSize: 48,
        fontWeight: 700,
        fontStyle: "normal",
        lineHeight: 56,
        letterSpacing: 0,
        alignment: "left",
        verticalAlignment: "top",
        color: "#FFFFFF",
        opacity: 1,
      },
      textBox: {
        mode: "fixed",
        width: 480,
        height: 100,
        wrapping: "word",
        overflow: "clip",
      },
    };
    const image: RasterImageNode = {
      id: randomUUID(),
      type: "rasterImage",
      name: "Hero",
      visible: true,
      locked: false,
      transform: createTransform({ width: 400, height: 300 }),
      opacity: 1,
      blendMode: "normal",
      assetId: randomUUID(),
      fit: "cover",
    };
    previous.root.children.push(text, image);
    const next = structuredClone(previous);
    (next.root.children[0]! as TextNode).text = "Revised";
    (next.root.children[1]! as RasterImageNode).crop = {
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.8,
    };
    expect(planFrameReconciliation(previous, next)).toMatchObject({
      mode: "full",
      reason: "node-content",
      dirty: expect.arrayContaining(["text", "asset"]),
      changes: expect.arrayContaining([
        expect.objectContaining({ nodeId: text.id, dirty: ["text"] }),
        expect.objectContaining({ nodeId: image.id, dirty: ["asset"] }),
      ]),
    });
  });

  it("classifies rich span changes as text-dirty leaf content", () => {
    const previous = frame();
    const text: TextNode = {
      id: randomUUID(),
      type: "text",
      name: "Rich headline",
      visible: true,
      locked: false,
      transform: createTransform({ width: 480, height: 100 }),
      opacity: 1,
      blendMode: "normal",
      text: "Rich text",
      typography: {
        fontId: randomUUID(),
        fontSize: 48,
        fontWeight: 500,
        fontStyle: "normal",
        lineHeight: 56,
        letterSpacing: 0,
        alignment: "left",
        verticalAlignment: "top",
        color: "#FFFFFF",
        opacity: 1,
      },
      textBox: {
        mode: "fixed",
        width: 480,
        height: 100,
        wrapping: "word",
        overflow: "clip",
      },
    };
    previous.root.children.push(text);
    const next = structuredClone(previous);
    (next.root.children[0] as TextNode).spans = [
      {
        id: "emphasis",
        start: 0,
        end: 4,
        style: { fontWeight: 800 },
      },
      { id: "remainder", start: 4, end: 9, style: {} },
    ];
    expect(planFrameReconciliation(previous, next)).toMatchObject({
      mode: "full",
      reason: "node-content",
      dirty: ["text"],
      changes: [{ nodeId: text.id, dirty: ["text"] }],
    });
  });

  it("classifies vector geometry separately from vector paint", () => {
    const previous = frame();
    const vector: VectorPathNode = {
      id: randomUUID(),
      type: "vectorPath",
      name: "Curve",
      visible: true,
      locked: false,
      transform: createTransform({ width: 300, height: 200 }),
      opacity: 1,
      blendMode: "normal",
      commands: [
        { id: "move", kind: "move", to: { x: 0, y: 0 } },
        { id: "line", kind: "line", to: { x: 1, y: 1 } },
      ],
      fill: { type: "solid", color: "#315CF5", opacity: 1 },
    };
    previous.root.children.push(vector);
    const geometry = structuredClone(previous);
    (geometry.root.children[0] as VectorPathNode).commands[1] = {
      id: "line",
      kind: "line",
      to: { x: 1, y: 0.5 },
    };
    expect(planFrameReconciliation(previous, geometry)).toMatchObject({
      mode: "full",
      reason: "node-content",
      dirty: ["geometry"],
    });
    const paint = structuredClone(previous);
    (paint.root.children[0] as VectorPathNode).fill = {
      type: "solid",
      color: "#FF3366",
      opacity: 1,
    };
    expect(planFrameReconciliation(previous, paint)).toMatchObject({
      mode: "full",
      reason: "node-content",
      dirty: ["paint"],
    });
  });
});
