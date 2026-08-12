import type {
  FrameDocument,
  FrameResizeStrategy,
  ResizeConstraints,
  SceneNode,
  Transform,
} from "./model.js";
import type { FrameOperation } from "./operations.js";

export const DEFAULT_RESIZE_CONSTRAINTS: ResizeConstraints = {
  horizontal: "left",
  vertical: "top",
};

const positive = (value: number): number => Math.max(1, value);

const resizeAxis = (input: {
  position: number;
  size: number;
  scale: number;
  previousExtent: number;
  nextExtent: number;
  constraint:
    | "left"
    | "center"
    | "right"
    | "top"
    | "middle"
    | "bottom"
    | "stretch"
    | "scale";
}): { position: number; size: number; scale: number } => {
  const delta = input.nextExtent - input.previousExtent;
  switch (input.constraint) {
    case "left":
    case "top":
      return {
        position: input.position,
        size: input.size,
        scale: input.scale,
      };
    case "center":
    case "middle":
      return {
        position: input.position + delta / 2,
        size: input.size,
        scale: input.scale,
      };
    case "right":
    case "bottom":
      return {
        position: input.position + delta,
        size: input.size,
        scale: input.scale,
      };
    case "stretch":
      return {
        position: input.position,
        size: positive(input.size + delta),
        scale: input.scale,
      };
    case "scale": {
      const ratio = input.nextExtent / input.previousExtent;
      return {
        position: input.position * ratio,
        size: input.size,
        scale: input.scale * ratio,
      };
    }
  }
};

export const resizeNodeTransform = (input: {
  transform: Transform;
  previousCanvas: { width: number; height: number };
  nextCanvas: { width: number; height: number };
  strategy: Exclude<FrameResizeStrategy, "canvasOnly">;
  constraints?: ResizeConstraints;
}): Transform => {
  const constraints =
    input.strategy === "scale"
      ? ({ horizontal: "scale", vertical: "scale" } as const)
      : (input.constraints ?? DEFAULT_RESIZE_CONSTRAINTS);
  const horizontal = resizeAxis({
    position: input.transform.x,
    size: input.transform.width,
    scale: input.transform.scaleX,
    previousExtent: input.previousCanvas.width,
    nextExtent: input.nextCanvas.width,
    constraint: constraints.horizontal,
  });
  const vertical = resizeAxis({
    position: input.transform.y,
    size: input.transform.height,
    scale: input.transform.scaleY,
    previousExtent: input.previousCanvas.height,
    nextExtent: input.nextCanvas.height,
    constraint: constraints.vertical,
  });
  return {
    ...input.transform,
    x: horizontal.position,
    y: vertical.position,
    width: horizontal.size,
    height: vertical.size,
    scaleX: horizontal.scale,
    scaleY: vertical.scale,
  };
};

const resizedCanvas = (
  frame: FrameDocument,
  width: number,
  height: number,
): FrameDocument["canvas"] => {
  const canvas = structuredClone(frame.canvas);
  canvas.width = width;
  canvas.height = height;
  if (canvas.guides)
    canvas.guides = canvas.guides.map((guide) => ({
      ...guide,
      position: Math.min(
        guide.position,
        guide.axis === "vertical" ? width : height,
      ),
    }));
  if (canvas.safeArea) {
    const left = Math.min(canvas.safeArea.left, Math.max(0, width - 1));
    const right = Math.min(
      canvas.safeArea.right,
      Math.max(0, width - left - 1),
    );
    const top = Math.min(canvas.safeArea.top, Math.max(0, height - 1));
    const bottom = Math.min(
      canvas.safeArea.bottom,
      Math.max(0, height - top - 1),
    );
    canvas.safeArea = { top, right, bottom, left };
  }
  return canvas;
};

const resizableRootNodes = (frame: FrameDocument): SceneNode[] =>
  frame.root.children.filter((node) => node.type !== "adjustment");

const preserveContainerGeometry = (
  node: SceneNode,
  previous: Transform,
  strategy: FrameResizeStrategy,
): void => {
  if (
    strategy !== "constraints" ||
    (node.type !== "group" && node.type !== "mask")
  )
    return;
  if (node.resizeConstraints?.horizontal === "stretch") {
    node.transform.scaleX *= node.transform.width / previous.width;
    node.transform.width = previous.width;
  }
  if (node.resizeConstraints?.vertical === "stretch") {
    node.transform.scaleY *= node.transform.height / previous.height;
    node.transform.height = previous.height;
  }
};

export const resizeFrameDocument = (input: {
  frame: FrameDocument;
  width: number;
  height: number;
  strategy: FrameResizeStrategy;
}): FrameDocument => {
  const result = structuredClone(input.frame);
  const previousCanvas = {
    width: result.canvas.width,
    height: result.canvas.height,
  };
  result.canvas = resizedCanvas(result, input.width, input.height);
  if (input.strategy === "canvasOnly") return result;
  for (const node of resizableRootNodes(result)) {
    const previousTransform = structuredClone(node.transform);
    node.transform = resizeNodeTransform({
      transform: node.transform,
      previousCanvas,
      nextCanvas: { width: input.width, height: input.height },
      strategy: input.strategy,
      constraints: node.resizeConstraints,
    });
    preserveContainerGeometry(node, previousTransform, input.strategy);
    if (node.type === "text") {
      node.textBox.width = node.transform.width;
      if (node.textBox.mode === "fixed" || node.textBox.mode === "autoHeight")
        node.textBox.height = node.transform.height;
      else delete node.textBox.height;
    }
  }
  return result;
};

const transformPatch = (
  previous: Transform,
  next: Transform,
): Partial<Transform> =>
  Object.fromEntries(
    (Object.keys(next) as (keyof Transform)[])
      .filter((key) => previous[key] !== next[key])
      .map((key) => [key, next[key]]),
  );

export const frameResizeOperations = (input: {
  frame: FrameDocument;
  width: number;
  height: number;
  strategy: FrameResizeStrategy;
}): FrameOperation[] => {
  const resized = resizeFrameDocument(input);
  const operations: FrameOperation[] = [
    {
      kind: "setCanvas",
      value: {
        width: input.width,
        height: input.height,
        ...(input.frame.canvas.guides
          ? { guides: resized.canvas.guides ?? [] }
          : {}),
        ...(input.frame.canvas.safeArea
          ? { safeArea: resized.canvas.safeArea ?? null }
          : {}),
      },
    },
  ];
  if (input.strategy === "canvasOnly") return operations;
  for (const node of resizableRootNodes(input.frame)) {
    const next = resized.root.children.find(
      (candidate) => candidate.id === node.id,
    );
    if (!next) continue;
    const value = transformPatch(node.transform, next.transform);
    if (Object.keys(value).length > 0)
      operations.push({
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "transform",
        value,
      });
  }
  return operations;
};
