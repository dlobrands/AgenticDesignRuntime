import type {
  GroupNode,
  LayoutContainer,
  SceneNode,
  Transform,
} from "./model.js";
import type { FrameOperation } from "./operations.js";

export type LayoutContainerCompilation = {
  operations: FrameOperation[];
  warnings: Array<{ code: string; message: string; nodeIds: string[] }>;
};

type Positioned = { node: SceneNode; transform: Partial<Transform> };

const dimensions = (
  node: SceneNode,
  direction: LayoutContainer["direction"],
) =>
  direction === "row"
    ? { main: node.transform.width, cross: node.transform.height }
    : { main: node.transform.height, cross: node.transform.width };

const linePositions = (
  nodes: SceneNode[],
  layout: LayoutContainer,
  mainAvailable: number,
  crossAvailable: number,
  crossOffset: number,
): Positioned[] => {
  const sizes = nodes.map((node) => dimensions(node, layout.direction));
  const baseGap = layout.gap;
  const occupied = sizes.reduce((sum, size) => sum + size.main, 0);
  const spare = Math.max(
    0,
    mainAvailable - occupied - baseGap * Math.max(0, nodes.length - 1),
  );
  const gap =
    layout.distribution === "space-between" && nodes.length > 1
      ? baseGap + spare / (nodes.length - 1)
      : baseGap;
  let cursor =
    layout.distribution === "center"
      ? spare / 2
      : layout.distribution === "end"
        ? spare
        : 0;
  return nodes.map((node, index) => {
    const size = sizes[index]!;
    const cross =
      layout.align === "center"
        ? (crossAvailable - size.cross) / 2
        : layout.align === "end"
          ? crossAvailable - size.cross
          : 0;
    const transform: Partial<Transform> =
      layout.direction === "row"
        ? {
            x: layout.padding.left + cursor,
            y: layout.padding.top + crossOffset + Math.max(0, cross),
            ...(layout.align === "stretch"
              ? { height: Math.max(1, crossAvailable) }
              : {}),
          }
        : {
            x: layout.padding.left + crossOffset + Math.max(0, cross),
            y: layout.padding.top + cursor,
            ...(layout.align === "stretch"
              ? { width: Math.max(1, crossAvailable) }
              : {}),
          };
    cursor += size.main + gap;
    return { node, transform };
  });
};

export const compileLayoutContainer = (
  group: GroupNode,
  layout: LayoutContainer,
): LayoutContainerCompilation => {
  const warnings: LayoutContainerCompilation["warnings"] = [];
  const editable = group.children.filter(
    (node) => node.visible && !node.locked,
  );
  const locked = group.children.filter((node) => node.visible && node.locked);
  if (locked.length)
    warnings.push({
      code: "LAYOUT_LOCKED_CHILD_SKIPPED",
      message: "Locked visible children remain unchanged.",
      nodeIds: locked.map((node) => node.id),
    });
  const mainAvailable = Math.max(
    1,
    layout.direction === "row"
      ? group.transform.width - layout.padding.left - layout.padding.right
      : group.transform.height - layout.padding.top - layout.padding.bottom,
  );
  const crossAvailable = Math.max(
    1,
    layout.direction === "row"
      ? group.transform.height - layout.padding.top - layout.padding.bottom
      : group.transform.width - layout.padding.left - layout.padding.right,
  );
  const lines: SceneNode[][] = [[]];
  if (layout.wrap) {
    let occupied = 0;
    for (const node of editable) {
      const size = dimensions(node, layout.direction).main;
      const next = occupied === 0 ? size : occupied + layout.gap + size;
      if (next > mainAvailable && lines.at(-1)!.length) {
        lines.push([node]);
        occupied = size;
      } else {
        lines.at(-1)!.push(node);
        occupied = next;
      }
    }
  } else lines[0] = editable;
  const lineCross = crossAvailable / Math.max(1, lines.length);
  const positioned = lines.flatMap((line, index) =>
    linePositions(
      line,
      layout,
      mainAvailable,
      Math.max(1, lineCross - (index < lines.length - 1 ? layout.gap : 0)),
      index * lineCross,
    ),
  );
  return {
    operations: [
      {
        kind: "updateNode",
        nodeId: group.id,
        propertyGroup: "layout",
        value: { layout: structuredClone(layout) },
      },
      ...positioned.map(({ node, transform }) => ({
        kind: "updateNode" as const,
        nodeId: node.id,
        propertyGroup: "transform" as const,
        value: transform,
      })),
    ],
    warnings,
  };
};
