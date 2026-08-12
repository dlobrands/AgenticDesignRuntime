import { CanvasTextMetrics, TextStyle, type TextStyleOptions } from "pixi.js";
import {
  effectiveTextSpans,
  type TextNode,
  type TextSpan,
  type TextSpanStyle,
} from "@agentic-design/core";

export type ResolvedTextSpanStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  color: string;
  opacity: number;
  letterSpacing: number;
  baselineShift: number;
  decoration: "none" | "underline" | "lineThrough";
};

export type RichTextFragment = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: ResolvedTextSpanStyle;
};

export type RichTextLayout = {
  width: number;
  height: number;
  lines: number;
  fragments: RichTextFragment[];
};

type MeasuredPiece = {
  text: string;
  width: number;
  height: number;
  style: ResolvedTextSpanStyle;
  whitespace: boolean;
};

type Token = {
  pieces: MeasuredPiece[];
  width: number;
  newline: boolean;
  whitespace: boolean;
};

type Line = {
  pieces: MeasuredPiece[];
  width: number;
  height: number;
};

export type RichTextMeasurer = (
  text: string,
  style: ResolvedTextSpanStyle,
) => { width: number; height: number };

const spanAt = (spans: readonly TextSpan[], offset: number): TextSpan =>
  spans.find((span) => offset >= span.start && offset < span.end) ??
  spans.at(-1)!;

const resolveStyle = (
  node: TextNode,
  style: TextSpanStyle,
  fontFamily: (fontId: string) => string,
): ResolvedTextSpanStyle => ({
  fontFamily: fontFamily(style.fontId ?? node.typography.fontId),
  fontSize: style.fontSize ?? node.typography.fontSize,
  fontWeight: style.fontWeight ?? node.typography.fontWeight,
  fontStyle: style.fontStyle ?? node.typography.fontStyle,
  color: style.color ?? node.typography.color,
  opacity: style.opacity ?? node.typography.opacity,
  letterSpacing: style.letterSpacing ?? node.typography.letterSpacing,
  baselineShift: style.baselineShift ?? 0,
  decoration: style.decoration ?? "none",
});

export const richTextStyleOptions = (
  style: ResolvedTextSpanStyle,
): TextStyleOptions => ({
  fontFamily: style.fontFamily,
  fontSize: style.fontSize,
  fontWeight: String(style.fontWeight) as "normal",
  fontStyle: style.fontStyle,
  letterSpacing: style.letterSpacing,
  fill: style.color,
  whiteSpace: "pre",
});

const measurePiece = (
  text: string,
  style: ResolvedTextSpanStyle,
  measure: RichTextMeasurer,
): MeasuredPiece => {
  const metrics = measure(text.length > 0 ? text : " ", style);
  return {
    text,
    width: text.length > 0 ? metrics.width : 0,
    height: Math.max(style.fontSize, metrics.height),
    style,
    whitespace: /^\s+$/.test(text) && !text.includes("\n"),
  };
};

const rangesForText = (
  text: string,
  wrapping: TextNode["textBox"]["wrapping"],
): Array<{ start: number; end: number; newline: boolean }> => {
  if (wrapping === "character") {
    const result: Array<{ start: number; end: number; newline: boolean }> = [];
    let offset = 0;
    for (const character of text) {
      result.push({
        start: offset,
        end: offset + character.length,
        newline: character === "\n",
      });
      offset += character.length;
    }
    return result;
  }
  const result: Array<{ start: number; end: number; newline: boolean }> = [];
  const pattern = /\n|[^\S\n]+|[^\s]+/gu;
  for (const match of text.matchAll(pattern))
    result.push({
      start: match.index,
      end: match.index + match[0].length,
      newline: match[0] === "\n",
    });
  return result;
};

const tokensForNode = (
  node: TextNode,
  fontFamily: (fontId: string) => string,
  measure: RichTextMeasurer,
): Token[] => {
  const spans = effectiveTextSpans(node);
  return rangesForText(node.text, node.textBox.wrapping).map((range) => {
    if (range.newline)
      return { pieces: [], width: 0, newline: true, whitespace: false };
    const pieces: MeasuredPiece[] = [];
    let offset = range.start;
    while (offset < range.end) {
      const span = spanAt(spans, offset);
      const end = Math.min(range.end, span.end);
      pieces.push(
        measurePiece(
          node.text.slice(offset, end),
          resolveStyle(node, span.style, fontFamily),
          measure,
        ),
      );
      offset = end;
    }
    return {
      pieces,
      width: pieces.reduce((sum, piece) => sum + piece.width, 0),
      newline: false,
      whitespace: pieces.every((piece) => piece.whitespace),
    };
  });
};

const linesForNode = (
  node: TextNode,
  fontFamily: (fontId: string) => string,
  measure: RichTextMeasurer,
): Line[] => {
  const lines: Line[] = [];
  let line: Line = { pieces: [], width: 0, height: node.typography.lineHeight };
  const finish = () => {
    lines.push(line);
    line = { pieces: [], width: 0, height: node.typography.lineHeight };
  };
  for (const token of tokensForNode(node, fontFamily, measure)) {
    if (token.newline) {
      finish();
      continue;
    }
    const wraps =
      node.textBox.wrapping !== "none" &&
      line.pieces.length > 0 &&
      line.width + token.width > node.textBox.width;
    if (wraps) finish();
    line.pieces.push(...token.pieces);
    line.width += token.width;
    line.height = Math.max(
      line.height,
      ...token.pieces.map(
        (piece) => piece.height + Math.abs(piece.style.baselineShift),
      ),
    );
  }
  if (line.pieces.length > 0 || lines.length === 0 || node.text.endsWith("\n"))
    finish();
  return lines;
};

export const layoutRichTextNode = (
  node: TextNode,
  fontFamily: (fontId: string) => string,
  measure: RichTextMeasurer = (text, style) => {
    const metrics = CanvasTextMetrics.measureText(
      text,
      new TextStyle(richTextStyleOptions(style)),
    );
    return { width: metrics.width, height: metrics.height };
  },
): RichTextLayout => {
  if (!node.spans?.length)
    throw new Error("Rich-text layout requires explicit text spans.");
  const lines = linesForNode(node, fontFamily, measure);
  const width = Math.max(0, ...lines.map((line) => line.width));
  const height = lines.reduce((sum, line) => sum + line.height, 0);
  const fragments: RichTextFragment[] = [];
  let y = 0;
  lines.forEach((line, lineIndex) => {
    const available = Math.max(0, node.textBox.width - line.width);
    const alignOffset =
      node.typography.alignment === "center"
        ? available / 2
        : node.typography.alignment === "right"
          ? available
          : 0;
    const justify =
      node.typography.alignment === "justify" && lineIndex < lines.length - 1
        ? line.pieces.filter((piece) => piece.whitespace).length
        : 0;
    const justifyGap = justify > 0 ? available / justify : 0;
    let x = alignOffset;
    for (const piece of line.pieces) {
      fragments.push({
        text: piece.text,
        x,
        y:
          y +
          Math.max(0, (line.height - piece.height) / 2) -
          piece.style.baselineShift,
        width: piece.width,
        height: piece.height,
        style: piece.style,
      });
      x += piece.width + (piece.whitespace ? justifyGap : 0);
    }
    y += line.height;
  });
  return { width, height, lines: lines.length, fragments };
};
