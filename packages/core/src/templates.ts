import { RuntimeError } from "./errors.js";
import { createTransform } from "./factories.js";
import type {
  FrameDocument,
  GroupNode,
  ProjectTemplateDefinition,
  ProjectTemplateSlot,
  SceneNode,
} from "./model.js";
import type { FrameOperation } from "./operations.js";
import { ProjectTemplateDefinitionSchema } from "./schema.js";

const visitNode = (node: SceneNode, visit: (node: SceneNode) => void): void => {
  visit(node);
  if (node.type === "group")
    node.children.forEach((child) => visitNode(child, visit));
  if (node.type === "mask") {
    visitNode(node.maskSource, visit);
    node.children.forEach((child) => visitNode(child, visit));
  }
};

export const createProjectTemplateDefinition = (input: {
  id: string;
  name: string;
  description?: string;
  nodes: readonly SceneNode[];
  slots: readonly ProjectTemplateSlot[];
  now: string;
  createdAt?: string;
}): ProjectTemplateDefinition => {
  const nodes = structuredClone([...input.nodes]);
  nodes.forEach((root) =>
    visitNode(root, (node) => {
      delete node.templateInstance;
      delete node.templateSlot;
    }),
  );
  return ProjectTemplateDefinitionSchema.parse({
    id: input.id,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    createdAt: input.createdAt ?? input.now,
    updatedAt: input.now,
    nodes,
    slots: structuredClone([...input.slots]),
  });
};

export const templateSourceNodeIds = (
  template: ProjectTemplateDefinition,
): string[] => {
  const ids: string[] = [];
  template.nodes.forEach((root) =>
    visitNode(root, (node) => ids.push(node.id)),
  );
  return ids;
};

export const instantiateProjectTemplate = (input: {
  template: ProjectTemplateDefinition;
  instanceId: string;
  groupId: string;
  idMap: Record<string, string>;
}): GroupNode => {
  const sourceIds = templateSourceNodeIds(input.template);
  const replacements = sourceIds.map((sourceId) => input.idMap[sourceId]);
  if (replacements.some((replacement) => !replacement))
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Template application requires one replacement ID for every source node.",
    );
  if (new Set(replacements).size !== replacements.length)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Template replacement IDs must be unique.",
    );
  if (replacements.includes(input.groupId))
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Template group ID must be distinct from replacement node IDs.",
    );
  const slots = new Map(
    input.template.slots.map((slot) => [slot.nodeId, slot]),
  );
  const nodes = structuredClone(input.template.nodes);
  nodes.forEach((root) =>
    visitNode(root, (node) => {
      const sourceNodeId = node.id;
      node.id = input.idMap[sourceNodeId]!;
      node.templateInstance = {
        templateId: input.template.id,
        instanceId: input.instanceId,
        sourceNodeId,
      };
      const slot = slots.get(sourceNodeId);
      if (slot)
        node.templateSlot = {
          slotId: slot.slotId,
          key: slot.key,
          name: slot.name,
          role: slot.role,
        };
      else delete node.templateSlot;
      if (node.type === "adjustment" && input.idMap[node.targetId])
        node.targetId = input.idMap[node.targetId]!;
    }),
  );
  const right = Math.max(
    1,
    ...nodes.map((node) => node.transform.x + node.transform.width),
  );
  const bottom = Math.max(
    1,
    ...nodes.map((node) => node.transform.y + node.transform.height),
  );
  return {
    id: input.groupId,
    type: "group",
    name: input.template.name,
    visible: true,
    locked: false,
    transform: createTransform({ width: right, height: bottom }),
    opacity: 1,
    blendMode: "pass-through",
    templateInstance: {
      templateId: input.template.id,
      instanceId: input.instanceId,
    },
    children: nodes,
  };
};

export const detachTemplateInstanceOperations = (
  frame: FrameDocument,
  instanceId: string,
): FrameOperation[] => {
  const operations: FrameOperation[] = [];
  frame.root.children.forEach((root) =>
    visitNode(root, (node) => {
      if (node.templateInstance?.instanceId !== instanceId) return;
      operations.push({
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "templateMetadata",
        value: { templateInstance: null, templateSlot: null },
      });
    }),
  );
  if (operations.length === 0)
    throw new RuntimeError(
      "INVALID_OPERATION",
      `Template instance ${instanceId} was not found.`,
    );
  return operations;
};
