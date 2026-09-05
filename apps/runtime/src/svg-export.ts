import {
  effectItems,
  listNodes,
  type FontRecord,
  type FrameDocument,
  type SceneNode,
  type ShapeFill,
  type Stroke,
  type VectorPathCommand,
} from "@tva-agentic-design/core";

export type SvgDocumentResult = {
  source: string;
  rasterizedNodeIds: string[];
  fullyRasterized: boolean;
};

const xml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const transform = (node: SceneNode): string => {
  const value = node.transform;
  const anchorX = value.anchorX * value.width;
  const anchorY = value.anchorY * value.height;
  return [
    `translate(${value.x} ${value.y})`,
    `translate(${anchorX} ${anchorY})`,
    `rotate(${value.rotation})`,
    `skewX(${value.skewX})`,
    `skewY(${value.skewY})`,
    `scale(${value.scaleX} ${value.scaleY})`,
    `translate(${-anchorX} ${-anchorY})`,
  ].join(" ");
};

const solidPaint = (paint: ShapeFill | undefined): string | undefined =>
  paint?.type === "solid" ? paint.color : undefined;

const strokeAttributes = (stroke: Stroke | undefined): string => {
  if (!stroke?.enabled || stroke.paint.type !== "solid") return 'stroke="none"';
  const dash = stroke.dash
    ? ` stroke-dasharray="${stroke.dash.values.join(" ")}" stroke-dashoffset="${stroke.dash.offset}" stroke-linecap="${stroke.dash.cap}"`
    : "";
  return `stroke="${stroke.paint.color}" stroke-width="${stroke.width}" stroke-opacity="${stroke.opacity * stroke.paint.opacity}"${dash}`;
};

const pathData = (
  commands: readonly VectorPathCommand[],
  width: number,
  height: number,
): string =>
  commands
    .map((command) => {
      if (command.kind === "close") return "Z";
      const end = `${command.to.x * width} ${command.to.y * height}`;
      if (command.kind === "move") return `M ${end}`;
      if (command.kind === "line") return `L ${end}`;
      if (command.kind === "quadratic")
        return `Q ${command.control.x * width} ${command.control.y * height} ${end}`;
      if (command.kind === "cubic")
        return `C ${command.control1.x * width} ${command.control1.y * height} ${command.control2.x * width} ${command.control2.y * height} ${end}`;
      return `A ${command.radius.x * width} ${command.radius.y * height} ${command.rotation} ${command.largeArc ? 1 : 0} ${command.sweep ? 1 : 0} ${end}`;
    })
    .join(" ");

export const isVectorSafeNode = (node: SceneNode): boolean => {
  if (!node.visible) return false;
  if (["rasterImage", "svg", "mask", "adjustment"].includes(node.type))
    return false;
  if (
    "effects" in node &&
    effectItems(node.effects).some((effect) => effect.enabled)
  )
    return false;
  if (
    "blendMode" in node &&
    !["normal", "pass-through"].includes(node.blendMode)
  )
    return false;
  if (
    node.type === "text" &&
    (node.spans?.length || node.textBox.wrapping !== "none")
  )
    return false;
  if (
    (node.type === "rectangle" ||
      node.type === "ellipse" ||
      node.type === "vectorPath") &&
    ((node.fill && !solidPaint(node.fill)) ||
      (node.stroke?.enabled && node.stroke.paint.type !== "solid"))
  )
    return false;
  if (node.type === "group")
    return node.children.every(
      (child) => !child.visible || isVectorSafeNode(child),
    );
  return true;
};

export const hybridRasterBoundary = (frame: FrameDocument): number => {
  let boundary = -1;
  frame.root.children.forEach((node, index) => {
    if (node.visible && !isVectorSafeNode(node)) boundary = index;
  });
  return boundary;
};

const subtreeIds = (node: SceneNode): string[] => [
  node.id,
  ...(node.type === "group" || node.type === "mask"
    ? node.children.flatMap(subtreeIds)
    : []),
  ...(node.type === "mask" ? subtreeIds(node.maskSource) : []),
];

const serializeNode = (
  node: SceneNode,
  fonts: readonly FontRecord[],
): string => {
  if (!node.visible) return "";
  const opacity = "opacity" in node ? node.opacity : 1;
  const open = `<g id="${xml(node.id)}" aria-label="${xml(node.name)}" transform="${transform(node)}" opacity="${opacity}">`;
  if (node.type === "group")
    return `${open}${node.children.map((child) => serializeNode(child, fonts)).join("")}</g>`;
  if (node.type === "rectangle") {
    const radii = Object.values(node.cornerRadius);
    const radius = radii.every((value) => value === radii[0]) ? radii[0]! : 0;
    return `${open}<rect width="${node.transform.width}" height="${node.transform.height}" rx="${radius}" fill="${solidPaint(node.fill) ?? "none"}" fill-opacity="${(node.fill.type === "solid" ? node.fill.opacity : 1) * (node.fillOpacity ?? 1)}" ${strokeAttributes(node.stroke)}/></g>`;
  }
  if (node.type === "ellipse")
    return `${open}<ellipse cx="${node.transform.width / 2}" cy="${node.transform.height / 2}" rx="${node.transform.width / 2}" ry="${node.transform.height / 2}" fill="${solidPaint(node.fill) ?? "none"}" fill-opacity="${(node.fill.type === "solid" ? node.fill.opacity : 1) * (node.fillOpacity ?? 1)}" ${strokeAttributes(node.stroke)}/></g>`;
  if (node.type === "vectorPath")
    return `${open}<path d="${pathData(node.commands, node.transform.width, node.transform.height)}" fill="${solidPaint(node.fill) ?? "none"}" fill-opacity="${(node.fill?.type === "solid" ? node.fill.opacity : 1) * (node.fillOpacity ?? 1)}" fill-rule="${node.fillRule ?? "nonzero"}" ${strokeAttributes(node.stroke)}/></g>`;
  if (node.type === "text") {
    const family =
      fonts.find((font) => font.id === node.typography.fontId)?.family ??
      "sans-serif";
    const lines = node.text.split("\n");
    const direction =
      node.typography.direction === "rtl" ||
      (node.typography.direction !== "ltr" &&
        /[\u0590-\u08FF]/u.test(node.text))
        ? "rtl"
        : "ltr";
    return `${open}<text x="0" y="${node.typography.fontSize}" direction="${direction}"${node.typography.language ? ` lang="${xml(node.typography.language)}"` : ""} font-family="${xml(family)}" font-size="${node.typography.fontSize}" font-weight="${node.typography.fontWeight}" font-style="${node.typography.fontStyle}" letter-spacing="${node.typography.letterSpacing}" fill="${node.typography.color}" fill-opacity="${node.typography.opacity * (node.fillOpacity ?? 1)}" text-anchor="${node.typography.alignment === "center" ? "middle" : node.typography.alignment === "right" || direction === "rtl" ? "end" : "start"}">${lines
      .map(
        (line, index) =>
          `<tspan x="0" dy="${index === 0 ? 0 : node.typography.lineHeight}">${xml(line)}</tspan>`,
      )
      .join("")}</text></g>`;
  }
  return "";
};

const root = (
  frame: FrameDocument,
  contents: string,
  metadata: string,
): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${frame.canvas.width}" height="${frame.canvas.height}" viewBox="0 0 ${frame.canvas.width} ${frame.canvas.height}" role="img" aria-label="${xml(frame.name)}">${metadata}${
    frame.canvas.background.type === "solid"
      ? `<rect width="100%" height="100%" fill="${frame.canvas.background.color}" fill-opacity="${frame.canvas.background.opacity}"/>`
      : ""
  }${contents}</svg>\n`;

export const exportVectorSvg = (
  frame: FrameDocument,
  fonts: readonly FontRecord[],
): SvgDocumentResult => {
  const unsupported = listNodes(frame)
    .filter((node) => node.visible && !isVectorSafeNode(node))
    .map((node) => node.id);
  if (unsupported.length)
    throw new Error(`SVG_VECTOR_ONLY_UNSUPPORTED: ${unsupported.join(", ")}`);
  return {
    source: root(
      frame,
      frame.root.children.map((node) => serializeNode(node, fonts)).join(""),
      '<metadata data-adr-svg-mode="vectorOnly"/>',
    ),
    rasterizedNodeIds: [],
    fullyRasterized: false,
  };
};

export const exportHybridSvg = (
  frame: FrameDocument,
  pngDataUrl: string,
  rasterBoundary = frame.root.children.length - 1,
): SvgDocumentResult => {
  if (rasterBoundary < 0) return exportVectorSvg(frame, []);
  const rasterizedNodeIds = frame.root.children
    .slice(0, rasterBoundary + 1)
    .filter((node) => node.visible)
    .flatMap(subtreeIds);
  const nativeContents = frame.root.children
    .slice(rasterBoundary + 1)
    .map((node) => serializeNode(node, []))
    .join("");
  const fullyRasterized =
    rasterBoundary >= frame.root.children.length - 1 || !nativeContents;
  return {
    source: root(
      frame,
      `<image href="${pngDataUrl}" width="${frame.canvas.width}" height="${frame.canvas.height}"/>${nativeContents}`,
      `<metadata data-adr-svg-mode="hybrid" data-fully-rasterized="${fullyRasterized}" data-rasterized-node-ids="${xml(rasterizedNodeIds.join(" "))}"/>`,
    ),
    rasterizedNodeIds,
    fullyRasterized,
  };
};
