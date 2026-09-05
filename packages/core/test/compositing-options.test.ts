import { describe, expect, it } from "vitest";
import {
  createFrameDocument,
  createTransform,
  simulateFrameOperations,
} from "../src/index.js";

describe("advanced compositing options", () => {
  it("applies and reverses fill opacity without changing overall opacity", () => {
    const frame = createFrameDocument({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      slug: "compositing",
      name: "Compositing",
      width: 200,
      height: 200,
      now: "2026-08-25T00:00:00.000Z",
    });
    const nodeId = "11111111-1111-4111-8111-111111111111";
    frame.root.children.push({
      id: nodeId,
      type: "rectangle",
      name: "Layer",
      visible: true,
      locked: false,
      transform: createTransform({ width: 100, height: 100 }),
      opacity: 0.8,
      blendMode: "normal",
      fill: { type: "solid", color: "#315BFF", opacity: 1 },
      cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    });
    const result = simulateFrameOperations(frame, [
      {
        kind: "updateNode",
        nodeId,
        propertyGroup: "compositing",
        value: { fillOpacity: 0.35, blendMode: "multiply" },
      },
    ]);
    expect(result.frame.root.children[0]).toMatchObject({
      opacity: 0.8,
      fillOpacity: 0.35,
      blendMode: "multiply",
    });
    expect(result.inverseOperations).toEqual([
      {
        kind: "updateNode",
        nodeId,
        propertyGroup: "compositing",
        value: { fillOpacity: 1, blendMode: "normal" },
      },
    ]);
  });

  it("rejects fill opacity on groups", () => {
    const frame = createFrameDocument({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      slug: "group",
      name: "Group",
      width: 200,
      height: 200,
      now: "2026-08-25T00:00:00.000Z",
    });
    const groupId = "22222222-2222-4222-8222-222222222222";
    frame.root.children.push({
      id: groupId,
      type: "group",
      name: "Group",
      visible: true,
      locked: false,
      transform: createTransform({ width: 100, height: 100 }),
      opacity: 1,
      blendMode: "pass-through",
      children: [],
    });
    expect(() =>
      simulateFrameOperations(frame, [
        {
          kind: "updateNode",
          nodeId: groupId,
          propertyGroup: "compositing",
          value: { fillOpacity: 0.5 },
        },
      ]),
    ).toThrow("Groups do not support fill opacity");
  });
});
