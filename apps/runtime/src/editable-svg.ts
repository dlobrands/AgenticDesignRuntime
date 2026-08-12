import type {
  ShapeFill,
  Stroke,
  VectorPathCommand,
} from "@tva-agentic-design/core";

export type EditableSvgVector = {
  commands: VectorPathCommand[];
  fill?: ShapeFill;
  stroke?: Stroke;
};

type Point = { x: number; y: number };

const numberToken = "[-+]?(?:\\d*\\.\\d+|\\d+\\.?)(?:[eE][-+]?\\d+)?";
const tokenPattern = new RegExp(`[a-zA-Z]|${numberToken}`, "g");

const tokenizePath = (source: string): Array<string | number> | undefined => {
  const tokens: Array<string | number> = [];
  let cursor = 0;
  for (const match of source.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (!/^[\s,]*$/.test(source.slice(cursor, index))) return undefined;
    const token = match[0];
    tokens.push(/^[a-zA-Z]$/.test(token) ? token : Number(token));
    cursor = index + token.length;
  }
  if (!/^[\s,]*$/.test(source.slice(cursor))) return undefined;
  return tokens.length > 0 &&
    tokens.every((token) => typeof token === "string" || Number.isFinite(token))
    ? tokens
    : undefined;
};

const normalizePoint = (
  point: Point,
  viewBox: { x: number; y: number; width: number; height: number },
): Point | undefined => {
  const normalized = {
    x: (point.x - viewBox.x) / viewBox.width,
    y: (point.y - viewBox.y) / viewBox.height,
  };
  return normalized.x >= 0 &&
    normalized.x <= 1 &&
    normalized.y >= 0 &&
    normalized.y <= 1
    ? normalized
    : undefined;
};

const parseCommands = (
  source: string,
  viewBox: { x: number; y: number; width: number; height: number },
): VectorPathCommand[] | undefined => {
  const tokens = tokenizePath(source);
  if (!tokens) return undefined;
  const commands: VectorPathCommand[] = [];
  let index = 0;
  let activeCommand: string | undefined;
  let current: Point = { x: 0, y: 0 };
  let subpathStart: Point | undefined;
  const number = (): number | undefined => {
    const token = tokens[index];
    if (typeof token !== "number") return undefined;
    index += 1;
    return token;
  };
  const point = (relative: boolean): Point | undefined => {
    const x = number();
    const y = number();
    if (x === undefined || y === undefined) return undefined;
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };
  while (index < tokens.length) {
    const token = tokens[index];
    if (typeof token === "string") {
      if (!/[mMlLcCzZ]/.test(token)) return undefined;
      activeCommand = token;
      index += 1;
    }
    if (!activeCommand) return undefined;
    const relative = activeCommand === activeCommand.toLowerCase();
    const kind = activeCommand.toLowerCase();
    if (kind === "z") {
      if (!subpathStart || typeof token !== "string") return undefined;
      commands.push({ id: `path-${commands.length + 1}`, kind: "close" });
      current = subpathStart;
      subpathStart = undefined;
      activeCommand = undefined;
      continue;
    }
    if (kind === "m" || kind === "l") {
      const target = point(relative);
      if (!target) return undefined;
      const normalized = normalizePoint(target, viewBox);
      if (!normalized) return undefined;
      const isMove = kind === "m";
      commands.push({
        id: `path-${commands.length + 1}`,
        kind: isMove ? "move" : "line",
        to: normalized,
      });
      current = target;
      if (isMove) {
        subpathStart = target;
        activeCommand = relative ? "l" : "L";
      }
      continue;
    }
    const control1 = point(relative);
    const control2 = point(relative);
    const target = point(relative);
    if (!control1 || !control2 || !target) return undefined;
    const normalizedControl1 = normalizePoint(control1, viewBox);
    const normalizedControl2 = normalizePoint(control2, viewBox);
    const normalizedTarget = normalizePoint(target, viewBox);
    if (!normalizedControl1 || !normalizedControl2 || !normalizedTarget)
      return undefined;
    commands.push({
      id: `path-${commands.length + 1}`,
      kind: "cubic",
      control1: normalizedControl1,
      control2: normalizedControl2,
      to: normalizedTarget,
    });
    current = target;
  }
  return commands.length >= 2 &&
    commands.some((command) => command.kind !== "move")
    ? commands
    : undefined;
};

const numberAttribute = (
  value: string | undefined,
  fallback: number,
): number | undefined => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const color = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short?.[1])
    return `#${[...short[1]].map((part) => part.repeat(2)).join("")}`.toUpperCase();
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : undefined;
};

export const editableSvgVector = (input: {
  pathData: string;
  pathAttributes: Record<string, string>;
  rootAttributes: Record<string, string>;
  viewBox: { x: number; y: number; width: number; height: number };
}): EditableSvgVector | undefined => {
  const attributes = { ...input.rootAttributes, ...input.pathAttributes };
  if (
    attributes.transform ||
    attributes.style ||
    attributes["clip-path"] ||
    attributes.mask ||
    attributes.filter ||
    attributes["fill-rule"] === "evenodd" ||
    attributes["vector-effect"]
  )
    return undefined;
  const commands = parseCommands(input.pathData, input.viewBox);
  if (!commands) return undefined;
  const opacity = numberAttribute(attributes.opacity, 1);
  const fillOpacity = numberAttribute(attributes["fill-opacity"], 1);
  const strokeOpacity = numberAttribute(attributes["stroke-opacity"], 1);
  if (
    opacity === undefined ||
    fillOpacity === undefined ||
    strokeOpacity === undefined ||
    opacity < 0 ||
    opacity > 1 ||
    fillOpacity < 0 ||
    fillOpacity > 1 ||
    strokeOpacity < 0 ||
    strokeOpacity > 1
  )
    return undefined;
  const fillValue = attributes.fill ?? "#000000";
  const fillColor = fillValue === "none" ? undefined : color(fillValue);
  if (fillValue !== "none" && !fillColor) return undefined;
  const fill: ShapeFill | undefined = fillColor
    ? { type: "solid", color: fillColor, opacity: opacity * fillOpacity }
    : undefined;
  const strokeValue = attributes.stroke ?? "none";
  const strokeColor = strokeValue === "none" ? undefined : color(strokeValue);
  if (strokeValue !== "none" && !strokeColor) return undefined;
  const strokeWidth = numberAttribute(attributes["stroke-width"], 1);
  if (strokeWidth === undefined || strokeWidth < 0) return undefined;
  const rawDashValues = attributes["stroke-dasharray"]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    rawDashValues &&
    (rawDashValues.length === 0 ||
      rawDashValues.some((value) => !Number.isFinite(value) || value <= 0))
  )
    return undefined;
  const dashValues =
    rawDashValues && rawDashValues.length % 2 === 1
      ? [...rawDashValues, ...rawDashValues]
      : rawDashValues;
  if (dashValues && (dashValues.length < 2 || dashValues.length > 16))
    return undefined;
  const dashOffset = numberAttribute(attributes["stroke-dashoffset"], 0);
  if (dashOffset === undefined) return undefined;
  const cap = attributes["stroke-linecap"] ?? "butt";
  if (
    !(["butt", "round", "square"] as const).includes(
      cap as "butt" | "round" | "square",
    )
  )
    return undefined;
  const stroke: Stroke | undefined = strokeColor
    ? {
        enabled: true,
        width: strokeWidth,
        alignment: "center",
        opacity: opacity * strokeOpacity,
        paint: { type: "solid", color: strokeColor, opacity: 1 },
        ...(dashValues && dashValues.some((value) => value > 0)
          ? {
              dash: {
                values: dashValues,
                offset: dashOffset,
                cap: cap as "butt" | "round" | "square",
              },
            }
          : {}),
      }
    : undefined;
  return fill || stroke
    ? { commands, ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) }
    : undefined;
};
