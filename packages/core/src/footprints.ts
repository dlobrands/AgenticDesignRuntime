import { stableStringify } from "./canonical.js";
import type { FrameDocument, SceneNode } from "./model.js";
import { walkScene } from "./scene.js";

export type SemanticProperty = string;

export type SemanticChange = {
  property: SemanticProperty;
  nodeId?: string;
  before?: unknown;
  after?: unknown;
};

export type SemanticConflictAnalysis = {
  intendedChanges: SemanticChange[];
  interveningChanges: SemanticChange[];
  conflictingProperties: SemanticProperty[];
  affectedNodeIds: string[];
};

type PropertyRecord = { nodeId?: string; value: unknown };

const equal = (left: unknown, right: unknown): boolean =>
  stableStringify(left) === stableStringify(right);

const put = (
  properties: Map<SemanticProperty, PropertyRecord>,
  property: SemanticProperty,
  value: unknown,
  nodeId?: string,
): void => {
  properties.set(property, {
    ...(nodeId ? { nodeId } : {}),
    value: structuredClone(value),
  });
};

const nodeProperties = (
  properties: Map<SemanticProperty, PropertyRecord>,
  node: SceneNode,
): void => {
  const prefix = `node:${node.id}`;
  put(properties, `${prefix}.exists`, true, node.id);
  put(properties, `${prefix}.type`, node.type, node.id);
  for (const key of ["name", "visible", "locked"] as const)
    put(properties, `${prefix}.${key}`, node[key], node.id);
  put(
    properties,
    `${prefix}.resizeConstraints`,
    node.resizeConstraints ?? null,
    node.id,
  );
  put(
    properties,
    `${prefix}.templateMetadata`,
    {
      templateInstance: node.templateInstance ?? null,
      templateSlot: node.templateSlot ?? null,
    },
    node.id,
  );
  put(
    properties,
    `${prefix}.brandComponentMetadata`,
    node.brandComponent ?? null,
    node.id,
  );
  put(properties, `${prefix}.brandBindings`, node.brandBindings ?? [], node.id);
  if ("opacity" in node)
    put(properties, `${prefix}.opacity`, node.opacity, node.id);
  if ("blendMode" in node)
    put(properties, `${prefix}.blendMode`, node.blendMode, node.id);
  if ("transform" in node)
    for (const [key, value] of Object.entries(node.transform))
      put(properties, `${prefix}.transform.${key}`, value, node.id);
  if (node.type === "text") {
    put(properties, `${prefix}.text`, node.text, node.id);
    put(properties, `${prefix}.spans`, node.spans ?? null, node.id);
    for (const [key, value] of Object.entries(node.typography))
      put(properties, `${prefix}.typography.${key}`, value, node.id);
    for (const [key, value] of Object.entries(node.textBox))
      put(properties, `${prefix}.textBox.${key}`, value, node.id);
  }
  const broadProperties = [
    "fill",
    "stroke",
    "commands",
    "cornerRadius",
    "assetId",
    "fit",
    "crop",
    "effects",
    "intrinsicSize",
    "mode",
    "inverted",
    "enabled",
    "targetId",
    "values",
  ] as const;
  const record = node as unknown as Record<string, unknown>;
  for (const key of broadProperties)
    if (key in record)
      put(properties, `${prefix}.${key}`, record[key], node.id);
  if (node.type === "mask")
    put(properties, `${prefix}.maskSource`, node.maskSource.id, node.id);
};

export const semanticPropertyMap = (
  frame: FrameDocument,
): Map<SemanticProperty, PropertyRecord> => {
  const properties = new Map<SemanticProperty, PropertyRecord>();
  put(properties, "frame.name", frame.name);
  put(properties, "frame.brandMode", frame.brandMode ?? null);
  put(properties, "frame.canvas.width", frame.canvas.width);
  put(properties, "frame.canvas.height", frame.canvas.height);
  put(properties, "frame.canvas.clipContent", frame.canvas.clipContent);
  put(properties, "frame.canvas.background", frame.canvas.background);
  put(properties, "frame.canvas.guides", frame.canvas.guides ?? []);
  put(properties, "frame.canvas.safeArea", frame.canvas.safeArea ?? null);
  put(
    properties,
    "frame.canvas.spacingBinding",
    frame.canvas.spacingBinding ?? null,
  );
  put(
    properties,
    "container:root.children.order",
    frame.root.children.map((node) => node.id),
  );
  for (const visit of walkScene(frame)) {
    nodeProperties(properties, visit.node);
    put(
      properties,
      `node:${visit.node.id}.parent`,
      {
        parentId: visit.parentId,
        locationKind: visit.locationKind,
      },
      visit.node.id,
    );
    if (visit.node.type === "group" || visit.node.type === "mask")
      put(
        properties,
        `container:${visit.node.id}.children.order`,
        visit.node.children.map((node) => node.id),
        visit.node.id,
      );
  }
  return properties;
};

export const semanticChanges = (
  before: FrameDocument,
  after: FrameDocument,
): SemanticChange[] => {
  const left = semanticPropertyMap(before);
  const right = semanticPropertyMap(after);
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  return keys.flatMap((property) => {
    const previous = left.get(property);
    const next = right.get(property);
    if (previous && next && equal(previous.value, next.value)) return [];
    return [
      {
        property,
        ...(next?.nodeId || previous?.nodeId
          ? { nodeId: next?.nodeId ?? previous?.nodeId }
          : {}),
        ...(previous ? { before: previous.value } : {}),
        ...(next ? { after: next.value } : {}),
      },
    ];
  });
};

export const analyzeSemanticConflict = (
  base: FrameDocument,
  current: FrameDocument,
  intended: FrameDocument,
): SemanticConflictAnalysis => {
  const intendedChanges = semanticChanges(base, intended);
  const interveningChanges = semanticChanges(base, current);
  const intendedProperties = new Set(
    intendedChanges.map((change) => change.property),
  );
  const conflictingProperties = [
    ...new Set(
      interveningChanges
        .map((change) => change.property)
        .filter((property) => intendedProperties.has(property)),
    ),
  ].sort();
  const conflicting = new Set(conflictingProperties);
  const affectedNodeIds = [
    ...new Set(
      [...intendedChanges, ...interveningChanges]
        .filter((change) => conflicting.has(change.property))
        .flatMap((change) => (change.nodeId ? [change.nodeId] : [])),
    ),
  ].sort();
  return {
    intendedChanges,
    interveningChanges,
    conflictingProperties,
    affectedNodeIds,
  };
};
