import { z } from "zod";
import { instantiateBrandDefinition, type BrandKitRecord } from "./brand.js";
import { stableStringify } from "./canonical.js";
import { RuntimeError } from "./errors.js";
import type {
  BrandComponentInstanceMetadata,
  ComponentOverrideProperty,
  FrameDocument,
  ProjectDocument,
  SceneNode,
} from "./model.js";
import type { FrameOperation } from "./operations.js";
import { listNodes } from "./scene.js";

const uuid = z.string().uuid();
const key = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

export const SwitchBrandComponentVariantInputSchema = z
  .object({ instanceId: uuid, definitionKey: key })
  .strict();

export type SwitchBrandComponentVariantInput = z.infer<
  typeof SwitchBrandComponentVariantInputSchema
>;

const allOverrideProperties: ComponentOverrideProperty[] = [
  "visibility",
  "transform",
  "compositing",
  "textContent",
  "typography",
  "textBox",
  "fill",
  "stroke",
  "vectorPath",
  "effects",
  "radius",
  "crop",
  "asset",
];

type BrandPin = NonNullable<ProjectDocument["brandKitPin"]>;

const visitNode = (node: SceneNode, visit: (node: SceneNode) => void): void => {
  visit(node);
  if (node.type === "group")
    node.children.forEach((child) => visitNode(child, visit));
  if (node.type === "mask") {
    visitNode(node.maskSource, visit);
    node.children.forEach((child) => visitNode(child, visit));
  }
};

export const detachBrandComponentOperations = (
  frame: FrameDocument,
  instanceId: string,
): FrameOperation[] => {
  const operations: FrameOperation[] = [];
  frame.root.children.forEach((root) =>
    visitNode(root, (node) => {
      if (node.brandComponent?.instanceId !== instanceId) return;
      operations.push({
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "brandComponentMetadata",
        value: { brandComponent: null },
      });
    }),
  );
  if (operations.length === 0)
    throw new RuntimeError(
      "INVALID_OPERATION",
      `Brand component instance ${instanceId} was not found.`,
    );
  return operations;
};

const equal = (left: unknown, right: unknown): boolean =>
  stableStringify(left) === stableStringify(right);

const metadataOperation = (
  nodeId: string,
  brandComponent: BrandComponentInstanceMetadata,
): FrameOperation => ({
  kind: "updateNode",
  nodeId,
  propertyGroup: "brandComponentMetadata",
  value: { brandComponent },
});

const nodeVariantOperations = (
  current: SceneNode,
  target: SceneNode,
  overridden: ReadonlySet<ComponentOverrideProperty>,
): FrameOperation[] => {
  if (current.type !== target.type)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Component variant node types are incompatible.",
    );
  const operations: FrameOperation[] = [];
  if (current.name !== target.name)
    operations.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "common",
      value: { name: target.name },
    });
  if (!overridden.has("visibility") && current.visible !== target.visible)
    operations.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "visibility",
      value: { visible: target.visible },
    });
  if (
    !overridden.has("transform") &&
    !equal(current.transform, target.transform)
  )
    operations.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "transform",
      value: structuredClone(target.transform),
    });
  if (
    !overridden.has("compositing") &&
    "opacity" in current &&
    "opacity" in target &&
    (current.opacity !== target.opacity ||
      current.blendMode !== target.blendMode)
  )
    operations.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "compositing",
      value: { opacity: target.opacity, blendMode: target.blendMode },
    });
  if (current.type === "text" && target.type === "text") {
    if (
      !overridden.has("textContent") &&
      (!equal(current.text, target.text) || !equal(current.spans, target.spans))
    )
      operations.push({
        kind: "updateNode",
        nodeId: current.id,
        propertyGroup: "textContent",
        value: {
          text: target.text,
          spans: target.spans ? structuredClone(target.spans) : null,
        },
      });
    if (
      !overridden.has("typography") &&
      !equal(current.typography, target.typography)
    )
      operations.push({
        kind: "updateNode",
        nodeId: current.id,
        propertyGroup: "typography",
        value: structuredClone(target.typography),
      });
    if (!overridden.has("textBox") && !equal(current.textBox, target.textBox))
      operations.push({
        kind: "updateNode",
        nodeId: current.id,
        propertyGroup: "textBox",
        value: {
          ...structuredClone(target.textBox),
          height: target.textBox.height ?? null,
        },
      });
  }
  if (
    (current.type === "rectangle" ||
      current.type === "ellipse" ||
      current.type === "vectorPath") &&
    (target.type === "rectangle" ||
      target.type === "ellipse" ||
      target.type === "vectorPath")
  ) {
    if (!overridden.has("fill") && !equal(current.fill, target.fill))
      operations.push({
        kind: "updateNode",
        nodeId: current.id,
        propertyGroup: "fill",
        value: { fill: target.fill ? structuredClone(target.fill) : null },
      });
    if (!overridden.has("stroke") && !equal(current.stroke, target.stroke))
      operations.push({
        kind: "updateNode",
        nodeId: current.id,
        propertyGroup: "stroke",
        value: {
          stroke: target.stroke ? structuredClone(target.stroke) : null,
        },
      });
  }
  if (
    current.type === "vectorPath" &&
    target.type === "vectorPath" &&
    !overridden.has("vectorPath") &&
    !equal(current.commands, target.commands)
  )
    operations.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "vectorPath",
      value: { commands: structuredClone(target.commands) },
    });
  if (
    current.type === "rectangle" &&
    target.type === "rectangle" &&
    !overridden.has("radius") &&
    !equal(current.cornerRadius, target.cornerRadius)
  )
    operations.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "shape",
      value: { cornerRadius: structuredClone(target.cornerRadius) },
    });
  if (
    current.type === "rasterImage" &&
    target.type === "rasterImage" &&
    !overridden.has("crop") &&
    (current.fit !== target.fit || !equal(current.crop, target.crop))
  )
    operations.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "crop",
      value: {
        fit: target.fit,
        crop: target.crop ? structuredClone(target.crop) : null,
      },
    });
  if (
    !overridden.has("effects") &&
    current.type !== "adjustment" &&
    target.type !== "adjustment" &&
    !equal(current.effects, target.effects)
  )
    operations.push({
      kind: "updateNode",
      nodeId: current.id,
      propertyGroup: "effects",
      value: {
        effects: target.effects ? structuredClone(target.effects) : null,
      },
    });
  if (
    !overridden.has("asset") &&
    (current.type === "rasterImage" || current.type === "svg") &&
    (target.type === "rasterImage" || target.type === "svg") &&
    current.assetId !== target.assetId
  )
    operations.push({
      kind: "replaceAsset",
      nodeId: current.id,
      assetId: target.assetId,
      ...(target.type === "rasterImage" ? { fit: target.fit } : {}),
    });
  return operations;
};

export const compileBrandComponentVariant = (input: {
  frame: FrameDocument;
  pin: BrandPin;
  kit: BrandKitRecord;
  variant: SwitchBrandComponentVariantInput;
}): FrameOperation[] => {
  const variant = SwitchBrandComponentVariantInputSchema.parse(input.variant);
  if (
    input.pin.kitId !== input.kit.id ||
    input.pin.revision !== input.kit.revision ||
    input.pin.contentHash !== input.kit.contentHash
  )
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Component variant requires the project's exact immutable Brand Kit pin.",
    );
  const instanceNodes = listNodes(input.frame).filter(
    (node) => node.brandComponent?.instanceId === variant.instanceId,
  );
  const currentMetadata = instanceNodes[0]?.brandComponent;
  if (!currentMetadata)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Component instance was not found.",
    );
  const targetDefinition = input.kit.definitions.find(
    (definition) => definition.key === variant.definitionKey,
  );
  if (
    !targetDefinition?.variant ||
    targetDefinition.kind !== "component" ||
    targetDefinition.variant.groupKey !== currentMetadata.variantGroupKey
  )
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Target definition is not a compatible component variant.",
    );
  const idMap = Object.fromEntries(
    instanceNodes.map((node) => [node.brandComponent!.sourceNodeId, node.id]),
  );
  const targetNodes = instantiateBrandDefinition({
    kit: input.kit,
    definitionKey: targetDefinition.key,
    idMap,
    resourceMap: input.pin.resourceMap,
    instanceId: variant.instanceId,
  });
  const flattenedTargets: SceneNode[] = [];
  targetNodes.forEach((root) =>
    visitNode(root, (node) => flattenedTargets.push(node)),
  );
  const targetBySource = new Map(
    flattenedTargets.map((node) => [node.brandComponent!.sourceNodeId, node]),
  );
  if (targetBySource.size !== instanceNodes.length)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Component variant instance structure is incomplete.",
    );
  const operations: FrameOperation[] = [];
  for (const current of instanceNodes) {
    const metadata = current.brandComponent!;
    const target = targetBySource.get(metadata.sourceNodeId);
    if (!target?.brandComponent)
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Component variant is missing a source node.",
      );
    const activeOverrides = new Set(metadata.overrides);
    for (const property of activeOverrides)
      if (!target.brandComponent.allowedOverrides.includes(property))
        throw new RuntimeError(
          "INVALID_OPERATION",
          `Variant does not support the active ${property} override.`,
          { nodeId: current.id, property },
        );
    operations.push(
      metadataOperation(current.id, {
        ...structuredClone(metadata),
        allowedOverrides: [...allOverrideProperties],
      }),
      ...nodeVariantOperations(current, target, activeOverrides),
      metadataOperation(current.id, {
        ...structuredClone(target.brandComponent),
        overrides: [...activeOverrides],
      }),
    );
  }
  return operations;
};

const componentStructure = (
  roots: readonly SceneNode[],
  instanceId: string,
): string[] => {
  const values: string[] = [];
  const visit = (
    node: SceneNode,
    parentSourceId: string,
    index: number,
  ): void => {
    const metadata = node.brandComponent;
    const ownsNode = metadata?.instanceId === instanceId;
    const nextParent = ownsNode ? metadata.sourceNodeId : parentSourceId;
    if (ownsNode)
      values.push(
        `${parentSourceId}:${index}:${metadata.sourceNodeId}:${node.type}`,
      );
    const children =
      node.type === "group"
        ? node.children
        : node.type === "mask"
          ? [node.maskSource, ...node.children]
          : [];
    let ownedIndex = 0;
    for (const child of children) {
      const childOwns = child.brandComponent?.instanceId === instanceId;
      visit(child, nextParent, childOwns ? ownedIndex : index);
      if (childOwns) ownedIndex += 1;
    }
  };
  let rootIndex = 0;
  for (const root of roots) {
    const owns = root.brandComponent?.instanceId === instanceId;
    visit(root, "root", owns ? rootIndex : 0);
    if (owns) rootIndex += 1;
  }
  return values.sort();
};

export const compileBrandComponentMigration = (input: {
  frame: FrameDocument;
  pin: BrandPin;
  kit: BrandKitRecord;
  instanceId: string;
}): FrameOperation[] => {
  const instanceNodes = listNodes(input.frame).filter(
    (node) => node.brandComponent?.instanceId === input.instanceId,
  );
  const currentMetadata = instanceNodes[0]?.brandComponent;
  if (!currentMetadata)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Component instance was not found.",
    );
  const targetDefinition = input.kit.definitions.find(
    (definition) => definition.key === currentMetadata.definitionKey,
  );
  if (!targetDefinition || targetDefinition.kind !== "component")
    throw new RuntimeError(
      "INVALID_OPERATION",
      `Target Brand Kit does not contain component ${currentMetadata.definitionKey}.`,
    );
  const idMap = Object.fromEntries(
    instanceNodes.map((node) => [node.brandComponent!.sourceNodeId, node.id]),
  );
  const targetRoots = instantiateBrandDefinition({
    kit: input.kit,
    definitionKey: targetDefinition.key,
    idMap,
    resourceMap: input.pin.resourceMap,
    instanceId: input.instanceId,
  });
  if (
    !equal(
      componentStructure(input.frame.root.children, input.instanceId),
      componentStructure(targetRoots, input.instanceId),
    )
  )
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Component revision migration requires identical source IDs, node types, and hierarchy.",
      { instanceId: input.instanceId },
    );
  const targetNodes: SceneNode[] = [];
  targetRoots.forEach((root) =>
    visitNode(root, (node) => targetNodes.push(node)),
  );
  const targetBySource = new Map(
    targetNodes.map((node) => [node.brandComponent!.sourceNodeId, node]),
  );
  const operations: FrameOperation[] = [];
  for (const current of instanceNodes) {
    const metadata = current.brandComponent!;
    const target = targetBySource.get(metadata.sourceNodeId);
    if (!target?.brandComponent)
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Component revision is missing a source node.",
      );
    const activeOverrides = new Set(metadata.overrides);
    for (const property of activeOverrides)
      if (!target.brandComponent.allowedOverrides.includes(property))
        throw new RuntimeError(
          "INVALID_OPERATION",
          `Target revision does not support the active ${property} override.`,
          { nodeId: current.id, instanceId: input.instanceId, property },
        );
    operations.push(
      metadataOperation(current.id, {
        ...structuredClone(metadata),
        allowedOverrides: [...allOverrideProperties],
      }),
      ...nodeVariantOperations(current, target, activeOverrides),
      metadataOperation(current.id, {
        ...structuredClone(target.brandComponent),
        overrides: [...activeOverrides],
      }),
    );
  }
  return operations;
};
