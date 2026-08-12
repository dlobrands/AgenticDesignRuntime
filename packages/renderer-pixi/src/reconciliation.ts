import type {
  FrameDocument,
  SceneNode,
  Transform,
} from "@tva-agentic-design/core";

export type RendererDirtyCategory =
  | "transform"
  | "geometry"
  | "paint"
  | "text"
  | "effect"
  | "asset"
  | "hierarchy"
  | "composite-cache";

export type NodeReconciliationChange = {
  nodeId: string;
  transformChanged: boolean;
  metadataChanged: boolean;
  dirty: RendererDirtyCategory[];
};

export type FrameReconciliationPlan = {
  mode: "full" | "incremental";
  reason?:
    "initial" | "canvas" | "canvas-metadata" | "hierarchy" | "node-content";
  dirty: RendererDirtyCategory[];
  changes: NodeReconciliationChange[];
  addedNodeIds?: string[];
  removedNodeIds?: string[];
};

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const renderedCanvas = (frame: FrameDocument) => ({
  width: frame.canvas.width,
  height: frame.canvas.height,
  background: frame.canvas.background,
  clipContent: frame.canvas.clipContent,
});

const transformGeometry = (transform: Transform) => ({
  width: transform.width,
  height: transform.height,
});

const transformPlacement = (transform: Transform) => ({
  x: transform.x,
  y: transform.y,
  rotation: transform.rotation,
  scaleX: transform.scaleX,
  scaleY: transform.scaleY,
  skewX: transform.skewX,
  skewY: transform.skewY,
  anchorX: transform.anchorX,
  anchorY: transform.anchorY,
});

const nodes = (frame: FrameDocument): Map<string, SceneNode> => {
  const result = new Map<string, SceneNode>();
  const visit = (node: SceneNode): void => {
    result.set(node.id, node);
    if (node.type === "mask") {
      visit(node.maskSource);
      node.children.forEach(visit);
    } else if (node.type === "group") node.children.forEach(visit);
  };
  frame.root.children.forEach(visit);
  return result;
};

const hierarchy = (frame: FrameDocument): string[] => {
  const result: string[] = [];
  const visit = (node: SceneNode, parentId: string, slot: string): void => {
    result.push(`${parentId}:${slot}:${node.id}:${node.type}`);
    if (node.type === "mask") {
      visit(node.maskSource, node.id, "mask-source");
      node.children.forEach((child, index) =>
        visit(child, node.id, String(index)),
      );
    } else if (node.type === "group")
      node.children.forEach((child, index) =>
        visit(child, node.id, String(index)),
      );
  };
  frame.root.children.forEach((node, index) =>
    visit(node, "root", String(index)),
  );
  return result;
};

const contentSignature = (node: SceneNode): unknown => {
  const base = {
    type: node.type,
    geometry: transformGeometry(node.transform),
    ...(node.type !== "mask" && node.type !== "adjustment"
      ? { opacity: node.opacity, blendMode: node.blendMode }
      : {}),
  };
  switch (node.type) {
    case "rectangle":
      return {
        ...base,
        fill: node.fill,
        stroke: node.stroke,
        cornerRadius: node.cornerRadius,
        effects: node.effects,
      };
    case "ellipse":
      return {
        ...base,
        fill: node.fill,
        stroke: node.stroke,
        effects: node.effects,
      };
    case "vectorPath":
      return {
        ...base,
        commands: node.commands,
        fill: node.fill,
        stroke: node.stroke,
        effects: node.effects,
      };
    case "text":
      return {
        ...base,
        text: node.text,
        typography: node.typography,
        spans: node.spans,
        textBox: node.textBox,
        effects: node.effects,
      };
    case "rasterImage":
      return {
        ...base,
        assetId: node.assetId,
        fit: node.fit,
        crop: node.crop,
        effects: node.effects,
      };
    case "svg":
      return {
        ...base,
        assetId: node.assetId,
        intrinsicSize: node.intrinsicSize,
        effects: node.effects,
      };
    case "group":
      return { ...base, effects: node.effects };
    case "mask":
      return { ...base, mode: node.mode, inverted: node.inverted };
    case "adjustment":
      return {
        ...base,
        enabled: node.enabled,
        targetId: node.targetId,
        values: node.values,
      };
  }
};

const dirtyCategories = (
  previous: SceneNode,
  next: SceneNode,
): RendererDirtyCategory[] => {
  const dirty = new Set<RendererDirtyCategory>();
  if (
    !same(
      transformPlacement(previous.transform),
      transformPlacement(next.transform),
    )
  )
    dirty.add("transform");
  if (
    !same(
      transformGeometry(previous.transform),
      transformGeometry(next.transform),
    )
  )
    dirty.add("geometry");
  if (previous.type !== next.type) {
    dirty.add("hierarchy");
    return [...dirty];
  }
  if (
    previous.type !== "mask" &&
    previous.type !== "adjustment" &&
    next.type !== "mask" &&
    next.type !== "adjustment" &&
    (previous.opacity !== next.opacity || previous.blendMode !== next.blendMode)
  )
    dirty.add("composite-cache");
  const previousEffects =
    previous.type === "adjustment" ? undefined : previous.effects;
  const nextEffects = next.type === "adjustment" ? undefined : next.effects;
  if (!same(previousEffects, nextEffects)) dirty.add("effect");
  if (
    (previous.type === "rectangle" && next.type === "rectangle") ||
    (previous.type === "ellipse" && next.type === "ellipse")
  ) {
    if (!same(previous.fill, next.fill) || !same(previous.stroke, next.stroke))
      dirty.add("paint");
    if (
      previous.type === "rectangle" &&
      next.type === "rectangle" &&
      !same(previous.cornerRadius, next.cornerRadius)
    )
      dirty.add("geometry");
  }
  if (previous.type === "vectorPath" && next.type === "vectorPath") {
    if (!same(previous.commands, next.commands)) dirty.add("geometry");
    if (!same(previous.fill, next.fill) || !same(previous.stroke, next.stroke))
      dirty.add("paint");
  }
  if (previous.type === "text" && next.type === "text") {
    if (
      previous.text !== next.text ||
      !same(previous.typography, next.typography) ||
      !same(previous.spans, next.spans) ||
      !same(previous.textBox, next.textBox)
    )
      dirty.add("text");
  }
  if (previous.type === "rasterImage" && next.type === "rasterImage") {
    if (
      previous.assetId !== next.assetId ||
      previous.fit !== next.fit ||
      !same(previous.crop, next.crop)
    )
      dirty.add("asset");
  }
  if (previous.type === "svg" && next.type === "svg") {
    if (
      previous.assetId !== next.assetId ||
      !same(previous.intrinsicSize, next.intrinsicSize)
    )
      dirty.add("asset");
  }
  if (previous.type === "mask" && next.type === "mask") {
    if (previous.mode !== next.mode || previous.inverted !== next.inverted)
      dirty.add("composite-cache");
  }
  if (previous.type === "adjustment" && next.type === "adjustment") {
    if (
      previous.enabled !== next.enabled ||
      previous.targetId !== next.targetId ||
      !same(previous.values, next.values)
    )
      dirty.add("composite-cache");
  }
  return [...dirty];
};

export const planFrameReconciliation = (
  previous: FrameDocument | undefined,
  next: FrameDocument,
): FrameReconciliationPlan => {
  if (!previous)
    return {
      mode: "full",
      reason: "initial",
      dirty: ["hierarchy"],
      changes: [],
    };
  if (
    previous.id !== next.id ||
    !same(renderedCanvas(previous), renderedCanvas(next))
  )
    return { mode: "full", reason: "canvas", dirty: ["geometry"], changes: [] };
  if (!same(previous.canvas, next.canvas))
    return {
      mode: "incremental",
      reason: "canvas-metadata",
      dirty: [],
      changes: [],
    };
  const previousNodes = nodes(previous);
  const nextNodes = nodes(next);
  const addedNodeIds = [...nextNodes.keys()].filter(
    (nodeId) => !previousNodes.has(nodeId),
  );
  const removedNodeIds = [...previousNodes.keys()].filter(
    (nodeId) => !nextNodes.has(nodeId),
  );
  const typeChanged = [...nextNodes].some(
    ([nodeId, node]) =>
      previousNodes.has(nodeId) &&
      previousNodes.get(nodeId)?.type !== node.type,
  );
  if (typeChanged)
    return {
      mode: "full",
      reason: "hierarchy",
      dirty: ["hierarchy"],
      changes: [],
    };
  const hierarchyChanged = !same(hierarchy(previous), hierarchy(next));
  const changes: NodeReconciliationChange[] = [];
  const allDirty = new Set<RendererDirtyCategory>();
  if (hierarchyChanged) allDirty.add("hierarchy");
  let requiresRebuild = false;
  for (const [nodeId, nextNode] of nextNodes) {
    const previousNode = previousNodes.get(nodeId);
    if (!previousNode) continue;
    const dirty = dirtyCategories(previousNode, nextNode);
    dirty.forEach((category) => allDirty.add(category));
    const metadataChanged =
      previousNode.name !== nextNode.name ||
      previousNode.visible !== nextNode.visible ||
      previousNode.locked !== nextNode.locked ||
      !same(previousNode.resizeConstraints, nextNode.resizeConstraints) ||
      !same(previousNode.templateInstance, nextNode.templateInstance) ||
      !same(previousNode.templateSlot, nextNode.templateSlot) ||
      !same(previousNode.brandBindings, nextNode.brandBindings);
    const transformChanged = dirty.includes("transform");
    if (transformChanged || metadataChanged || dirty.length)
      changes.push({ nodeId, transformChanged, metadataChanged, dirty });
    if (!same(contentSignature(previousNode), contentSignature(nextNode)))
      requiresRebuild = true;
  }
  const nodeSetChanged = addedNodeIds.length > 0 || removedNodeIds.length > 0;
  return requiresRebuild || nodeSetChanged
    ? {
        mode: "full",
        reason: nodeSetChanged ? "hierarchy" : "node-content",
        dirty: [...allDirty],
        changes,
        ...(nodeSetChanged ? { addedNodeIds, removedNodeIds } : {}),
      }
    : { mode: "incremental", dirty: [...allDirty], changes };
};
