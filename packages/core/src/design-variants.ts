import type { DesignPlan, FrameDocument } from "./model.js";
import type { FrameOperation } from "./operations.js";
import type {
  DesignPlanCompilation,
  DesignPlanCompilationWarning,
  DesignPlanCompiledChange,
} from "./intent-compiler.js";
import { compileDesignLayout } from "./design-layout.js";
import { findNode, isLocked } from "./scene.js";

type CompileInput = {
  plan: DesignPlan;
  frame: FrameDocument;
  variantRuleId: string;
};

export const compileDesignVariant = (
  input: CompileInput,
): DesignPlanCompilation => {
  const warnings: DesignPlanCompilationWarning[] = [];
  const operations: FrameOperation[] = [];
  const changes: DesignPlanCompiledChange[] = [];
  const protectedDecisionIds = new Set<string>();
  const warn = (warning: DesignPlanCompilationWarning) =>
    warnings.push(warning);
  const push = (
    operation: FrameOperation,
    change: Omit<DesignPlanCompiledChange, "operationIndex">,
  ) => {
    changes.push({ ...change, operationIndex: operations.length });
    operations.push(operation);
  };

  if (input.plan.approval.state !== "approved")
    warn({
      code: "PLAN_NOT_APPROVED",
      severity: "warning",
      message: `Design plan is ${input.plan.approval.state}; variant application remains preview-only and does not imply approval.`,
    });
  const variant = input.plan.variantRules.find(
    (candidate) => candidate.id === input.variantRuleId,
  );
  const selectedRoleIds =
    variant?.roleBehaviors.map((behavior) => behavior.roleId) ?? [];
  const result = (): DesignPlanCompilation => ({
    schemaVersion: 1,
    planId: input.plan.id,
    frameId: input.frame.id,
    baseRevision: input.frame.revision,
    selectedRoleIds,
    operations,
    changes,
    warnings,
    protectedDecisionIds: [...protectedDecisionIds],
  });

  if (!input.plan.targetFrameId) {
    warn({
      code: "TARGET_FRAME_REQUIRED",
      severity: "warning",
      message: "Design plan has no target frame and cannot compile a variant.",
    });
    return result();
  }
  if (input.plan.targetFrameId !== input.frame.id) {
    warn({
      code: "TARGET_FRAME_MISMATCH",
      severity: "warning",
      message: `Design plan targets frame ${input.plan.targetFrameId}, not ${input.frame.id}.`,
    });
    return result();
  }
  if (!variant) {
    warn({
      code: "VARIANT_NOT_FOUND",
      severity: "warning",
      message: `Variant rule ${input.variantRuleId} is not present in the plan.`,
    });
    return result();
  }
  if (
    variant.format &&
    (variant.format.width !== input.frame.canvas.width ||
      variant.format.height !== input.frame.canvas.height)
  ) {
    warn({
      code: "UNSUPPORTED_INTENT",
      severity: "warning",
      message: `Variant “${variant.name}” requires an explicit ${variant.format.width} × ${variant.format.height} frame resize before any role behavior can be reviewed; no partial variant was compiled.`,
    });
    return result();
  }

  const layoutRoleIds: string[] = [];
  for (const behavior of variant.roleBehaviors) {
    if (behavior.behavior === "preserve" || behavior.behavior === "hide")
      continue;
    const role = input.plan.semanticRoles.find(
      (candidate) => candidate.id === behavior.roleId,
    );
    if (!role) {
      warn({
        code: "ROLE_NOT_FOUND",
        severity: "warning",
        message: `Variant “${variant.name}” references missing role ${behavior.roleId}.`,
        roleId: behavior.roleId,
      });
      continue;
    }
    const anchor = input.plan.anchors.find(
      (candidate) => candidate.roleId === role.id,
    );
    if (
      behavior.behavior === "resize" &&
      anchor &&
      anchor.horizontal !== "stretch" &&
      anchor.vertical !== "stretch"
    ) {
      warn({
        code: "UNSUPPORTED_INTENT",
        severity: "warning",
        message: `Resize behavior for role “${role.name}” requires an explicit horizontal or vertical stretch anchor.`,
        roleId: role.id,
        ...(role.nodeId ? { nodeIds: [role.nodeId] } : {}),
      });
      continue;
    }
    layoutRoleIds.push(role.id);
  }
  if (layoutRoleIds.length > 0) {
    const layout = compileDesignLayout({
      plan: input.plan,
      frame: input.frame,
      roleIds: layoutRoleIds,
      includeSafeArea: false,
    });
    for (const warning of layout.warnings)
      if (
        warning.code !== "PLAN_NOT_APPROVED" &&
        warning.code !== "TARGET_FRAME_REQUIRED" &&
        warning.code !== "TARGET_FRAME_MISMATCH"
      )
        warn(warning);
    layout.protectedDecisionIds.forEach((id) => protectedDecisionIds.add(id));
    for (const change of layout.changes) {
      const role = input.plan.semanticRoles.find(
        (candidate) => candidate.id === change.roleId,
      );
      push(layout.operations[change.operationIndex]!, {
        intent: "variant",
        ...(change.roleId ? { roleId: change.roleId } : {}),
        ...(change.nodeId ? { nodeId: change.nodeId } : {}),
        summary: `Applied ${
          variant.roleBehaviors.find(
            (behavior) => behavior.roleId === change.roleId,
          )?.behavior ?? "layout"
        } behavior to “${role?.name ?? change.roleId}” for variant “${variant.name}”.`,
      });
    }
  }

  for (const behavior of variant.roleBehaviors) {
    if (behavior.behavior !== "hide") continue;
    const role = input.plan.semanticRoles.find(
      (candidate) => candidate.id === behavior.roleId,
    );
    if (!role) {
      warn({
        code: "ROLE_NOT_FOUND",
        severity: "warning",
        message: `Variant “${variant.name}” references missing role ${behavior.roleId}.`,
        roleId: behavior.roleId,
      });
      continue;
    }
    if (!role.nodeId) {
      warn({
        code: "ROLE_UNBOUND",
        severity: "warning",
        message: `Role “${role.name}” has no bound node.`,
        roleId: role.id,
      });
      continue;
    }
    const node = findNode(input.frame, role.nodeId);
    if (!node) {
      warn({
        code: "NODE_NOT_FOUND",
        severity: "warning",
        message: `Role “${role.name}” references missing node ${role.nodeId}.`,
        roleId: role.id,
        nodeIds: [role.nodeId],
      });
      continue;
    }
    if (isLocked(input.frame, node.id)) {
      warn({
        code: "NODE_LOCKED",
        severity: "warning",
        message: `Role “${role.name}” is bound to a locked node; it was not hidden.`,
        roleId: role.id,
        nodeIds: [node.id],
      });
      continue;
    }
    const decisions = input.plan.protectedDecisions.filter(
      (decision) =>
        (decision.kind === "node" || decision.kind === "role") &&
        (!decision.roleId || decision.roleId === role.id) &&
        (!decision.nodeId || decision.nodeId === node.id),
    );
    if (decisions.length > 0) {
      decisions.forEach((decision) => protectedDecisionIds.add(decision.id));
      warn({
        code: "PROTECTED_DECISION",
        severity: "info",
        message: `Visibility for role “${role.name}” was preserved by protected human decision.`,
        roleId: role.id,
        nodeIds: [node.id],
        protectedDecisionIds: decisions.map((decision) => decision.id),
      });
      continue;
    }
    if (node.visible)
      push(
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "visibility",
          value: { visible: false },
        },
        {
          intent: "variant",
          roleId: role.id,
          nodeId: node.id,
          summary: `Hid “${role.name}” for variant “${variant.name}”.`,
        },
      );
  }

  return result();
};
