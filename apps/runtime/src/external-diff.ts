import {
  RuntimeError,
  stableStringify,
  type FrameDocument,
  type SceneNode,
  type SemanticOperation,
} from "@tva-agentic-design/core";

type NodeInfo = {
  node: SceneNode;
  parentId: string;
  index: number;
  depth: number;
};

const equal = (left: unknown, right: unknown): boolean =>
  stableStringify(left) === stableStringify(right);

const indexScene = (frame: FrameDocument): Map<string, NodeInfo> => {
  const result = new Map<string, NodeInfo>();
  const visit = (
    children: readonly SceneNode[],
    parentId: string,
    depth: number,
  ): void => {
    children.forEach((node, index) => {
      result.set(node.id, { node, parentId, index, depth });
      if (node.type === "group" || node.type === "mask")
        visit(node.children, node.id, depth + 1);
    });
  };
  visit(frame.root.children, "root", 1);
  return result;
};

const childIds = (node: SceneNode | FrameDocument["root"]): string[] =>
  node.type === "group" || node.type === "mask"
    ? node.children.map((child) => child.id)
    : [];

const containers = (
  frame: FrameDocument,
  nodes: Map<string, NodeInfo>,
): Map<string, string[]> => {
  const result = new Map<string, string[]>([
    ["root", frame.root.children.map((node) => node.id)],
  ]);
  for (const [id, info] of nodes)
    if (info.node.type === "group" || info.node.type === "mask")
      result.set(id, childIds(info.node));
  return result;
};

const assertFrameIdentity = (
  current: FrameDocument,
  proposed: FrameDocument,
): void => {
  if (proposed.revision !== current.revision) {
    throw new RuntimeError(
      "STALE_EXTERNAL_EDIT",
      `External frame revision ${proposed.revision} does not match current revision ${current.revision}.`,
      {
        expected: current.revision,
        received: proposed.revision,
      },
      409,
    );
  }
  const fields = ["schemaVersion", "id", "slug", "name", "createdAt"] as const;
  for (const field of fields) {
    if (!equal(current[field], proposed[field])) {
      throw new RuntimeError(
        "EXTERNAL_EDIT_NOT_REPRESENTABLE",
        `External edits to frame ${field} are project-managed.`,
      );
    }
  }
  if (
    proposed.root.id !== "root" ||
    proposed.root.type !== "group" ||
    proposed.root.name !== "Root" ||
    proposed.root.locked ||
    !proposed.root.visible
  ) {
    throw new RuntimeError(
      "EXTERNAL_EDIT_NOT_REPRESENTABLE",
      "The dedicated root identity cannot be edited.",
    );
  }
};

const propertyOperations = (
  current: SceneNode,
  proposed: SceneNode,
): SemanticOperation[] => {
  if (current.type !== proposed.type)
    throw new RuntimeError(
      "EXTERNAL_EDIT_NOT_REPRESENTABLE",
      `Node ${current.id} cannot change type.`,
    );
  const result: SemanticOperation[] = [];
  if (current.name !== proposed.name)
    result.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "common",
      value: { name: proposed.name },
    });
  if (!equal(current.resizeConstraints, proposed.resizeConstraints))
    result.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "resizeConstraints",
      value: { constraints: proposed.resizeConstraints ?? null },
    });
  if (
    !equal(current.templateInstance, proposed.templateInstance) ||
    !equal(current.templateSlot, proposed.templateSlot)
  )
    result.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "templateMetadata",
      value: {
        templateInstance: proposed.templateInstance ?? null,
        templateSlot: proposed.templateSlot ?? null,
      },
    });
  if (!equal(current.brandComponent, proposed.brandComponent))
    result.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "brandComponentMetadata",
      value: { brandComponent: proposed.brandComponent ?? null },
    });
  if (!equal(current.transform, proposed.transform))
    result.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "transform",
      value: proposed.transform,
    });
  if (current.visible !== proposed.visible)
    result.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "visibility",
      value: { visible: proposed.visible },
    });

  if (
    "opacity" in current &&
    "opacity" in proposed &&
    "blendMode" in current &&
    "blendMode" in proposed
  ) {
    const value: { opacity?: number; blendMode?: string } = {};
    if (current.opacity !== proposed.opacity) value.opacity = proposed.opacity;
    if (current.blendMode !== proposed.blendMode)
      value.blendMode = proposed.blendMode;
    if (Object.keys(value).length)
      result.push({
        kind: "updateNode",
        nodeId: current.id,
        propertyGroup: "compositing",
        value,
      });
  }
  if (
    "effects" in current &&
    "effects" in proposed &&
    !equal(current.effects, proposed.effects)
  ) {
    result.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "effects",
      value: { effects: proposed.effects ?? null },
    });
  }

  switch (current.type) {
    case "text": {
      if (proposed.type !== "text") break;
      if (
        current.text !== proposed.text ||
        !equal(current.spans, proposed.spans)
      )
        result.push({
          kind: "updateNode",
          nodeId: current.id,
          propertyGroup: "textContent",
          value: {
            text: proposed.text,
            spans: proposed.spans ?? null,
          },
        });
      if (!equal(current.typography, proposed.typography))
        result.push({
          kind: "updateNode",
          nodeId: current.id,
          propertyGroup: "typography",
          value: proposed.typography,
        });
      if (!equal(current.textBox, proposed.textBox))
        result.push({
          kind: "updateNode",
          nodeId: current.id,
          propertyGroup: "textBox",
          value: {
            ...proposed.textBox,
            height: proposed.textBox.height ?? null,
          },
        });
      break;
    }
    case "rectangle": {
      if (proposed.type !== "rectangle") break;
      if (!equal(current.fill, proposed.fill))
        result.push({
          kind: "updateNode",
          nodeId: current.id,
          propertyGroup: "fill",
          value: { fill: proposed.fill },
        });
      if (!equal(current.stroke, proposed.stroke))
        result.push({
          kind: "updateNode",
          nodeId: current.id,
          propertyGroup: "stroke",
          value: { stroke: proposed.stroke ?? null },
        });
      if (!equal(current.cornerRadius, proposed.cornerRadius))
        result.push({
          kind: "updateNode",
          nodeId: current.id,
          propertyGroup: "shape",
          value: { cornerRadius: proposed.cornerRadius },
        });
      break;
    }
    case "ellipse": {
      if (proposed.type !== "ellipse") break;
      if (!equal(current.fill, proposed.fill))
        result.push({
          kind: "updateNode",
          nodeId: current.id,
          propertyGroup: "fill",
          value: { fill: proposed.fill },
        });
      if (!equal(current.stroke, proposed.stroke))
        result.push({
          kind: "updateNode",
          nodeId: current.id,
          propertyGroup: "stroke",
          value: { stroke: proposed.stroke ?? null },
        });
      break;
    }
    case "vectorPath": {
      if (proposed.type !== "vectorPath") break;
      if (!equal(current.commands, proposed.commands))
        result.push({
          kind: "updateNode",
          nodeId: current.id,
          propertyGroup: "vectorPath",
          value: { commands: proposed.commands },
        });
      if (!equal(current.fill, proposed.fill))
        result.push({
          kind: "updateNode",
          nodeId: current.id,
          propertyGroup: "fill",
          value: { fill: proposed.fill ?? null },
        });
      if (!equal(current.stroke, proposed.stroke))
        result.push({
          kind: "updateNode",
          nodeId: current.id,
          propertyGroup: "stroke",
          value: { stroke: proposed.stroke ?? null },
        });
      break;
    }
    case "rasterImage": {
      if (proposed.type !== "rasterImage") break;
      if (current.assetId !== proposed.assetId)
        result.push({
          kind: "replaceAsset",
          nodeId: current.id,
          assetId: proposed.assetId,
          fit: proposed.fit,
        });
      if (!equal(current.crop, proposed.crop) || current.fit !== proposed.fit) {
        result.push({
          kind: "updateNode",
          nodeId: current.id,
          propertyGroup: "crop",
          value: { crop: proposed.crop ?? null, fit: proposed.fit },
        });
      }
      break;
    }
    case "svg": {
      if (proposed.type !== "svg") break;
      if (current.assetId !== proposed.assetId)
        result.push({
          kind: "replaceAsset",
          nodeId: current.id,
          assetId: proposed.assetId,
        });
      if (!equal(current.intrinsicSize, proposed.intrinsicSize))
        throw new RuntimeError(
          "EXTERNAL_EDIT_NOT_REPRESENTABLE",
          "SVG intrinsic size is asset-managed.",
        );
      break;
    }
    case "mask": {
      if (proposed.type !== "mask") break;
      const value: Extract<SemanticOperation, { kind: "updateMask" }>["value"] =
        {};
      if (current.mode !== proposed.mode) value.mode = proposed.mode;
      if (current.inverted !== proposed.inverted)
        value.inverted = proposed.inverted;
      if (!equal(current.maskSource, proposed.maskSource))
        value.maskSource = proposed.maskSource;
      if (Object.keys(value).length)
        result.push({ kind: "updateMask", maskId: current.id, value });
      break;
    }
    case "adjustment": {
      if (proposed.type !== "adjustment") break;
      if (
        !equal(current.values, proposed.values) ||
        current.targetId !== proposed.targetId
      ) {
        result.push({
          kind: "setAdjustment",
          adjustmentId: current.id,
          values: proposed.values,
          targetId: proposed.targetId,
        });
      }
      if (current.enabled !== proposed.enabled)
        result.push({
          kind: "toggleAdjustment",
          adjustmentId: current.id,
          enabled: proposed.enabled,
        });
      break;
    }
    case "group":
      break;
  }
  return result;
};

export const deriveExternalOperations = (
  current: FrameDocument,
  proposed: FrameDocument,
): SemanticOperation[] => {
  assertFrameIdentity(current, proposed);
  const currentNodes = indexScene(current);
  const proposedNodes = indexScene(proposed);
  const currentContainers = containers(current, currentNodes);
  const proposedContainers = containers(proposed, proposedNodes);
  const operations: SemanticOperation[] = [];

  for (const [id, proposedInfo] of proposedNodes) {
    const currentInfo = currentNodes.get(id);
    if (currentInfo?.node.locked && !proposedInfo.node.locked) {
      operations.push({
        kind: "updateNode",
        nodeId: id,
        propertyGroup: "locking",
        value: { locked: false },
      });
    }
  }

  if (!equal(current.canvas, proposed.canvas))
    operations.push({ kind: "setCanvas", value: proposed.canvas });

  const removedIds = new Set(
    [...currentNodes.keys()].filter((id) => !proposedNodes.has(id)),
  );
  const topRemoved = [...currentNodes.values()]
    .filter(
      (info) =>
        removedIds.has(info.node.id) &&
        (info.parentId === "root" || !removedIds.has(info.parentId)),
    )
    .sort(
      (left, right) => right.depth - left.depth || right.index - left.index,
    );
  for (const info of topRemoved) {
    operations.push(
      info.node.type === "adjustment"
        ? { kind: "removeAdjustment", adjustmentId: info.node.id }
        : { kind: "deleteNode", nodeId: info.node.id },
    );
  }

  const addedIds = new Set(
    [...proposedNodes.keys()].filter((id) => !currentNodes.has(id)),
  );
  const topAdded = [...proposedNodes.values()]
    .filter(
      (info) =>
        addedIds.has(info.node.id) &&
        (info.parentId === "root" || !addedIds.has(info.parentId)),
    )
    .sort(
      (left, right) => left.depth - right.depth || left.index - right.index,
    );
  for (const info of topAdded) {
    operations.push(
      info.node.type === "adjustment"
        ? { kind: "addAdjustment", adjustment: info.node }
        : {
            kind: "createNode",
            parentId: info.parentId,
            index: info.index,
            node: info.node,
          },
    );
  }

  for (const [id, proposedInfo] of proposedNodes) {
    const currentInfo = currentNodes.get(id);
    if (!currentInfo || currentInfo.parentId === proposedInfo.parentId)
      continue;
    if (proposedInfo.node.type === "adjustment")
      throw new RuntimeError(
        "EXTERNAL_EDIT_NOT_REPRESENTABLE",
        "Adjustment nodes must remain at root level.",
      );
    operations.push({
      kind: "moveNode",
      nodeId: id,
      parentId: proposedInfo.parentId,
      index: proposedInfo.index,
    });
  }

  for (const [containerId, targetOrder] of proposedContainers) {
    const originalOrder = currentContainers.get(containerId);
    if (!originalOrder || equal(originalOrder, targetOrder)) continue;
    targetOrder.forEach((nodeId, index) => {
      if (currentNodes.has(nodeId))
        operations.push({ kind: "reorderNode", nodeId, index });
    });
  }

  const propertyChanges: SemanticOperation[] = [];
  const lock: SemanticOperation[] = [];
  for (const [id, proposedInfo] of proposedNodes) {
    const currentInfo = currentNodes.get(id);
    if (!currentInfo) continue;
    propertyChanges.push(
      ...propertyOperations(currentInfo.node, proposedInfo.node),
    );
    if (!currentInfo.node.locked && proposedInfo.node.locked) {
      lock.push({
        kind: "updateNode",
        nodeId: id,
        propertyGroup: "locking",
        value: { locked: true },
      });
    }
  }
  operations.push(...propertyChanges, ...lock);
  if (operations.length === 0)
    throw new RuntimeError(
      "EXTERNAL_EDIT_NOT_REPRESENTABLE",
      "The external file does not contain a semantic change.",
    );
  return operations;
};
