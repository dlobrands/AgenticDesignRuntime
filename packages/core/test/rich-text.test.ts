import { describe, expect, it } from "vitest";
import {
  FrameDocumentSchema,
  analyzeSemanticConflict,
  applyTextSpanStyle,
  createFrameDocument,
  createTransform,
  effectiveTextSpans,
  reconcileTextSpans,
  semanticFrameHash,
  simulateFrameOperations,
  type FrameDocument,
  type TextNode,
} from "../src/index.js";

const FONT = "11111111-1111-4111-8111-111111111111";
const DISPLAY_FONT = "22222222-2222-4222-8222-222222222222";
const NODE = "33333333-3333-4333-8333-333333333333";

const textNode = (): TextNode => ({
  id: NODE,
  type: "text",
  name: "Rich headline",
  visible: true,
  locked: false,
  transform: createTransform({ width: 640, height: 120 }),
  opacity: 1,
  blendMode: "normal",
  text: "Make work visible",
  typography: {
    fontId: FONT,
    fontSize: 48,
    fontWeight: 500,
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
    width: 640,
    height: 120,
    wrapping: "word",
    overflow: "clip",
  },
});

const frame = (): FrameDocument => {
  const result = createFrameDocument({
    id: "44444444-4444-4444-8444-444444444444",
    slug: "rich-text",
    name: "Rich text",
    width: 800,
    height: 600,
    now: "2026-08-10T12:00:00.000Z",
  });
  result.root.children.push(textNode());
  return result;
};

describe("rich-text compatibility and migration", () => {
  it("projects a legacy V1 text node into one deterministic effective span", () => {
    const node = textNode();
    expect(
      FrameDocumentSchema.parse(frame()).root.children[0],
    ).not.toHaveProperty("spans");
    expect(effectiveTextSpans(node)).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(
          new RegExp(`^${NODE}:span:[0-9a-f]{8}:0:17$`),
        ),
        start: 0,
        end: 17,
        style: {},
      }),
    ]);
    expect(effectiveTextSpans(node)).toEqual(effectiveTextSpans(node));
  });

  it("creates bounded complete spans and rejects gaps or surrogate splits", () => {
    const node = textNode();
    node.text = "Go 🚀 now";
    node.spans = applyTextSpanStyle({
      node,
      start: 3,
      end: 5,
      style: {
        fontId: DISPLAY_FONT,
        fontSize: 58,
        fontWeight: 800,
        fontStyle: "italic",
        color: "#FF3366",
        opacity: 0.8,
        letterSpacing: 1.5,
        baselineShift: 4,
        decoration: "underline",
      },
    });
    const valid = frame();
    valid.root.children[0] = node;
    expect(FrameDocumentSchema.safeParse(valid).success).toBe(true);

    const invalid = structuredClone(valid);
    const invalidNode = invalid.root.children[0] as TextNode;
    invalidNode.spans![1]!.start = 4;
    expect(FrameDocumentSchema.safeParse(invalid).success).toBe(false);
  });

  it("preserves unaffected and repeatedly formatted span identities", () => {
    const node = textNode();
    const legacyId = effectiveTextSpans(node)[0]!.id;
    const first = applyTextSpanStyle({
      node,
      start: 0,
      end: 4,
      style: { fontWeight: 800 },
    });
    expect(first[0]!.id).toBe(legacyId);
    const second = applyTextSpanStyle({
      node: { ...node, spans: first },
      start: 0,
      end: 4,
      style: { color: "#3366FF" },
    });
    expect(second.map((span) => span.id)).toEqual(first.map((span) => span.id));
  });

  it("preserves surrounding span styles through plain-client text edits", () => {
    const node = textNode();
    node.spans = applyTextSpanStyle({
      node,
      start: 5,
      end: 9,
      style: { fontWeight: 800, color: "#3366FF" },
    });
    const next = reconcileTextSpans({
      nodeId: node.id,
      previousText: node.text,
      nextText: "Make great work visible",
      spans: node.spans,
    })!;
    expect(next[0]).toMatchObject({ start: 0, end: 11, style: {} });
    expect(next.find((span) => span.style.fontWeight === 800)).toMatchObject({
      start: 11,
      end: 15,
    });
    expect(next.at(-1)).toMatchObject({
      end: "Make great work visible".length,
      style: {},
    });
  });

  it("applies and reverses text plus spans in one canonical operation", async () => {
    const source = frame();
    const node = source.root.children[0] as TextNode;
    const spans = applyTextSpanStyle({
      node,
      start: 0,
      end: 4,
      style: { fontWeight: 800, decoration: "underline" },
    });
    const changed = simulateFrameOperations(source, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "textContent",
        value: { text: node.text, spans },
      },
    ]);
    expect((changed.frame.root.children[0] as TextNode).spans).toEqual(spans);
    const restored = simulateFrameOperations(
      changed.frame,
      changed.inverseOperations,
    );
    expect(await semanticFrameHash(restored.frame)).toBe(
      await semanticFrameHash(source),
    );
  });

  it("keeps paragraph typography disjoint but conflicts concurrent span edits", () => {
    const base = frame();
    const node = base.root.children[0] as TextNode;
    const spans = applyTextSpanStyle({
      node,
      start: 0,
      end: 4,
      style: { color: "#3366FF" },
    });
    const current = simulateFrameOperations(base, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "typography",
        value: { alignment: "center" },
      },
    ]).frame;
    const intended = simulateFrameOperations(base, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "textContent",
        value: { text: node.text, spans },
      },
    ]).frame;
    expect(
      analyzeSemanticConflict(base, current, intended).conflictingProperties,
    ).toEqual([]);

    const overlap = simulateFrameOperations(base, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "textContent",
        value: {
          text: node.text,
          spans: applyTextSpanStyle({
            node,
            start: 0,
            end: 4,
            style: { color: "#FF3366" },
          }),
        },
      },
    ]).frame;
    expect(
      analyzeSemanticConflict(base, overlap, intended).conflictingProperties,
    ).toContain(`node:${node.id}.spans`);
  });
});
