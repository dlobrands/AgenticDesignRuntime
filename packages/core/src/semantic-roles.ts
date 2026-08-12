import { z } from "zod";
import { RuntimeError } from "./errors.js";
import type { DesignPlan, FrameDocument } from "./model.js";
import { findNode, walkScene } from "./scene.js";

export const AssignSemanticRoleInputSchema = z
  .object({
    nodeId: z.string().uuid().nullable(),
    copyItemId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type AssignSemanticRoleInput = z.infer<
  typeof AssignSemanticRoleInputSchema
>;

export type SemanticRoleInspection = {
  id: string;
  key: string;
  name: string;
  role: DesignPlan["semanticRoles"][number]["role"];
  required: boolean;
  nodeId?: string;
  copyItemId?: string;
  bindingStatus: "bound" | "unbound" | "missingTargetFrame" | "missingNode";
  node?: {
    id: string;
    name: string;
    type: string;
    visible: boolean;
    locked: boolean;
  };
  protectedDecisionIds: string[];
};

export type DesignRoleInspectionReport = {
  schemaVersion: 1;
  planId: string;
  planName: string;
  targetFrameId?: string;
  targetFrameRevision?: number;
  roles: SemanticRoleInspection[];
  summary: {
    total: number;
    bound: number;
    unbound: number;
    missing: number;
    requiredMissing: number;
  };
};

const effectiveVisible = (frame: FrameDocument, nodeId: string): boolean => {
  const visit = [...walkScene(frame)].find(
    (candidate) => candidate.node.id === nodeId,
  );
  if (!visit) return false;
  for (const id of visit.path) {
    if (id === "root" || id === "maskSource") continue;
    const node = findNode(frame, id);
    if (!node?.visible || ("opacity" in node && node.opacity <= 0))
      return false;
  }
  return true;
};

export const inspectDesignRoles = (
  plan: DesignPlan,
  frame?: FrameDocument,
): DesignRoleInspectionReport => {
  const roles = plan.semanticRoles.map((role): SemanticRoleInspection => {
    const node =
      role.nodeId && frame ? findNode(frame, role.nodeId) : undefined;
    const protectedDecisionIds = plan.protectedDecisions
      .filter(
        (decision) =>
          decision.roleId === role.id ||
          (role.nodeId !== undefined && decision.nodeId === role.nodeId),
      )
      .map((decision) => decision.id)
      .sort();
    const bindingStatus = !role.nodeId
      ? "unbound"
      : !frame
        ? "missingTargetFrame"
        : !node
          ? "missingNode"
          : "bound";
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      role: role.role,
      required: role.required,
      ...(role.nodeId ? { nodeId: role.nodeId } : {}),
      ...(role.copyItemId ? { copyItemId: role.copyItemId } : {}),
      bindingStatus,
      ...(node
        ? {
            node: {
              id: node.id,
              name: node.name,
              type: node.type,
              visible: effectiveVisible(frame!, node.id),
              locked: node.locked,
            },
          }
        : {}),
      protectedDecisionIds,
    };
  });
  const missing = roles.filter(
    (role) =>
      role.bindingStatus === "missingNode" ||
      role.bindingStatus === "missingTargetFrame",
  );
  return {
    schemaVersion: 1,
    planId: plan.id,
    planName: plan.name,
    ...(plan.targetFrameId ? { targetFrameId: plan.targetFrameId } : {}),
    ...(frame ? { targetFrameRevision: frame.revision } : {}),
    roles,
    summary: {
      total: roles.length,
      bound: roles.filter((role) => role.bindingStatus === "bound").length,
      unbound: roles.filter((role) => role.bindingStatus === "unbound").length,
      missing: missing.length,
      requiredMissing: roles.filter(
        (role) => role.required && role.bindingStatus !== "bound",
      ).length,
    },
  };
};

export const assignSemanticRole = (input: {
  plan: DesignPlan;
  roleId: string;
  assignment: AssignSemanticRoleInput;
  now: string;
}): DesignPlan => {
  const role = input.plan.semanticRoles.find(
    (candidate) => candidate.id === input.roleId,
  );
  if (!role)
    throw new RuntimeError(
      "INVALID_OPERATION",
      `Semantic role ${input.roleId} was not found in design plan ${input.plan.id}.`,
    );
  const roleProtection = input.plan.protectedDecisions.find(
    (decision) => decision.kind === "role" && decision.roleId === role.id,
  );
  if (roleProtection)
    throw new RuntimeError(
      "INVALID_OPERATION",
      `Semantic role “${role.name}” is protected by decision ${roleProtection.id}.`,
      { protectedDecisionId: roleProtection.id, roleId: role.id },
      409,
    );
  const copyChanged =
    input.assignment.copyItemId !== undefined &&
    input.assignment.copyItemId !== (role.copyItemId ?? null);
  if (copyChanged) {
    const copyProtection = input.plan.protectedDecisions.find(
      (decision) => decision.kind === "copy" && decision.roleId === role.id,
    );
    if (copyProtection)
      throw new RuntimeError(
        "INVALID_OPERATION",
        `Copy assignment for “${role.name}” is protected by decision ${copyProtection.id}.`,
        { protectedDecisionId: copyProtection.id, roleId: role.id },
        409,
      );
  }
  const nodeChanged = input.assignment.nodeId !== (role.nodeId ?? null);
  if (!nodeChanged && !copyChanged)
    throw new RuntimeError(
      "INVALID_OPERATION",
      `Semantic role “${role.name}” already has the requested assignment.`,
      { roleId: role.id },
      409,
    );
  const updatedRole = {
    ...role,
    ...(input.assignment.nodeId
      ? { nodeId: input.assignment.nodeId }
      : { nodeId: undefined }),
    ...(input.assignment.copyItemId === undefined
      ? {}
      : input.assignment.copyItemId
        ? { copyItemId: input.assignment.copyItemId }
        : { copyItemId: undefined }),
  };
  if (updatedRole.nodeId === undefined) delete updatedRole.nodeId;
  if (updatedRole.copyItemId === undefined) delete updatedRole.copyItemId;
  return {
    ...structuredClone(input.plan),
    semanticRoles: input.plan.semanticRoles.map((candidate) =>
      candidate.id === role.id ? updatedRole : structuredClone(candidate),
    ),
    approval: {
      state: "draft",
      notes: [
        ...input.plan.approval.notes,
        `Role assignment for “${role.name}” changed after the prior plan state.`,
      ].slice(-64),
    },
    updatedAt: input.now,
  };
};
