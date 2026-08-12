import { describe, expect, it } from "vitest";
import { createTransform, type TextNode } from "@agentic-design/core";
import { layoutRichTextNode } from "../src/rich-text-layout.js";

const node = (): TextNode => ({
  id: "11111111-1111-4111-8111-111111111111",
  type: "text",
  name: "Rich headline",
  visible: true,
  locked: false,
  transform: createTransform({ width: 250, height: 160 }),
  opacity: 1,
  blendMode: "normal",
  text: "Build a visible brand",
  typography: {
    fontId: "22222222-2222-4222-8222-222222222222",
    fontSize: 24,
    fontWeight: 400,
    fontStyle: "normal",
    lineHeight: 30,
    letterSpacing: 0,
    alignment: "left",
    verticalAlignment: "top",
    color: "#111111",
    opacity: 1,
  },
  spans: [
    {
      id: "lead",
      start: 0,
      end: 5,
      style: {
        fontId: "33333333-3333-4333-8333-333333333333",
        fontSize: 32,
        fontWeight: 800,
        color: "#3366FF",
        opacity: 0.8,
        letterSpacing: 1,
        baselineShift: 3,
        decoration: "underline",
      },
    },
    { id: "body", start: 5, end: 21, style: {} },
  ],
  textBox: {
    mode: "fixed",
    width: 250,
    height: 160,
    wrapping: "word",
    overflow: "clip",
  },
});

describe("rich text layout", () => {
  const measure = (
    text: string,
    style: { fontSize: number; letterSpacing: number },
  ) => ({
    width: text.length * (style.fontSize * 0.5 + style.letterSpacing),
    height: style.fontSize,
  });

  it("resolves per-span styles and returns deterministic bounded lines", () => {
    const input = node();
    const first = layoutRichTextNode(
      input,
      (fontId) => `ADR_${fontId}`,
      measure,
    );
    const second = layoutRichTextNode(
      input,
      (fontId) => `ADR_${fontId}`,
      measure,
    );
    expect(second).toEqual(first);
    expect(first.lines).toBeGreaterThanOrEqual(1);
    expect(first.width).toBeLessThanOrEqual(input.textBox.width + 0.001);
    expect(first.height).toBeGreaterThanOrEqual(32);
    expect(first.fragments[0]).toMatchObject({
      text: "Build",
      style: {
        fontSize: 32,
        fontWeight: 800,
        color: "#3366FF",
        opacity: 0.8,
        letterSpacing: 1,
        baselineShift: 3,
        decoration: "underline",
      },
    });
    expect(
      first.fragments.some((fragment) => fragment.style.fontSize === 24),
    ).toBe(true);
  });

  it("supports character wrapping and explicit newlines", () => {
    const input = node();
    input.text = "ABCD\nEFGH";
    input.spans = [{ id: "all", start: 0, end: 9, style: {} }];
    input.textBox.width = 36;
    input.transform.width = 36;
    input.textBox.wrapping = "character";
    const layout = layoutRichTextNode(
      input,
      (fontId) => `ADR_${fontId}`,
      measure,
    );
    expect(layout.lines).toBeGreaterThanOrEqual(4);
    expect(layout.fragments.map((fragment) => fragment.text).join("")).toBe(
      "ABCDEFGH",
    );
  });
});
