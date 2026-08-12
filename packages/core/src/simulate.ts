import type {
  AdjustmentNode,
  BrandBindableProperty,
  ComponentOverrideProperty,
  FrameDocument,
  GroupNode,
  MaskNode,
  SceneNode,
  TextNode,
  Transform,
} from "./model.js";
import {
  GROUP_BLEND_MODES,
  IDENTITY_TRANSFORM,
  SUPPORTED_BLEND_MODES,
} from "./model.js";
import { reconcileTextSpans } from "./rich-text.js";
import {
  FrameOperationSchema,
  assertNever,
  type FrameOperation,
  type SemanticOperation,
} from "./operations.js";
import { RuntimeError } from "./errors.js";
import {
  allNodeIds,
  assertMutable,
  clone,
  descendantIds,
  findNode,
  isDescendant,
  removeAtLocation,
  requireContainer,
  requireNode,
  requireNodeLocation,
  rootAdjustments,
  transformForNewParent,
} from "./scene.js";
import {
  invertMatrix,
  localNodeBounds,
  matrixFromTransform,
  multiplyMatrices,
  transformFromMatrix,
} from "./transform.js";
import { assertValidFrame, type ValidationContext } from "./validation.js";

export type SimulationResult = {
  frame: FrameDocument;
  inverseOperations: FrameOperation[];
  affectedNodes: string[];
  label: string;
};

const isFrameOperation = (
  operation: SemanticOperation,
): operation is FrameOperation =>
  FrameOperationSchema.safeParse(operation).success;

const ensureFrameOperation = (operation: SemanticOperation): FrameOperation => {
  if (!isFrameOperation(operation)) {
    throw new RuntimeError(
      "INVALID_OPERATION",
      `${operation.kind} is not a frame-scoped operation.`,
    );
  }
  return operation;
};

const clampIndex = (requested: number | undefined, length: number): number =>
  requested === undefined ? length : Math.max(0, Math.min(requested, length));

const ensureUniqueSubtree = (frame: FrameDocument, node: SceneNode): void => {
  const existing = allNodeIds(frame);
  for (const id of descendantIds(node)) {
    if (existing.has(id))
      throw new RuntimeError(
        "DUPLICATE_NODE_ID",
        `Node ID ${id} already exists.`,
        { nodeId: id },
      );
  }
};

const cloneWithIds = (
  node: SceneNode,
  idMap: Record<string, string>,
): SceneNode => {
  const duplicate = clone(node);
  const rewrite = (candidate: SceneNode): void => {
    const nextId = idMap[candidate.id];
    if (!nextId) {
      throw new RuntimeError(
        "INVALID_OPERATION",
        `Duplicate operation is missing a replacement ID for ${candidate.id}.`,
        {
          nodeId: candidate.id,
        },
      );
    }
    candidate.id = nextId;
    if (candidate.type === "mask") {
      rewrite(candidate.maskSource);
      candidate.children.forEach(rewrite);
    } else if (candidate.type === "group") {
      candidate.children.forEach(rewrite);
    }
  };
  rewrite(duplicate);
  return duplicate;
};

const synchronizeTextBox = (node: TextNode): void => {
  node.textBox.width = node.transform.width;
  if (node.textBox.mode === "fixed" || node.textBox.mode === "autoHeight") {
    node.textBox.height = node.transform.height;
  } else {
    delete node.textBox.height;
  }
};

const picked = <T extends object>(
  source: T,
  keys: readonly (keyof T)[],
): Partial<T> =>
  Object.fromEntries(
    keys.map((key) => [key, clone(source[key])]),
  ) as Partial<T>;

const componentOverrideProperty = (
  propertyGroup: Extract<
    FrameOperation,
    { kind: "updateNode" }
  >["propertyGroup"],
): ComponentOverrideProperty | undefined => {
  switch (propertyGroup) {
    case "visibility":
    case "transform":
    case "compositing":
    case "textContent":
    case "typography":
    case "textBox":
    case "fill":
    case "stroke":
    case "vectorPath":
    case "effects":
      return propertyGroup;
    case "shape":
      return "radius";
    case "crop":
      return "crop";
    case "common":
    case "resizeConstraints":
    case "templateMetadata":
    case "brandComponentMetadata":
    case "brandBinding":
    case "locking":
      return undefined;
      return undefined;
    default:
      return assertNever(propertyGroup, "component override property switch");
  }
};

const applyUpdateNode = (
  frame: FrameDocument,
  operation: Extract<FrameOperation, { kind: "updateNode" }>,
): FrameOperation[] => {
  const node = requireNode(frame, operation.nodeId);
  const unlocking =
    operation.propertyGroup === "locking" && operation.value.locked === false;
  const metadataOnly =
    operation.propertyGroup === "templateMetadata" ||
    operation.propertyGroup === "brandComponentMetadata";
  assertMutable(frame, node.id, unlocking || metadataOnly, metadataOnly);

  const detachBrandBinding = (
    property: BrandBindableProperty,
  ): FrameOperation[] => {
    const binding = node.brandBindings?.find(
      (candidate) => candidate.property === property,
    );
    if (!binding) return [];
    node.brandBindings = node.brandBindings!.filter(
      (candidate) => candidate.property !== property,
    );
    if (node.brandBindings.length === 0) delete node.brandBindings;
    return [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "brandBinding",
        value: { property, binding: clone(binding) },
      },
    ];
  };

  switch (operation.propertyGroup) {
    case "common": {
      const inverse: FrameOperation = {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "common",
        value: { name: node.name },
      };
      node.name = operation.value.name;
      return [inverse];
    }
    case "resizeConstraints": {
      const inverse: FrameOperation = {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "resizeConstraints",
        value: {
          constraints: node.resizeConstraints
            ? clone(node.resizeConstraints)
            : null,
        },
      };
      if (operation.value.constraints)
        node.resizeConstraints = clone(operation.value.constraints);
      else delete node.resizeConstraints;
      return [inverse];
    }
    case "templateMetadata": {
      const inverse: FrameOperation = {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "templateMetadata",
        value: {
          templateInstance: node.templateInstance
            ? clone(node.templateInstance)
            : null,
          templateSlot: node.templateSlot ? clone(node.templateSlot) : null,
        },
      };
      if (operation.value.templateInstance)
        node.templateInstance = clone(operation.value.templateInstance);
      else delete node.templateInstance;
      if (operation.value.templateSlot)
        node.templateSlot = clone(operation.value.templateSlot);
      else delete node.templateSlot;
      return [inverse];
    }
    case "brandComponentMetadata": {
      const inverse: FrameOperation = {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "brandComponentMetadata",
        value: {
          brandComponent: node.brandComponent
            ? clone(node.brandComponent)
            : null,
        },
      };
      if (operation.value.brandComponent)
        node.brandComponent = clone(operation.value.brandComponent);
      else delete node.brandComponent;
      return [inverse];
    }
    case "brandBinding": {
      const previous =
        node.brandBindings?.find(
          (binding) => binding.property === operation.value.property,
        ) ?? null;
      const retained = (node.brandBindings ?? []).filter(
        (binding) => binding.property !== operation.value.property,
      );
      if (operation.value.binding)
        retained.push(clone(operation.value.binding));
      if (retained.length) node.brandBindings = retained;
      else delete node.brandBindings;
      return [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "brandBinding",
          value: {
            property: operation.value.property,
            binding: previous ? clone(previous) : null,
          },
        },
      ];
    }
    case "transform": {
      if (node.type === "adjustment") {
        throw new RuntimeError(
          "INVALID_PROPERTY_GROUP",
          "Adjustment transforms are immutable.",
          { nodeId: node.id },
        );
      }
      const keys = Object.keys(operation.value) as (keyof Transform)[];
      const previous = picked(node.transform, keys);
      Object.assign(node.transform, operation.value);
      if (node.type === "text") synchronizeTextBox(node);
      return [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "transform",
          value: previous,
        },
      ];
    }
    case "visibility": {
      const inverse: FrameOperation = {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "visibility",
        value: { visible: node.visible },
      };
      node.visible = operation.value.visible;
      return [inverse];
    }
    case "locking": {
      const inverse: FrameOperation = {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "locking",
        value: { locked: node.locked },
      };
      node.locked = operation.value.locked;
      return [inverse];
    }
    case "compositing": {
      if (!("opacity" in node) || !("blendMode" in node)) {
        throw new RuntimeError(
          "INVALID_PROPERTY_GROUP",
          `${node.type} does not support compositing properties.`,
          { nodeId: node.id },
        );
      }
      const previous: { opacity?: number; blendMode?: string } = {};
      if (operation.value.opacity !== undefined) {
        previous.opacity = node.opacity;
        node.opacity = operation.value.opacity;
      }
      if (operation.value.blendMode !== undefined) {
        previous.blendMode = node.blendMode;
        const allowed =
          node.type === "group" ? GROUP_BLEND_MODES : SUPPORTED_BLEND_MODES;
        if (
          !(allowed as readonly string[]).includes(operation.value.blendMode)
        ) {
          throw new RuntimeError(
            "INVALID_PROPERTY_GROUP",
            `Blend mode ${operation.value.blendMode} is not supported.`,
            { nodeId: node.id },
          );
        }
        node.blendMode = operation.value.blendMode as never;
      }
      return [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "compositing",
          value: previous,
        },
      ];
    }
    case "textContent": {
      if (node.type !== "text")
        throw new RuntimeError(
          "INVALID_PROPERTY_GROUP",
          "Only text nodes have text content.",
          { nodeId: node.id },
        );
      const inverse: FrameOperation = {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "textContent",
        value: {
          text: node.text,
          spans: node.spans ? clone(node.spans) : null,
        },
      };
      const previousText = node.text;
      const previousSpans = node.spans ? clone(node.spans) : undefined;
      node.text = operation.value.text;
      if (operation.value.spans === null) delete node.spans;
      else if (operation.value.spans !== undefined)
        node.spans = clone(operation.value.spans);
      else if (previousSpans)
        node.spans = reconcileTextSpans({
          nodeId: node.id,
          previousText,
          nextText: node.text,
          spans: previousSpans,
        });
      return [inverse];
    }
    case "typography": {
      if (node.type !== "text")
        throw new RuntimeError(
          "INVALID_PROPERTY_GROUP",
          "Only text nodes have typography.",
          { nodeId: node.id },
        );
      const keys = Object.keys(
        operation.value,
      ) as (keyof TextNode["typography"])[];
      const previous = picked(node.typography, keys);
      const bindingInverse = [
        ...detachBrandBinding("typography"),
        ...(operation.value.color === undefined
          ? []
          : detachBrandBinding("textColor")),
      ];
      Object.assign(node.typography, operation.value);
      return [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "typography",
          value: previous,
        },
        ...bindingInverse,
      ];
    }
    case "textBox": {
      if (node.type !== "text")
        throw new RuntimeError(
          "INVALID_PROPERTY_GROUP",
          "Only text nodes have text boxes.",
          { nodeId: node.id },
        );
      const previous: Extract<
        FrameOperation,
        { kind: "updateNode"; propertyGroup: "textBox" }
      >["value"] = {};
      for (const key of Object.keys(
        operation.value,
      ) as (keyof typeof operation.value)[]) {
        if (key === "height") previous.height = node.textBox.height ?? null;
        else Object.assign(previous, { [key]: clone(node.textBox[key]) });
      }
      Object.assign(node.textBox, operation.value);
      if (operation.value.height === null) delete node.textBox.height;
      if (operation.value.width !== undefined)
        node.transform.width = operation.value.width;
      if (
        operation.value.height !== undefined &&
        operation.value.height !== null
      )
        node.transform.height = operation.value.height;
      synchronizeTextBox(node);
      return [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "textBox",
          value: previous,
        },
      ];
    }
    case "fill": {
      if (
        node.type !== "rectangle" &&
        node.type !== "ellipse" &&
        node.type !== "vectorPath"
      ) {
        throw new RuntimeError(
          "INVALID_PROPERTY_GROUP",
          "Only shape and vector-path nodes have editable fills.",
          { nodeId: node.id },
        );
      }
      const previous = node.fill ? clone(node.fill) : null;
      const bindingInverse = detachBrandBinding("fill");
      if (operation.value.fill) node.fill = clone(operation.value.fill);
      else if (node.type === "vectorPath") delete node.fill;
      else
        throw new RuntimeError(
          "INVALID_PROPERTY_GROUP",
          "Rectangle and ellipse fills cannot be removed.",
          { nodeId: node.id },
        );
      return [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "fill",
          value: { fill: previous },
        },
        ...bindingInverse,
      ];
    }
    case "stroke": {
      if (
        node.type !== "rectangle" &&
        node.type !== "ellipse" &&
        node.type !== "vectorPath"
      ) {
        throw new RuntimeError(
          "INVALID_PROPERTY_GROUP",
          "Only shape and vector-path nodes have editable strokes.",
          { nodeId: node.id },
        );
      }
      const previous = node.stroke ? clone(node.stroke) : null;
      const bindingInverse = detachBrandBinding("stroke");
      if (operation.value.stroke) node.stroke = clone(operation.value.stroke);
      else delete node.stroke;
      return [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "stroke",
          value: { stroke: previous },
        },
        ...bindingInverse,
      ];
    }
    case "vectorPath": {
      if (node.type !== "vectorPath")
        throw new RuntimeError(
          "INVALID_PROPERTY_GROUP",
          "Only vector-path nodes have editable commands.",
          { nodeId: node.id },
        );
      const previous = clone(node.commands);
      if (operation.value.commands)
        node.commands = clone(operation.value.commands);
      return [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "vectorPath",
          value: { commands: previous },
        },
      ];
    }
    case "shape": {
      if (node.type !== "rectangle") {
        throw new RuntimeError(
          "INVALID_PROPERTY_GROUP",
          "Only rectangle nodes have editable corner radii.",
          { nodeId: node.id },
        );
      }
      const previous = clone(node.cornerRadius);
      const bindingInverse = detachBrandBinding("radius");
      node.cornerRadius = clone(operation.value.cornerRadius);
      return [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "shape",
          value: { cornerRadius: previous },
        },
        ...bindingInverse,
      ];
    }
    case "crop": {
      if (node.type !== "rasterImage")
        throw new RuntimeError(
          "INVALID_PROPERTY_GROUP",
          "Only raster nodes can be cropped.",
          { nodeId: node.id },
        );
      const previous: Extract<
        FrameOperation,
        { kind: "updateNode"; propertyGroup: "crop" }
      >["value"] = {};
      if ("crop" in operation.value)
        previous.crop = node.crop ? clone(node.crop) : null;
      if (operation.value.fit !== undefined) previous.fit = node.fit;
      if (operation.value.crop === null) delete node.crop;
      else if (operation.value.crop) node.crop = clone(operation.value.crop);
      if (operation.value.fit) node.fit = operation.value.fit;
      return [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "crop",
          value: previous,
        },
      ];
    }
    case "effects": {
      if (node.type === "adjustment")
        throw new RuntimeError(
          "INVALID_PROPERTY_GROUP",
          "Adjustments cannot receive effects.",
          { nodeId: node.id },
        );
      const previous =
        "effects" in node && node.effects ? clone(node.effects) : null;
      const bindingInverse = detachBrandBinding("effects");
      if (operation.value.effects)
        node.effects = clone(operation.value.effects);
      else delete node.effects;
      return [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "effects",
          value: { effects: previous },
        },
        ...bindingInverse,
      ];
    }
    default:
      return assertNever(operation, "updateNode property switch");
  }
};

const groupSelectedNodes = (
  frame: FrameDocument,
  operation: Extract<FrameOperation, { kind: "groupNodes" }>,
): FrameOperation[] => {
  const unique = [...new Set(operation.nodeIds)];
  if (unique.length !== operation.nodeIds.length)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "A node cannot be grouped twice.",
    );
  const locations = unique.map((id) => requireNodeLocation(frame, id));
  if (
    locations.some(
      (location) =>
        location.locationKind !== "child" ||
        location.node.type === "adjustment",
    )
  ) {
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Only visible sibling nodes can be grouped.",
    );
  }
  const parentId = locations[0]?.parentId;
  if (
    !parentId ||
    locations.some((location) => location.parentId !== parentId)
  ) {
    throw new RuntimeError(
      "INVALID_PARENT",
      "Grouped nodes must share one parent.",
    );
  }
  locations.forEach((location) => assertMutable(frame, location.node.id));
  if (allNodeIds(frame).has(operation.groupId))
    throw new RuntimeError(
      "DUPLICATE_NODE_ID",
      `Node ID ${operation.groupId} already exists.`,
    );

  const bounds = locations.map((location) => localNodeBounds(location.node));
  const minX = Math.min(...bounds.map((item) => item.x));
  const minY = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.width));
  const maxY = Math.max(...bounds.map((item) => item.y + item.height));
  const insertionIndex = Math.min(
    ...locations.map((location) => location.index),
  );
  const ordered = [...locations]
    .sort((left, right) => left.index - right.index)
    .map((location) => location.node);
  [...locations]
    .sort((left, right) => right.index - left.index)
    .forEach(removeAtLocation);
  for (const child of ordered) {
    child.transform.x -= minX;
    child.transform.y -= minY;
  }
  const group: GroupNode = {
    id: operation.groupId,
    type: "group",
    name: operation.name,
    visible: true,
    locked: false,
    transform: {
      ...IDENTITY_TRANSFORM,
      x: minX,
      y: minY,
      width: Math.max(maxX - minX, 1),
      height: Math.max(maxY - minY, 1),
    },
    opacity: 1,
    blendMode: "pass-through",
    children: ordered,
  };
  requireContainer(frame, parentId).children.splice(insertionIndex, 0, group);
  return [{ kind: "ungroupNodes", groupId: group.id }];
};

const ungroup = (
  frame: FrameDocument,
  operation: Extract<FrameOperation, { kind: "ungroupNodes" }>,
): FrameOperation[] => {
  const location = requireNodeLocation(frame, operation.groupId);
  if (location.node.type !== "group" || location.locationKind !== "child") {
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Only an ordinary group can be ungrouped.",
      { nodeId: operation.groupId },
    );
  }
  assertMutable(frame, operation.groupId);
  const snapshot = clone(location.node);
  const groupMatrix = matrixFromTransform(location.node.transform);
  const children = [...location.node.children];
  for (const child of children) {
    const matrix = multiplyMatrices(
      groupMatrix,
      matrixFromTransform(child.transform),
    );
    child.transform = transformFromMatrix(matrix, child.transform);
  }
  location.parent.children.splice(location.index, 1, ...children);
  const inverses: FrameOperation[] = children.map((child) => ({
    kind: "deleteNode",
    nodeId: child.id,
  }));
  inverses.push({
    kind: "createNode",
    parentId: location.parentId,
    index: location.index,
    node: snapshot,
  });
  return inverses;
};

const applyMask = (
  frame: FrameDocument,
  operation: Extract<FrameOperation, { kind: "applyMask" }>,
): FrameOperation[] => {
  const locations = [...new Set(operation.nodeIds)].map((id) =>
    requireNodeLocation(frame, id),
  );
  const parentId = locations[0]?.parentId;
  if (
    !parentId ||
    locations.some(
      (location) =>
        location.parentId !== parentId || location.locationKind !== "child",
    )
  ) {
    throw new RuntimeError(
      "INVALID_PARENT",
      "Masked nodes must be ordinary siblings.",
    );
  }
  if (
    allNodeIds(frame).has(operation.maskId) ||
    allNodeIds(frame).has(operation.maskSource.id)
  ) {
    throw new RuntimeError(
      "DUPLICATE_NODE_ID",
      "Mask or mask-source ID already exists.",
    );
  }
  locations.forEach((location) => assertMutable(frame, location.node.id));
  const orderedLocations = [...locations].sort(
    (left, right) => left.index - right.index,
  );
  const insertionIndex = orderedLocations[0]?.index ?? 0;
  const children = orderedLocations.map((location) => location.node);
  [...locations]
    .sort((left, right) => right.index - left.index)
    .forEach(removeAtLocation);
  const bounds = children.map(localNodeBounds);
  const minX = Math.min(...bounds.map((item) => item.x));
  const minY = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.width));
  const maxY = Math.max(...bounds.map((item) => item.y + item.height));
  const maskTransform = {
    ...IDENTITY_TRANSFORM,
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
  const parentToMask = invertMatrix(matrixFromTransform(maskTransform));
  for (const child of children) {
    child.transform = transformFromMatrix(
      multiplyMatrices(parentToMask, matrixFromTransform(child.transform)),
      child.transform,
    );
  }
  const maskSource = clone(operation.maskSource);
  maskSource.transform = {
    ...maskSource.transform,
    x: 0,
    y: 0,
    rotation: 0,
    width: maskTransform.width,
    height: maskTransform.height,
  };
  const mask: MaskNode = {
    id: operation.maskId,
    type: "mask",
    name: operation.name,
    visible: true,
    locked: false,
    transform: maskTransform,
    mode: operation.mode,
    inverted: operation.inverted,
    maskSource,
    children,
  };
  requireContainer(frame, parentId).children.splice(insertionIndex, 0, mask);
  return [{ kind: "removeMask", maskId: operation.maskId }];
};

const requireAdjustmentTarget = (
  frame: FrameDocument,
  targetId: string,
): void => {
  if (targetId === "root") return;
  const target = requireNode(frame, targetId);
  if (
    target.type !== "rasterImage" &&
    target.type !== "svg" &&
    target.type !== "group" &&
    target.type !== "mask"
  ) {
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Adjustments can target the frame, an image, SVG, group, or mask.",
      { nodeId: targetId, nodeType: target.type },
    );
  }
};

const removeMask = (
  frame: FrameDocument,
  operation: Extract<FrameOperation, { kind: "removeMask" }>,
): FrameOperation[] => {
  const location = requireNodeLocation(frame, operation.maskId);
  if (location.node.type !== "mask" || location.locationKind !== "child") {
    throw new RuntimeError(
      "INVALID_OPERATION",
      "The selected node is not a removable mask.",
    );
  }
  assertMutable(frame, operation.maskId);
  const snapshot = clone(location.node);
  const maskMatrix = matrixFromTransform(location.node.transform);
  const children = [...location.node.children];
  for (const child of children) {
    child.transform = transformFromMatrix(
      multiplyMatrices(maskMatrix, matrixFromTransform(child.transform)),
      child.transform,
    );
  }
  location.parent.children.splice(location.index, 1, ...children);
  const inverses: FrameOperation[] = children.map((child) => ({
    kind: "deleteNode",
    nodeId: child.id,
  }));
  inverses.push({
    kind: "createNode",
    parentId: location.parentId,
    index: location.index,
    node: snapshot,
  });
  return inverses;
};

const operationLabel = (
  operation: FrameOperation,
  frame: FrameDocument,
): string => {
  const nodeName =
    "nodeId" in operation ? findNode(frame, operation.nodeId)?.name : undefined;
  switch (operation.kind) {
    case "createNode":
      return `Created “${operation.node.name}”`;
    case "deleteNode":
      return `Deleted “${nodeName ?? "node"}”`;
    case "updateNode":
      return operation.propertyGroup === "textContent"
        ? `Changed “${nodeName ?? "text"}” text`
        : `Changed “${nodeName ?? "node"}” ${operation.propertyGroup}`;
    case "moveNode":
      return `Moved “${nodeName ?? "node"}”`;
    case "reorderNode":
      return `Reordered “${nodeName ?? "node"}”`;
    case "groupNodes":
      return `Grouped ${operation.nodeIds.length} layers`;
    case "ungroupNodes":
      return "Ungrouped layers";
    case "setCanvas":
      return "Changed canvas";
    case "setFrameBrandMode":
      return operation.mode
        ? `Applied Brand mode ${operation.mode.modeKey}`
        : "Cleared Brand mode";
    case "replaceAsset":
      return `Replaced “${nodeName ?? "asset"}”`;
    case "addAdjustment":
      return `Added adjustment to “${findNode(frame, operation.adjustment.targetId)?.name ?? "frame"}”`;
    case "setAdjustment":
      return "Changed image adjustment";
    case "toggleAdjustment":
      return operation.enabled ? "Enabled adjustment" : "Disabled adjustment";
    case "removeAdjustment":
      return "Removed adjustment";
    case "applyMask":
      return `Masked ${operation.nodeIds.length} layers`;
    case "updateMask":
      return "Changed mask";
    case "removeMask":
      return "Removed mask";
    case "duplicateNode":
      return `Duplicated “${nodeName ?? "node"}”`;
    case "undo":
      return "Undo";
    case "redo":
      return "Redo";
    case "restoreRevision":
      return `Restored revision ${operation.revision}`;
    default:
      return assertNever(operation, "frame operation label switch");
  }
};

const applyOne = (
  frame: FrameDocument,
  operation: FrameOperation,
  affected: Set<string>,
): FrameOperation[] => {
  const assertDetachedStructure = (nodeId: string): void => {
    const node = requireNode(frame, nodeId);
    if (node.brandComponent)
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Component structure is controlled. Detach the instance before changing its hierarchy.",
        { nodeId, instanceId: node.brandComponent.instanceId },
      );
  };
  switch (operation.kind) {
    case "setFrameBrandMode": {
      const previous = frame.brandMode ? clone(frame.brandMode) : null;
      if (operation.mode) frame.brandMode = clone(operation.mode);
      else delete frame.brandMode;
      return [{ kind: "setFrameBrandMode", mode: previous }];
    }
    case "setCanvas": {
      const previous: Extract<FrameOperation, { kind: "setCanvas" }>["value"] =
        {};
      if (operation.value.width !== undefined) {
        previous.width = frame.canvas.width;
        frame.canvas.width = operation.value.width;
      }
      if (operation.value.height !== undefined) {
        previous.height = frame.canvas.height;
        frame.canvas.height = operation.value.height;
      }
      if (operation.value.background !== undefined) {
        previous.background = clone(frame.canvas.background);
        frame.canvas.background = clone(operation.value.background);
      }
      if (operation.value.clipContent !== undefined) {
        previous.clipContent = frame.canvas.clipContent;
        frame.canvas.clipContent = operation.value.clipContent;
      }
      if (operation.value.guides !== undefined) {
        previous.guides = frame.canvas.guides
          ? clone(frame.canvas.guides)
          : null;
        if (operation.value.guides === null) delete frame.canvas.guides;
        else frame.canvas.guides = clone(operation.value.guides);
      }
      if (operation.value.safeArea !== undefined) {
        previous.safeArea = frame.canvas.safeArea
          ? clone(frame.canvas.safeArea)
          : null;
        if (
          operation.value.spacingBinding === undefined &&
          frame.canvas.spacingBinding
        ) {
          previous.spacingBinding = clone(frame.canvas.spacingBinding);
          delete frame.canvas.spacingBinding;
        }
        if (operation.value.safeArea === null) delete frame.canvas.safeArea;
        else frame.canvas.safeArea = clone(operation.value.safeArea);
      }
      if (operation.value.spacingBinding !== undefined) {
        if (previous.spacingBinding === undefined)
          previous.spacingBinding = frame.canvas.spacingBinding
            ? clone(frame.canvas.spacingBinding)
            : null;
        if (operation.value.spacingBinding === null)
          delete frame.canvas.spacingBinding;
        else
          frame.canvas.spacingBinding = clone(operation.value.spacingBinding);
      }
      return [{ kind: "setCanvas", value: previous }];
    }
    case "createNode": {
      if (operation.parentId !== "root")
        assertDetachedStructure(operation.parentId);
      ensureUniqueSubtree(frame, operation.node);
      if (
        operation.node.type === "adjustment" &&
        operation.parentId !== "root"
      ) {
        throw new RuntimeError(
          "INVALID_PARENT",
          "Adjustments must be direct root children.",
        );
      }
      const parent = requireContainer(frame, operation.parentId);
      const at = clampIndex(operation.index, parent.children.length);
      parent.children.splice(at, 0, clone(operation.node));
      descendantIds(operation.node).forEach((id) => affected.add(id));
      return [{ kind: "deleteNode", nodeId: operation.node.id }];
    }
    case "updateNode": {
      affected.add(operation.nodeId);
      const node = requireNode(frame, operation.nodeId);
      const overrideProperty = componentOverrideProperty(
        operation.propertyGroup,
      );
      if (!node.brandComponent || !overrideProperty)
        return applyUpdateNode(frame, operation);
      if (!node.brandComponent.allowedOverrides.includes(overrideProperty))
        throw new RuntimeError(
          "INVALID_OPERATION",
          `Component property ${overrideProperty} is not declared as an override. Detach the instance before changing it.`,
          { nodeId: node.id, property: overrideProperty },
        );
      const previousMetadata = clone(node.brandComponent);
      const inverse = applyUpdateNode(frame, operation);
      if (!node.brandComponent.overrides.includes(overrideProperty))
        node.brandComponent.overrides.push(overrideProperty);
      return [
        ...inverse,
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "brandComponentMetadata",
          value: { brandComponent: previousMetadata },
        },
      ];
    }
    case "deleteNode": {
      assertDetachedStructure(operation.nodeId);
      const location = requireNodeLocation(frame, operation.nodeId);
      assertMutable(frame, operation.nodeId);
      const snapshot = clone(location.node);
      removeAtLocation(location);
      descendantIds(snapshot).forEach((id) => affected.add(id));
      return [
        {
          kind: "createNode",
          parentId: location.parentId,
          index: location.index,
          node: snapshot,
        },
      ];
    }
    case "duplicateNode": {
      assertDetachedStructure(operation.nodeId);
      const location = requireNodeLocation(frame, operation.nodeId);
      const duplicate = cloneWithIds(location.node, operation.idMap);
      duplicate.name = `${duplicate.name} Copy`;
      duplicate.transform.x += operation.offset?.x ?? 16;
      duplicate.transform.y += operation.offset?.y ?? 16;
      ensureUniqueSubtree(frame, duplicate);
      location.parent.children.splice(location.index + 1, 0, duplicate);
      descendantIds(duplicate).forEach((id) => affected.add(id));
      return [{ kind: "deleteNode", nodeId: duplicate.id }];
    }
    case "moveNode": {
      assertDetachedStructure(operation.nodeId);
      if (operation.parentId !== "root")
        assertDetachedStructure(operation.parentId);
      const location = requireNodeLocation(frame, operation.nodeId);
      if (location.locationKind !== "child")
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Mask sources cannot be reparented independently.",
        );
      assertMutable(frame, operation.nodeId);
      if (
        operation.parentId === operation.nodeId ||
        isDescendant(frame, operation.nodeId, operation.parentId)
      ) {
        throw new RuntimeError(
          "INVALID_PARENT",
          "A node cannot move inside itself or a descendant.",
        );
      }
      const previousParent = location.parentId;
      const previousIndex = location.index;
      const nextTransform = transformForNewParent(
        frame,
        location.node,
        previousParent,
        operation.parentId,
      );
      const node = removeAtLocation(location);
      node.transform = nextTransform;
      const nextParent = requireContainer(frame, operation.parentId);
      nextParent.children.splice(
        clampIndex(operation.index, nextParent.children.length),
        0,
        node,
      );
      affected.add(node.id);
      return [
        {
          kind: "moveNode",
          nodeId: node.id,
          parentId: previousParent,
          index: previousIndex,
        },
      ];
    }
    case "reorderNode": {
      assertDetachedStructure(operation.nodeId);
      const location = requireNodeLocation(frame, operation.nodeId);
      if (location.locationKind !== "child")
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Mask sources cannot be reordered independently.",
        );
      assertMutable(frame, operation.nodeId);
      const previousIndex = location.index;
      const node = removeAtLocation(location);
      location.parent.children.splice(
        clampIndex(operation.index, location.parent.children.length),
        0,
        node,
      );
      affected.add(node.id);
      return [{ kind: "reorderNode", nodeId: node.id, index: previousIndex }];
    }
    case "groupNodes": {
      operation.nodeIds.forEach(assertDetachedStructure);
      operation.nodeIds.forEach((id) => affected.add(id));
      affected.add(operation.groupId);
      return groupSelectedNodes(frame, operation);
    }
    case "ungroupNodes": {
      assertDetachedStructure(operation.groupId);
      const group = requireNode(frame, operation.groupId);
      if (group.type === "group")
        group.children.forEach((child) => affected.add(child.id));
      affected.add(operation.groupId);
      return ungroup(frame, operation);
    }
    case "replaceAsset": {
      const node = requireNode(frame, operation.nodeId);
      assertMutable(frame, node.id);
      if (node.type !== "rasterImage" && node.type !== "svg") {
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Only raster and SVG nodes can replace assets.",
          { nodeId: node.id },
        );
      }
      const previousMetadata = node.brandComponent
        ? clone(node.brandComponent)
        : undefined;
      if (
        node.brandComponent &&
        !node.brandComponent.allowedOverrides.includes("asset")
      )
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Component asset replacement is not declared as an override. Detach the instance before changing it.",
          { nodeId: node.id, property: "asset" },
        );
      const previousAsset = node.assetId;
      const previousFit = node.type === "rasterImage" ? node.fit : undefined;
      node.assetId = operation.assetId;
      if (node.type === "rasterImage" && operation.fit)
        node.fit = operation.fit;
      if (
        node.brandComponent &&
        !node.brandComponent.overrides.includes("asset")
      )
        node.brandComponent.overrides.push("asset");
      affected.add(node.id);
      return [
        {
          kind: "replaceAsset",
          nodeId: node.id,
          assetId: previousAsset,
          ...(previousFit ? { fit: previousFit } : {}),
        },
        ...(previousMetadata
          ? [
              {
                kind: "updateNode" as const,
                nodeId: node.id,
                propertyGroup: "brandComponentMetadata" as const,
                value: { brandComponent: previousMetadata },
              },
            ]
          : []),
      ];
    }
    case "applyMask": {
      operation.nodeIds.forEach((id) => affected.add(id));
      affected.add(operation.maskId);
      affected.add(operation.maskSource.id);
      return applyMask(frame, operation);
    }
    case "updateMask": {
      const node = requireNode(frame, operation.maskId);
      assertMutable(frame, node.id);
      if (node.type !== "mask")
        throw new RuntimeError("INVALID_OPERATION", "Target is not a mask.");
      const previous: Extract<FrameOperation, { kind: "updateMask" }>["value"] =
        {};
      if (operation.value.mode !== undefined) {
        previous.mode = node.mode;
        node.mode = operation.value.mode;
      }
      if (operation.value.inverted !== undefined) {
        previous.inverted = node.inverted;
        node.inverted = operation.value.inverted;
      }
      if (operation.value.maskSource !== undefined) {
        previous.maskSource = clone(node.maskSource);
        node.maskSource = clone(operation.value.maskSource);
      }
      affected.add(node.id);
      affected.add(node.maskSource.id);
      return [{ kind: "updateMask", maskId: node.id, value: previous }];
    }
    case "removeMask": {
      affected.add(operation.maskId);
      return removeMask(frame, operation);
    }
    case "addAdjustment": {
      if (
        operation.adjustment.transform.x !== 0 ||
        operation.adjustment.transform.y !== 0
      ) {
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Adjustment transforms must be identity values.",
        );
      }
      requireAdjustmentTarget(frame, operation.adjustment.targetId);
      if (
        rootAdjustments(frame).some(
          (node) => node.targetId === operation.adjustment.targetId,
        )
      ) {
        throw new RuntimeError(
          "ADJUSTMENT_CYCLE",
          `Target ${operation.adjustment.targetId} already has an adjustment.`,
        );
      }
      ensureUniqueSubtree(frame, operation.adjustment);
      frame.root.children.push(clone(operation.adjustment));
      affected.add(operation.adjustment.id);
      affected.add(operation.adjustment.targetId);
      return [
        { kind: "removeAdjustment", adjustmentId: operation.adjustment.id },
      ];
    }
    case "setAdjustment": {
      const node = requireNode(frame, operation.adjustmentId);
      assertMutable(frame, node.id);
      if (node.type !== "adjustment")
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Target is not an adjustment.",
        );
      const keys = Object.keys(
        operation.values,
      ) as (keyof AdjustmentNode["values"])[];
      const previous = picked(node.values, keys);
      const previousTargetId = node.targetId;
      Object.assign(node.values, operation.values);
      if (
        operation.targetId !== undefined &&
        operation.targetId !== node.targetId
      ) {
        requireAdjustmentTarget(frame, operation.targetId);
        if (
          rootAdjustments(frame).some(
            (candidate) =>
              candidate.id !== node.id &&
              candidate.targetId === operation.targetId,
          )
        ) {
          throw new RuntimeError(
            "ADJUSTMENT_CYCLE",
            `Target ${operation.targetId} already has an adjustment.`,
          );
        }
        node.targetId = operation.targetId;
      }
      affected.add(node.id);
      affected.add(node.targetId);
      return [
        {
          kind: "setAdjustment",
          adjustmentId: node.id,
          values: previous,
          ...(operation.targetId !== undefined
            ? { targetId: previousTargetId }
            : {}),
        },
      ];
    }
    case "toggleAdjustment": {
      const node = requireNode(frame, operation.adjustmentId);
      assertMutable(frame, node.id);
      if (node.type !== "adjustment")
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Target is not an adjustment.",
        );
      const previous = node.enabled;
      node.enabled = operation.enabled;
      affected.add(node.id);
      affected.add(node.targetId);
      return [
        { kind: "toggleAdjustment", adjustmentId: node.id, enabled: previous },
      ];
    }
    case "removeAdjustment": {
      const location = requireNodeLocation(frame, operation.adjustmentId);
      if (location.node.type !== "adjustment")
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Target is not an adjustment.",
        );
      assertMutable(frame, location.node.id);
      const snapshot = clone(location.node);
      removeAtLocation(location);
      affected.add(snapshot.id);
      affected.add(snapshot.targetId);
      return [{ kind: "addAdjustment", adjustment: snapshot }];
    }
    case "undo":
    case "redo":
    case "restoreRevision":
      throw new RuntimeError(
        "INVALID_OPERATION",
        `${operation.kind} must be resolved by the history service before simulation.`,
      );
    default:
      return assertNever(operation, "frame operation simulation switch");
  }
};

export const simulateFrameOperations = (
  source: FrameDocument,
  operations: readonly SemanticOperation[],
  options: {
    validation?: ValidationContext;
    nextRevision?: number;
    now?: string;
  } = {},
): SimulationResult => {
  const frame = clone(source);
  const affected = new Set<string>();
  let inverseOperations: FrameOperation[] = [];
  let label = "Changed frame";
  for (const rawOperation of operations) {
    const operation = ensureFrameOperation(rawOperation);
    label = operationLabel(operation, frame);
    const inverse = applyOne(frame, operation, affected);
    inverseOperations = [...inverse, ...inverseOperations];
  }
  if (options.nextRevision !== undefined) frame.revision = options.nextRevision;
  if (options.now !== undefined) frame.updatedAt = options.now;
  assertValidFrame(frame, options.validation);
  return {
    frame,
    inverseOperations,
    affectedNodes: [...affected],
    label:
      operations.length === 1
        ? label
        : `Changed ${operations.length} frame properties`,
  };
};
