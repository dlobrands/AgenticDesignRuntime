import { describe, expect, it } from "vitest";
import {
  FrameDocumentSchema,
  createFrameDocument,
  createTransform,
  type TextNode,
} from "../src/index.js";

const fontId = "00000000-0000-4000-8000-000000000301";

const textNode = (text: string): TextNode => ({
  id: "00000000-0000-4000-8000-000000000302",
  type: "text",
  name: "International text",
  visible: true,
  locked: false,
  transform: createTransform({ width: 500, height: 120 }),
  opacity: 1,
  blendMode: "normal",
  text,
  typography: {
    fontId,
    fontSize: 40,
    fontWeight: 400,
    fontStyle: "normal",
    lineHeight: 48,
    letterSpacing: 0,
    alignment: "right",
    verticalAlignment: "top",
    direction: "rtl",
    language: "ar",
    color: "#111111",
    opacity: 1,
  },
  textBox: {
    mode: "fixed",
    width: 500,
    height: 120,
    wrapping: "word",
    overflow: "clip",
  },
});

describe("international text intent", () => {
  it("accepts explicit language and RTL direction", () => {
    const frame = createFrameDocument({
      id: "00000000-0000-4000-8000-000000000303",
      slug: "rtl",
      name: "RTL",
      width: 600,
      height: 200,
      now: "2026-08-27T12:00:00.000Z",
    });
    frame.root.children.push(textNode("مرحبا بالعالم"));
    expect(FrameDocumentSchema.safeParse(frame).success).toBe(true);
  });

  it("rejects span boundaries inside one grapheme cluster", () => {
    const family = "👨‍👩‍👧‍👦";
    const node = textNode(`A${family}B`);
    node.spans = [
      { id: "left", start: 0, end: 2, style: {} },
      { id: "right", start: 2, end: node.text.length, style: {} },
    ];
    const frame = createFrameDocument({
      id: "00000000-0000-4000-8000-000000000304",
      slug: "grapheme",
      name: "Grapheme",
      width: 600,
      height: 200,
      now: "2026-08-27T12:00:00.000Z",
    });
    frame.root.children.push(node);
    const result = FrameDocumentSchema.safeParse(frame);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        "Text span boundaries cannot split a grapheme cluster.",
      );
  });
});
