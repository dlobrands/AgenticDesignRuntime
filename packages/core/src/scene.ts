import type {
  AdjustmentNode,
  FrameDocument,
  GroupNode,
  MaskNode,
  RootGroup,
  SceneNode,
} from "./model.js";
import { RuntimeError } from "./errors.js";
import {
  IDENTITY_MATRIX,
  invertMatrix,
  matrixFromTransform,
  multiplyMatrices,
  transformFromMatrix,
  type Matrix2D,
} from "./transform.js";

export type SceneContainer = RootGroup | GroupNode | MaskNode;
export type NodeLocation = {
  node: SceneNode;
  parent: SceneContainer;
  parentId: string;
  index: number;
  depth: number;
  locationKind: "child" | "maskSource";
};

export type SceneVisit = NodeLocation & { path: string[] };

export const clone = <T>(value: T): T => structuredClone(value);

export const containerChildren = (container: SceneContainer): SceneNode[] =>
  container.children;

export function* walkScene(frame: FrameDocument): Generator<SceneVisit> {
  function* walk(
    container: SceneContainer,
    depth: number,
    path: string[],
  ): Generator<SceneVisit> {
    for (let index = 0; index < container.children.length; index += 1) {
      const node = container.children[index];
      if (!node) continue;
      const visit: SceneVisit = {
        node,
        parent: container,
        parentId: container.id,
        index,
        depth,
        locationKind: "child",
        path: [...path, node.id],
      };
      yield visit;
      if (node.type === "mask") {
        yield {
          node: node.maskSource,
          parent: node,
          parentId: node.id,
          index: -1,
          depth: depth + 1,
          locationKind: "maskSource",
          path: [...visit.path, "maskSource", node.maskSource.id],
        };
      }
      if (node.type === "group" || node.type === "mask") {
        yield* walk(node, depth + 1, visit.path);
      }
    }
  }
  yield* walk(frame.root, 1, ["root"]);
}

export const listNodes = (frame: FrameDocument): SceneNode[] =>
  [...walkScene(frame)].map((visit) => visit.node);

export const findNodeLocation = (
  frame: FrameDocument,
  nodeId: string,
): NodeLocation | undefined => {
  for (const visit of walkScene(frame))
    if (visit.node.id === nodeId) return visit;
  return undefined;
};

export const requireNodeLocation = (
  frame: FrameDocument,
  nodeId: string,
): NodeLocation => {
  const location = findNodeLocation(frame, nodeId);
  if (!location)
    throw new RuntimeError(
      "NODE_NOT_FOUND",
      `Node ${nodeId} was not found.`,
      { nodeId },
      404,
    );
  return location;
};

export const findNode = (
  frame: FrameDocument,
  nodeId: string,
): SceneNode | undefined =>
  nodeId === "root" ? undefined : findNodeLocation(frame, nodeId)?.node;

export const requireNode = (frame: FrameDocument, nodeId: string): SceneNode =>
  requireNodeLocation(frame, nodeId).node;

export const findContainer = (
  frame: FrameDocument,
  containerId: string,
): SceneContainer | undefined => {
  if (containerId === "root") return frame.root;
  const node = findNode(frame, containerId);
  return node?.type === "group" || node?.type === "mask" ? node : undefined;
};

export const requireContainer = (
  frame: FrameDocument,
  containerId: string,
): SceneContainer => {
  const container = findContainer(frame, containerId);
  if (!container) {
    throw new RuntimeError(
      "INVALID_PARENT",
      `Parent ${containerId} is not a valid container.`,
      { parentId: containerId },
    );
  }
  return container;
};

export const allNodeIds = (frame: FrameDocument): Set<string> =>
  new Set(listNodes(frame).map((node) => node.id));

export const descendantIds = (node: SceneNode): Set<string> => {
  const ids = new Set<string>();
  const visit = (candidate: SceneNode): void => {
    ids.add(candidate.id);
    if (candidate.type === "mask") {
      ids.add(candidate.maskSource.id);
      candidate.children.forEach(visit);
    } else if (candidate.type === "group") {
      candidate.children.forEach(visit);
    }
  };
  visit(node);
  return ids;
};

export const isDescendant = (
  frame: FrameDocument,
  ancestorId: string,
  candidateId: string,
): boolean => {
  const ancestor = findNode(frame, ancestorId);
  return ancestor
    ? descendantIds(ancestor).has(candidateId) && ancestorId !== candidateId
    : false;
};

export const ancestorLocations = (
  frame: FrameDocument,
  nodeId: string,
): NodeLocation[] => {
  const chain: NodeLocation[] = [];
  let current = requireNodeLocation(frame, nodeId);
  chain.unshift(current);
  while (current.parentId !== "root") {
    current = requireNodeLocation(frame, current.parentId);
    chain.unshift(current);
  }
  return chain;
};

export const isLocked = (frame: FrameDocument, nodeId: string): boolean =>
  ancestorLocations(frame, nodeId).some((location) => location.node.locked);

export const assertMutable = (
  frame: FrameDocument,
  nodeId: string,
  allowUnlock = false,
  allowLockedAncestors = false,
): void => {
  const chain = ancestorLocations(frame, nodeId);
  const target = chain.at(-1)?.node;
  const lockedAncestor = chain
    .slice(0, -1)
    .find((location) => location.node.locked);
  if (
    (!allowLockedAncestors && lockedAncestor) ||
    (target?.locked && !allowUnlock)
  ) {
    throw new RuntimeError("NODE_LOCKED", `Node ${nodeId} is locked.`, {
      nodeId,
      lockedBy: lockedAncestor?.node.id ?? target?.id,
    });
  }
};

export const removeAtLocation = (location: NodeLocation): SceneNode => {
  if (location.locationKind === "maskSource") {
    throw new RuntimeError(
      "INVALID_OPERATION",
      "A mask source cannot be removed independently.",
      { nodeId: location.node.id },
    );
  }
  const [removed] = location.parent.children.splice(location.index, 1);
  if (!removed)
    throw new RuntimeError(
      "NODE_NOT_FOUND",
      `Node ${location.node.id} could not be removed.`,
    );
  return removed;
};

export const replaceAtLocation = (
  location: NodeLocation,
  replacement: SceneNode,
): void => {
  if (location.locationKind === "maskSource") {
    if (location.parent.type !== "mask")
      throw new RuntimeError(
        "INVALID_PARENT",
        "Mask-source parent is invalid.",
      );
    location.parent.maskSource = replacement as MaskNode["maskSource"];
    return;
  }
  location.parent.children[location.index] = replacement;
};

export const getParentWorldMatrix = (
  frame: FrameDocument,
  parentId: string,
): Matrix2D => {
  if (parentId === "root") return IDENTITY_MATRIX;
  return getNodeWorldMatrix(frame, parentId);
};

export const getNodeWorldMatrix = (
  frame: FrameDocument,
  nodeId: string,
): Matrix2D => {
  const chain = ancestorLocations(frame, nodeId);
  return chain.reduce(
    (matrix, location) =>
      multiplyMatrices(matrix, matrixFromTransform(location.node.transform)),
    IDENTITY_MATRIX,
  );
};

export const transformForNewParent = (
  frame: FrameDocument,
  node: SceneNode,
  currentParentId: string,
  nextParentId: string,
) => {
  const currentWorld = multiplyMatrices(
    getParentWorldMatrix(frame, currentParentId),
    matrixFromTransform(node.transform),
  );
  const nextLocal = multiplyMatrices(
    invertMatrix(getParentWorldMatrix(frame, nextParentId)),
    currentWorld,
  );
  return transformFromMatrix(nextLocal, node.transform);
};

export const rootAdjustments = (frame: FrameDocument): AdjustmentNode[] =>
  frame.root.children.filter(
    (node): node is AdjustmentNode => node.type === "adjustment",
  );

export const referencedAssetIds = (frame: FrameDocument): Set<string> => {
  const result = new Set<string>();
  for (const node of listNodes(frame)) {
    if (node.type === "rasterImage" || node.type === "svg")
      result.add(node.assetId);
  }
  return result;
};

export const referencedFontIds = (frame: FrameDocument): Set<string> => {
  const result = new Set<string>();
  for (const node of listNodes(frame))
    if (node.type === "text") {
      result.add(node.typography.fontId);
      node.spans?.forEach((span) => {
        if (span.style.fontId) result.add(span.style.fontId);
      });
    }
  return result;
};

export const searchNodes = (
  frame: FrameDocument,
  query: {
    text?: string;
    types?: SceneNode["type"][];
    visible?: boolean;
    locked?: boolean;
  },
): SceneNode[] => {
  const needle = query.text?.trim().toLocaleLowerCase();
  return listNodes(frame).filter((node) => {
    if (needle && !node.name.toLocaleLowerCase().includes(needle)) return false;
    if (query.types && !query.types.includes(node.type)) return false;
    if (query.visible !== undefined && node.visible !== query.visible)
      return false;
    if (query.locked !== undefined && node.locked !== query.locked)
      return false;
    return true;
  });
};
