import { describe, expect, it } from "vitest";
import {
  compileArrangeOperations,
  createFrameDocument,
  createTransform,
  simulateFrameOperations,
} from "../src/index.js";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as const;

const frameWithRectangles = () => {
  const frame = createFrameDocument({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    slug: "arrange",
    name: "Arrange",
    width: 400,
    height: 300,
    now: "2026-08-25T00:00:00.000Z",
  });
  frame.root.children.push(
    ...ids.map((id, index) => ({
      id,
      type: "rectangle" as const,
      name: `Rectangle ${index + 1}`,
      visible: true,
      locked: false,
      transform: createTransform({
        x: 20 + index * 90,
        y: 30 + index * 25,
        width: 40 + index * 10,
        height: 40,
      }),
      opacity: 1,
      blendMode: "normal" as const,
      fill: { type: "solid" as const, color: "#315BFF", opacity: 1 },
      cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    })),
  );
  return frame;
};

describe("arrangement compiler", () => {
  it("aligns a selection to the canvas in one ordinary operation batch", () => {
    const frame = frameWithRectangles();
    const operations = compileArrangeOperations({
      frame,
      nodeIds: [ids[0]],
      action: "align-center-x",
      relativeTo: "canvas",
    });
    const result = simulateFrameOperations(frame, operations).frame;
    expect(result.root.children[0]!.transform.x).toBe(180);
    expect(operations).toHaveLength(1);
  });

  it("keeps the key layer fixed and distributes endpoints in place", () => {
    const frame = frameWithRectangles();
    const aligned = compileArrangeOperations({
      frame,
      nodeIds: [ids[0], ids[1]],
      action: "align-top",
      relativeTo: "key",
      keyNodeId: ids[1],
    });
    expect(aligned).toHaveLength(1);
    expect(aligned[0]).toMatchObject({ nodeId: ids[0], value: { y: 55 } });

    const distributed = compileArrangeOperations({
      frame,
      nodeIds: ids,
      action: "distribute-horizontal",
    });
    expect(distributed).toHaveLength(1);
    expect(distributed[0]).toMatchObject({
      kind: "updateNode",
      nodeId: ids[1],
    });
  });
});
