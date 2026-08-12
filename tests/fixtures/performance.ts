import { randomUUID } from "node:crypto";
import {
  createFrameDocument,
  createTransform,
  type FrameDocument,
  type RectangleNode,
} from "@tva-agentic-design/core";

export const rectangleFixture = (index: number): RectangleNode => ({
  id: randomUUID(),
  type: "rectangle",
  name: `Fixture ${index}`,
  visible: true,
  locked: false,
  transform: createTransform({
    x: (index % 20) * 48,
    y: Math.floor(index / 20) * 48,
    width: 40,
    height: 40,
  }),
  opacity: 1,
  blendMode: "normal",
  fill: { type: "solid", color: index % 2 ? "#315CF5" : "#F0A24A", opacity: 1 },
  cornerRadius: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
});

export const nodeCountFixture = (count: number): FrameDocument => {
  const frame = createFrameDocument({
    id: randomUUID(),
    slug: `fixture-${count}`,
    name: `${count} node fixture`,
    width: 1080,
    height: 1350,
    now: "2026-08-05T12:00:00.000Z",
  });
  frame.root.children = Array.from({ length: count }, (_, index) =>
    rectangleFixture(index),
  );
  return frame;
};
