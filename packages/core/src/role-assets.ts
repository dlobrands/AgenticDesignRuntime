import type { DesignPlan, FrameDocument } from "./model.js";
import type { FrameOperation } from "./operations.js";
import type {
  DesignPlanCompilation,
  DesignPlanCompilationWarning,
  DesignPlanCompiledChange,
} from "./intent-compiler.js";
import { findNode, isLocked } from "./scene.js";

type CompileInput = {
  plan: DesignPlan;
  frame: FrameDocument;
  roleId: string;
};

export const compileRoleAssetReplacement = (
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
  const role = input.plan.semanticRoles.find(
    (candidate) => candidate.id === input.roleId,
  );
  const result = (): DesignPlanCompilation => ({
    schemaVersion: 1,
    planId: input.plan.id,
    frameId: input.frame.id,
    baseRevision: input.frame.revision,
    selectedRoleIds: role ? [role.id] : [],
    operations,
    changes,
    warnings,
    protectedDecisionIds: [...protectedDecisionIds],
  });

  if (input.plan.approval.state !== "approved")
    warn({
      code: "PLAN_NOT_APPROVED",
      severity: "warning",
      message: `Design plan is ${input.plan.approval.state}; asset replacement remains preview-only and does not imply approval.`,
    });
  if (!input.plan.targetFrameId) {
    warn({
      code: "TARGET_FRAME_REQUIRED",
      severity: "warning",
      message:
        "Design plan has no target frame and cannot compile an asset replacement.",
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
  if (!role) {
    warn({
      code: "ROLE_NOT_FOUND",
      severity: "warning",
      message: `Requested semantic role ${input.roleId} is not present in the plan.`,
      roleId: input.roleId,
    });
    return result();
  }
  if (!role.nodeId) {
    warn({
      code: "ROLE_UNBOUND",
      severity: "warning",
      message: `Role “${role.name}” has no bound node.`,
      roleId: role.id,
    });
    return result();
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
    return result();
  }
  if (isLocked(input.frame, node.id)) {
    warn({
      code: "NODE_LOCKED",
      severity: "warning",
      message: `Role “${role.name}” is bound to a locked node; no asset operation was emitted for it.`,
      roleId: role.id,
      nodeIds: [node.id],
    });
    return result();
  }
  const assignment = input.plan.assetAssignments.find(
    (candidate) => candidate.roleId === role.id,
  );
  if (!assignment) {
    warn({
      code: "ASSET_ASSIGNMENT_NOT_FOUND",
      severity: "warning",
      message: `Role “${role.name}” has no declared asset assignment.`,
      roleId: role.id,
      nodeIds: [node.id],
    });
    return result();
  }
  if (node.type !== "rasterImage" && node.type !== "svg") {
    warn({
      code: "INCOMPATIBLE_NODE",
      severity: "warning",
      message: `Asset assignment for role “${role.name}” requires a raster or SVG node.`,
      roleId: role.id,
      nodeIds: [node.id],
    });
    return result();
  }

  const protectedFor = (
    kind: DesignPlan["protectedDecisions"][number]["kind"],
  ) =>
    input.plan.protectedDecisions.filter(
      (decision) =>
        (decision.kind === kind ||
          decision.kind === "node" ||
          decision.kind === "role") &&
        (!decision.roleId || decision.roleId === role.id) &&
        (!decision.nodeId || decision.nodeId === node.id),
    );
  const preserve = (
    kind: DesignPlan["protectedDecisions"][number]["kind"],
    subject: string,
  ): boolean => {
    const decisions = protectedFor(kind);
    if (decisions.length === 0) return false;
    decisions.forEach((decision) => protectedDecisionIds.add(decision.id));
    warn({
      code: "PROTECTED_DECISION",
      severity: "info",
      message: `${subject} for role “${role.name}” was preserved by protected human decision.`,
      roleId: role.id,
      nodeIds: [node.id],
      protectedDecisionIds: decisions.map((decision) => decision.id),
    });
    return true;
  };

  if (!preserve("node", "Asset")) {
    const fit =
      node.type === "rasterImage"
        ? assignment.fit === "stretch"
          ? "fill"
          : assignment.fit
        : undefined;
    if (
      node.assetId !== assignment.assetId ||
      (node.type === "rasterImage" && node.fit !== fit)
    )
      push(
        {
          kind: "replaceAsset",
          nodeId: node.id,
          assetId: assignment.assetId,
          ...(fit ? { fit } : {}),
        },
        {
          intent: "asset",
          roleId: role.id,
          nodeId: node.id,
          summary: `Applied declared asset assignment to “${role.name}”.`,
        },
      );
  }
  if (
    node.type === "rasterImage" &&
    !assignment.preserveCrop &&
    node.crop &&
    !preserve("crop", "Crop")
  )
    push(
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "crop",
        value: { crop: null },
      },
      {
        intent: "crop",
        roleId: role.id,
        nodeId: node.id,
        summary: `Reset crop for “${role.name}” as declared.`,
      },
    );

  return result();
};
