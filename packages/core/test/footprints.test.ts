import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  analyzeSemanticConflict,
  createFrameDocument,
  createTransform,
  simulateFrameOperations,
  type FrameDocument,
  type RectangleNode,
  type TextNode,
} from "../src/index.js";

const rectangle = (name: string): RectangleNode => ({
  id: randomUUID(),
  type: "rectangle",
  name,
  visible: true,
  locked: false,
  transform: createTransform({ x: 10, y: 20, width: 200, height: 120 }),
  opacity: 1,
  blendMode: "normal",
  fill: { type: "solid", color: "#3366FF", opacity: 1 },
  cornerRadius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
});

const text = (): TextNode => ({
  id: randomUUID(),
  type: "text",
  name: "Headline",
  visible: true,
  locked: false,
  transform: createTransform({ width: 500, height: 100 }),
  opacity: 1,
  blendMode: "normal",
  text: "Original headline",
  typography: {
    fontId: randomUUID(),
    fontSize: 48,
    fontWeight: 700,
    fontStyle: "normal",
    lineHeight: 56,
    letterSpacing: 0,
    alignment: "left",
    verticalAlignment: "top",
    color: "#111111",
    opacity: 1,
  },
  textBox: {
    mode: "fixed",
    width: 500,
    height: 100,
    wrapping: "word",
    overflow: "clip",
  },
});

const frame = (): FrameDocument =>
  createFrameDocument({
    id: randomUUID(),
    slug: "semantic-conflict",
    name: "Semantic conflict",
    width: 1080,
    height: 1350,
    now: "2026-08-10T12:00:00.000Z",
  });

describe("semantic property footprints", () => {
  it("allows disjoint transform and fill changes on one node", () => {
    const base = frame();
    const node = rectangle("Hero");
    base.root.children.push(node);
    const current = simulateFrameOperations(base, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "fill",
        value: {
          fill: { type: "solid", color: "#FF3366", opacity: 1 },
        },
      },
    ]).frame;
    const intended = simulateFrameOperations(base, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "transform",
        value: { x: 240 },
      },
    ]).frame;
    const analysis = analyzeSemanticConflict(base, current, intended);
    expect(analysis.conflictingProperties).toEqual([]);
    expect(analysis.intendedChanges.map((change) => change.property)).toContain(
      `node:${node.id}.transform.x`,
    );
    expect(
      analysis.interveningChanges.map((change) => change.property),
    ).toContain(`node:${node.id}.fill`);
  });

  it("conflicts on the same transform property and reports values", () => {
    const base = frame();
    const node = rectangle("Hero");
    base.root.children.push(node);
    const current = simulateFrameOperations(base, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "transform",
        value: { x: 80 },
      },
    ]).frame;
    const intended = simulateFrameOperations(base, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "transform",
        value: { x: 140 },
      },
    ]).frame;
    const analysis = analyzeSemanticConflict(base, current, intended);
    const property = `node:${node.id}.transform.x`;
    expect(analysis.conflictingProperties).toEqual([property]);
    expect(analysis.affectedNodeIds).toEqual([node.id]);
    expect(
      analysis.interveningChanges.find(
        (change) => change.property === property,
      ),
    ).toMatchObject({ before: 10, after: 80 });
    expect(
      analysis.intendedChanges.find((change) => change.property === property),
    ).toMatchObject({ before: 10, after: 140 });
  });

  it("keeps text content and typography changes disjoint", () => {
    const base = frame();
    const node = text();
    base.root.children.push(node);
    const current = simulateFrameOperations(base, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "typography",
        value: { color: "#FF3366" },
      },
    ]).frame;
    const intended = simulateFrameOperations(base, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "textContent",
        value: { text: "Revised headline" },
      },
    ]).frame;
    expect(
      analyzeSemanticConflict(base, current, intended).conflictingProperties,
    ).toEqual([]);
  });

  it("detects hierarchy reorder conflicts", () => {
    const base = frame();
    const first = rectangle("First");
    const second = rectangle("Second");
    const third = rectangle("Third");
    base.root.children.push(first, second, third);
    const current = simulateFrameOperations(base, [
      { kind: "reorderNode", nodeId: third.id, index: 0 },
    ]).frame;
    const intended = simulateFrameOperations(base, [
      { kind: "reorderNode", nodeId: second.id, index: 0 },
    ]).frame;
    expect(
      analyzeSemanticConflict(base, current, intended).conflictingProperties,
    ).toEqual(["container:root.children.order"]);
  });

  it("detects node deletion during an edit", () => {
    const base = frame();
    const node = rectangle("Deleted while editing");
    base.root.children.push(node);
    const current = simulateFrameOperations(base, [
      { kind: "deleteNode", nodeId: node.id },
    ]).frame;
    const intended = simulateFrameOperations(base, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "transform",
        value: { y: 240 },
      },
    ]).frame;
    const analysis = analyzeSemanticConflict(base, current, intended);
    expect(analysis.conflictingProperties).toContain(
      `node:${node.id}.transform.y`,
    );
    expect(analysis.affectedNodeIds).toEqual([node.id]);
  });
});
