import type { FrameOperation } from "./operations.js";
import type { FrameDocument, SceneNode } from "./model.js";
import { findNode, findNodeLocation } from "./scene.js";
import { getNodeWorldMatrix, getParentWorldMatrix } from "./scene.js";
import { invertMatrix, matrixBounds, transformPoint } from "./transform.js";
import { RuntimeError } from "./errors.js";

export type ArrangeAction =
  | "align-left"
  | "align-center-x"
  | "align-right"
  | "align-top"
  | "align-center-y"
  | "align-bottom"
  | "distribute-horizontal"
  | "distribute-vertical";

export type ArrangeReference = "selection" | "canvas" | "key";

type Bounds = { x: number; y: number; width: number; height: number };

const boundsFor = (frame: FrameDocument, node: SceneNode): Bounds =>
  matrixBounds(
    getNodeWorldMatrix(frame, node.id),
    node.transform.width,
    node.transform.height,
  );

const unionBounds = (bounds: Bounds[]): Bounds => {
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const canvasDeltaToParent = (
  frame: FrameDocument,
  nodeId: string,
  delta: { x: number; y: number },
) => {
  const location = findNodeLocation(frame, nodeId);
  if (!location)
    throw new RuntimeError("NODE_NOT_FOUND", `Node ${nodeId} was not found.`);
  const inverse = invertMatrix(getParentWorldMatrix(frame, location.parentId));
  const origin = transformPoint(inverse, { x: 0, y: 0 });
  const target = transformPoint(inverse, delta);
  return { x: target.x - origin.x, y: target.y - origin.y };
};

export const compileArrangeOperations = (input: {
  frame: FrameDocument;
  nodeIds: readonly string[];
  action: ArrangeAction;
  relativeTo?: ArrangeReference;
  keyNodeId?: string;
}): FrameOperation[] => {
  const uniqueIds = [...new Set(input.nodeIds)];
  const nodes = uniqueIds.map((nodeId) => {
    const node = findNode(input.frame, nodeId);
    if (!node || node.type === "adjustment")
      throw new RuntimeError(
        "NODE_NOT_FOUND",
        `Arrange target ${nodeId} is not a movable layer.`,
      );
    return node;
  });
  const distribute = input.action.startsWith("distribute-");
  const relativeTo = input.relativeTo ?? "selection";
  if (nodes.length < (distribute ? 3 : relativeTo === "canvas" ? 1 : 2))
    throw new RuntimeError(
      "INVALID_OPERATION",
      distribute
        ? "Distribution requires at least three layers."
        : "This alignment reference requires at least two layers.",
    );
  const keyNode =
    relativeTo === "key"
      ? nodes.find((node) => node.id === input.keyNodeId)
      : undefined;
  if (relativeTo === "key" && !keyNode)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Key alignment requires keyNodeId to identify one selected layer.",
    );
  const moving = keyNode
    ? nodes.filter((node) => node.id !== keyNode.id)
    : nodes;
  const locked = moving.find((node) => node.locked);
  if (locked)
    throw new RuntimeError(
      "NODE_LOCKED",
      `Unlock ${locked.name} before arranging this selection.`,
      { nodeId: locked.id },
    );

  const entries = nodes.map((node) => ({
    node,
    bounds: boundsFor(input.frame, node),
  }));
  if (distribute) {
    const horizontal = input.action === "distribute-horizontal";
    const position = horizontal ? "x" : "y";
    const size = horizontal ? "width" : "height";
    const ordered = [...entries].sort(
      (left, right) => left.bounds[position] - right.bounds[position],
    );
    const start = ordered[0]!.bounds[position];
    const end = ordered.at(-1)!.bounds[position] + ordered.at(-1)!.bounds[size];
    const occupied = ordered.reduce(
      (sum, entry) => sum + entry.bounds[size],
      0,
    );
    const gap = (end - start - occupied) / (ordered.length - 1);
    let cursor = start;
    return ordered.flatMap(({ node, bounds }, index) => {
      const desired = cursor;
      cursor += bounds[size] + gap;
      if (index === 0 || index === ordered.length - 1) return [];
      const worldDelta = horizontal
        ? { x: desired - bounds.x, y: 0 }
        : { x: 0, y: desired - bounds.y };
      const delta = canvasDeltaToParent(input.frame, node.id, worldDelta);
      return [
        {
          kind: "updateNode" as const,
          nodeId: node.id,
          propertyGroup: "transform" as const,
          value: {
            x: node.transform.x + delta.x,
            y: node.transform.y + delta.y,
          },
        },
      ];
    });
  }

  const reference =
    relativeTo === "canvas"
      ? {
          x: 0,
          y: 0,
          width: input.frame.canvas.width,
          height: input.frame.canvas.height,
        }
      : relativeTo === "key"
        ? boundsFor(input.frame, keyNode!)
        : unionBounds(entries.map((entry) => entry.bounds));
  return moving.map((node) => {
    const bounds = boundsFor(input.frame, node);
    const worldDelta =
      input.action === "align-left"
        ? { x: reference.x - bounds.x, y: 0 }
        : input.action === "align-center-x"
          ? {
              x:
                reference.x +
                reference.width / 2 -
                (bounds.x + bounds.width / 2),
              y: 0,
            }
          : input.action === "align-right"
            ? {
                x: reference.x + reference.width - (bounds.x + bounds.width),
                y: 0,
              }
            : input.action === "align-top"
              ? { x: 0, y: reference.y - bounds.y }
              : input.action === "align-center-y"
                ? {
                    x: 0,
                    y:
                      reference.y +
                      reference.height / 2 -
                      (bounds.y + bounds.height / 2),
                  }
                : {
                    x: 0,
                    y:
                      reference.y +
                      reference.height -
                      (bounds.y + bounds.height),
                  };
    const delta = canvasDeltaToParent(input.frame, node.id, worldDelta);
    return {
      kind: "updateNode" as const,
      nodeId: node.id,
      propertyGroup: "transform" as const,
      value: { x: node.transform.x + delta.x, y: node.transform.y + delta.y },
    };
  });
};
