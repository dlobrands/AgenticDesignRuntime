import { stableStringify } from "./canonical.js";
import type { TextNode, TextSpan, TextSpanStyle } from "./model.js";

const sameStyle = (left: TextSpanStyle, right: TextSpanStyle): boolean =>
  stableStringify(left) === stableStringify(right);

const portableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const derivedSpanId = (
  nodeId: string,
  sourceId: string | undefined,
  start: number,
  end: number,
): string =>
  `${nodeId}:span:${portableHash(sourceId ?? "base")}:${start}:${end}`;

export const effectiveTextSpans = (
  node: Pick<TextNode, "id" | "text" | "spans">,
): TextSpan[] => {
  if (node.text.length === 0) return [];
  if (node.spans?.length) return structuredClone(node.spans);
  return [
    {
      id: derivedSpanId(node.id, undefined, 0, node.text.length),
      start: 0,
      end: node.text.length,
      style: {},
    },
  ];
};

const sourceSpanAt = (
  spans: readonly TextSpan[],
  index: number,
): TextSpan | undefined =>
  spans.find((span) => index >= span.start && index < span.end) ?? spans.at(-1);

const compressStyles = (
  nodeId: string,
  styles: Array<{ style: TextSpanStyle; sourceId?: string }>,
): TextSpan[] => {
  const spans: TextSpan[] = [];
  const usedIds = new Set<string>();
  styles.forEach((entry, index) => {
    const previous = spans.at(-1);
    if (previous && sameStyle(previous.style, entry.style)) {
      previous.end = index + 1;
      return;
    }
    const id =
      entry.sourceId && !usedIds.has(entry.sourceId)
        ? entry.sourceId
        : derivedSpanId(nodeId, entry.sourceId, index, index + 1);
    usedIds.add(id);
    spans.push({
      id,
      start: index,
      end: index + 1,
      style: structuredClone(entry.style),
    });
  });
  return spans;
};

const commonPrefixLength = (left: string, right: string): number => {
  let index = 0;
  while (
    index < left.length &&
    index < right.length &&
    left[index] === right[index]
  )
    index += 1;
  if (
    index > 0 &&
    index < left.length &&
    /[\uD800-\uDBFF]/.test(left[index - 1]!)
  )
    index -= 1;
  return index;
};

const commonSuffixLength = (
  left: string,
  right: string,
  prefixLength: number,
): number => {
  let length = 0;
  while (
    length < left.length - prefixLength &&
    length < right.length - prefixLength &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  )
    length += 1;
  if (
    length > 0 &&
    length < left.length &&
    /[\uDC00-\uDFFF]/.test(left[left.length - length]!)
  )
    length -= 1;
  return length;
};

/**
 * Preserves styles across a plain-text replacement by applying the smallest
 * common-prefix/common-suffix edit. Textarea selection offsets and these
 * ranges both use UTF-16 code units.
 */
export const reconcileTextSpans = (input: {
  nodeId: string;
  previousText: string;
  nextText: string;
  spans: readonly TextSpan[];
}): TextSpan[] | undefined => {
  if (input.nextText.length === 0) return undefined;
  if (input.spans.length === 0) return undefined;
  const prefix = commonPrefixLength(input.previousText, input.nextText);
  const suffix = commonSuffixLength(input.previousText, input.nextText, prefix);
  const nextSuffixStart = input.nextText.length - suffix;
  const previousSuffixStart = input.previousText.length - suffix;
  const insertionSource =
    sourceSpanAt(input.spans, Math.max(0, prefix - 1)) ?? input.spans[0];
  const styles: Array<{ style: TextSpanStyle; sourceId?: string }> = [];
  for (let index = 0; index < input.nextText.length; index += 1) {
    const previousIndex =
      index < prefix
        ? index
        : index >= nextSuffixStart
          ? previousSuffixStart + index - nextSuffixStart
          : undefined;
    const source =
      previousIndex === undefined
        ? insertionSource
        : sourceSpanAt(input.spans, previousIndex);
    styles.push({
      style: structuredClone(source?.style ?? {}),
      ...(source ? { sourceId: source.id } : {}),
    });
  }
  return compressStyles(input.nodeId, styles);
};

export const applyTextSpanStyle = (input: {
  node: Pick<TextNode, "id" | "text" | "spans">;
  start: number;
  end: number;
  style: TextSpanStyle;
}): TextSpan[] => {
  if (
    input.start < 0 ||
    input.end > input.node.text.length ||
    input.start >= input.end
  )
    throw new RangeError("Rich-text selection must be a non-empty text range.");
  const spans = effectiveTextSpans(input.node);
  const styles: Array<{ style: TextSpanStyle; sourceId?: string }> = [];
  for (let index = 0; index < input.node.text.length; index += 1) {
    const source = sourceSpanAt(spans, index);
    styles.push({
      style:
        index >= input.start && index < input.end
          ? { ...(source?.style ?? {}), ...input.style }
          : structuredClone(source?.style ?? {}),
      ...(source ? { sourceId: source.id } : {}),
    });
  }
  return compressStyles(input.node.id, styles);
};
