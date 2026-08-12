import { describe, expect, it } from "vitest";
import {
  EffectStackSchema,
  FrameDocumentSchema,
  createFrameDocument,
  createTransform,
  effectItems,
  semanticFrameHash,
  simulateFrameOperations,
  type Effect,
  type FrameDocument,
  type RectangleNode,
} from "../src/index.js";

const NODE = "11111111-1111-4111-8111-111111111111";
const effects = (): Effect[] => [
  {
    id: "shadow-outer",
    type: "outerShadow",
    enabled: true,
    offsetX: 0,
    offsetY: 12,
    blur: 24,
    spread: 0,
    color: "#000000",
    opacity: 0.4,
  },
  {
    id: "shadow-inner",
    type: "innerShadow",
    enabled: true,
    offsetX: 2,
    offsetY: 4,
    blur: 8,
    spread: 0,
    color: "#10131A",
    opacity: 0.5,
  },
  { id: "blur", type: "blur", enabled: false, radius: 3 },
  {
    id: "inner-glow",
    type: "innerGlow",
    enabled: true,
    blur: 10,
    spread: 1,
    color: "#FFFFFF",
    opacity: 0.3,
  },
  {
    id: "outer-glow",
    type: "outerGlow",
    enabled: true,
    blur: 18,
    spread: 2,
    color: "#315CF5",
    opacity: 0.5,
  },
  {
    id: "color",
    type: "colorOverlay",
    enabled: true,
    paint: { type: "solid", color: "#FF3366", opacity: 1 },
    opacity: 0.25,
  },
  {
    id: "gradient",
    type: "gradientOverlay",
    enabled: true,
    paint: {
      type: "linearGradient",
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
      stops: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          offset: 0,
          color: "#315CF5",
          opacity: 1,
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          offset: 1,
          color: "#FF3366",
          opacity: 1,
        },
      ],
      interpolation: "linear-srgb",
      spread: "pad",
      dither: true,
    },
    opacity: 0.4,
  },
];

const frame = (): FrameDocument => {
  const frame = createFrameDocument({
    id: "22222222-2222-4222-8222-222222222222",
    slug: "effects",
    name: "Effects",
    width: 800,
    height: 600,
    now: "2026-08-10T12:00:00.000Z",
  });
  frame.root.children.push({
    id: NODE,
    type: "rectangle",
    name: "Card",
    visible: true,
    locked: false,
    transform: createTransform({ x: 100, y: 100, width: 320, height: 180 }),
    opacity: 1,
    blendMode: "normal",
    fill: { type: "solid", color: "#FFFFFF", opacity: 1 },
    cornerRadius: {
      topLeft: 12,
      topRight: 12,
      bottomRight: 12,
      bottomLeft: 12,
    },
  });
  return frame;
};

describe("ordered stable-ID effect stacks", () => {
  it("validates every bounded V1 effect and rejects duplicate IDs", () => {
    expect(EffectStackSchema.safeParse({ items: effects() }).success).toBe(
      true,
    );
    const duplicate = effects();
    duplicate[1]!.id = duplicate[0]!.id;
    expect(EffectStackSchema.safeParse({ items: duplicate }).success).toBe(
      false,
    );
  });

  it("projects a legacy outer shadow without silently rewriting the frame", () => {
    const legacy = frame();
    (legacy.root.children[0] as RectangleNode).effects = {
      outerShadow: {
        enabled: true,
        offsetX: 0,
        offsetY: 12,
        blur: 24,
        spread: 0,
        color: "#000000",
        opacity: 0.35,
      },
    };
    const parsed = FrameDocumentSchema.parse(legacy);
    const parsedNode = parsed.root.children[0] as RectangleNode;
    expect(parsedNode.effects).toHaveProperty("outerShadow");
    expect(effectItems(parsedNode.effects)).toMatchObject([
      { id: "legacy-outer-shadow", type: "outerShadow", enabled: true },
    ]);
  });

  it("reorders and edits the complete stack through one reversible operation", async () => {
    const source = frame();
    const items = effects();
    const changed = simulateFrameOperations(source, [
      {
        kind: "updateNode",
        nodeId: NODE,
        propertyGroup: "effects",
        value: { effects: { items } },
      },
    ]);
    expect(
      effectItems((changed.frame.root.children[0] as RectangleNode).effects),
    ).toEqual(items);
    const reordered = [...items].reverse();
    const second = simulateFrameOperations(changed.frame, [
      {
        kind: "updateNode",
        nodeId: NODE,
        propertyGroup: "effects",
        value: { effects: { items: reordered } },
      },
    ]);
    expect(
      effectItems((second.frame.root.children[0] as RectangleNode).effects).map(
        (effect) => effect.id,
      ),
    ).toEqual(reordered.map((effect) => effect.id));
    const restored = simulateFrameOperations(second.frame, [
      ...second.inverseOperations,
      ...changed.inverseOperations,
    ]);
    expect(await semanticFrameHash(restored.frame)).toBe(
      await semanticFrameHash(source),
    );
  });
});
