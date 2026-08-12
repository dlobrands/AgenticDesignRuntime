import { z } from "zod";
import type { DesignPlan, FrameDocument, SceneNode } from "./model.js";
import type { FrameOperation } from "./operations.js";
import type {
  DesignPlanCompilation,
  DesignPlanCompilationWarning,
  DesignPlanCompiledChange,
} from "./intent-compiler.js";
import { findNode, isLocked } from "./scene.js";

const uuid = z.string().uuid();

export const ReflowContentOptionsSchema = z
  .object({
    roleIds: z
      .array(uuid)
      .min(1)
      .max(100)
      .refine((values) => new Set(values).size === values.length, {
        message: "Reflow role IDs must be unique.",
      }),
  })
  .strict();

export type ReflowContentOptions = z.infer<typeof ReflowContentOptionsSchema>;

type CompileInput = {
  plan: DesignPlan;
  frame: FrameDocument;
  roleIds?: string[];
  includeSafeArea: boolean;
};

const round = (value: number): number => Math.round(value * 1_000) / 1_000;
const changed = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) !== JSON.stringify(right);

export const compileDesignLayout = (
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
      message: `Design plan is ${input.plan.approval.state}; layout remains preview-only and does not imply approval.`,
    });

  const requestedRoleIds =
    input.roleIds ?? input.plan.semanticRoles.map((role) => role.id);
  const roles = requestedRoleIds
    .map((roleId) => {
      const role = input.plan.semanticRoles.find(
        (candidate) => candidate.id === roleId,
      );
      if (!role)
        warn({
          code: "ROLE_NOT_FOUND",
          severity: "warning",
          message: `Requested semantic role ${roleId} is not present in the plan.`,
          roleId,
        });
      return role;
    })
    .filter((role): role is DesignPlan["semanticRoles"][number] =>
      Boolean(role),
    );

  const result = (): DesignPlanCompilation => ({
    schemaVersion: 1,
    planId: input.plan.id,
    frameId: input.frame.id,
    baseRevision: input.frame.revision,
    selectedRoleIds: roles.map((role) => role.id),
    operations,
    changes,
    warnings,
    protectedDecisionIds: [...protectedDecisionIds],
  });

  if (!input.plan.targetFrameId) {
    warn({
      code: "TARGET_FRAME_REQUIRED",
      severity: "warning",
      message:
        "Design plan has no target frame and cannot compile layout operations.",
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

  if (input.includeSafeArea) {
    const globalSafeAreas = input.plan.safeAreas.filter(
      (area) => !area.regionId,
    );
    const globalPositionDecisions = input.plan.protectedDecisions.filter(
      (decision) =>
        decision.kind === "position" && !decision.roleId && !decision.nodeId,
    );
    if (globalSafeAreas.length === 1) {
      const safeArea = globalSafeAreas[0]!;
      const value = {
        top: round(safeArea.top * input.frame.canvas.height),
        right: round(safeArea.right * input.frame.canvas.width),
        bottom: round(safeArea.bottom * input.frame.canvas.height),
        left: round(safeArea.left * input.frame.canvas.width),
      };
      if (globalPositionDecisions.length > 0) {
        globalPositionDecisions.forEach((decision) =>
          protectedDecisionIds.add(decision.id),
        );
        warn({
          code: "PROTECTED_DECISION",
          severity: "info",
          message: `Safe area “${safeArea.name}” was preserved by protected human decision.`,
          protectedDecisionIds: globalPositionDecisions.map(
            (decision) => decision.id,
          ),
        });
      } else if (changed(input.frame.canvas.safeArea, value))
        push(
          { kind: "setCanvas", value: { safeArea: value } },
          {
            intent: "safeArea",
            summary: `Applied safe area “${safeArea.name}”.`,
          },
        );
    } else if (globalSafeAreas.length > 1)
      warn({
        code: "INVALID_LAYOUT",
        severity: "warning",
        message:
          "Multiple global safe areas are ambiguous; no canvas safe area was compiled.",
      });
    if (input.plan.safeAreas.some((area) => area.regionId))
      warn({
        code: "UNSUPPORTED_INTENT",
        severity: "info",
        message:
          "Region-scoped safe areas remain inspectable intent and are not flattened into the single canvas safe area.",
      });
  }

  const protectedPosition = (
    role: DesignPlan["semanticRoles"][number],
    node: SceneNode,
  ): boolean => {
    const decisions = input.plan.protectedDecisions.filter(
      (decision) =>
        (decision.kind === "position" ||
          decision.kind === "node" ||
          decision.kind === "role") &&
        (!decision.roleId || decision.roleId === role.id) &&
        (!decision.nodeId || decision.nodeId === node.id),
    );
    if (decisions.length === 0) return false;
    decisions.forEach((decision) => protectedDecisionIds.add(decision.id));
    warn({
      code: "PROTECTED_DECISION",
      severity: "info",
      message: `Position for role “${role.name}” was preserved by protected human decision.`,
      roleId: role.id,
      nodeIds: [node.id],
      protectedDecisionIds: decisions.map((decision) => decision.id),
    });
    return true;
  };

  for (const role of roles) {
    if (!role.nodeId) {
      if (role.required)
        warn({
          code: "ROLE_UNBOUND",
          severity: "warning",
          message: `Required role “${role.name}” has no bound node.`,
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
        message: `Role “${role.name}” is bound to a locked node; no layout operation was emitted for it.`,
        roleId: role.id,
        nodeIds: [node.id],
      });
      continue;
    }
    const anchor = input.plan.anchors.find(
      (candidate) => candidate.roleId === role.id,
    );
    if (!anchor) {
      if (input.roleIds)
        warn({
          code: "UNSUPPORTED_INTENT",
          severity: "warning",
          message: `Role “${role.name}” has no explicit anchor and cannot be reflowed deterministically.`,
          roleId: role.id,
          nodeIds: [node.id],
        });
      continue;
    }
    if (protectedPosition(role, node)) continue;
    const region = anchor.regionId
      ? input.plan.layoutRegions.find(
          (candidate) => candidate.id === anchor.regionId,
        )
      : { x: 0, y: 0, width: 1, height: 1 };
    if (!region) {
      warn({
        code: "INVALID_LAYOUT",
        severity: "warning",
        message: `Anchor for role “${role.name}” references an unavailable layout region.`,
        roleId: role.id,
        nodeIds: [node.id],
      });
      continue;
    }

    const left = region.x * input.frame.canvas.width;
    const top = region.y * input.frame.canvas.height;
    const width = region.width * input.frame.canvas.width;
    const height = region.height * input.frame.canvas.height;
    const offsetX = anchor.offsetX * input.frame.canvas.width;
    const offsetY = anchor.offsetY * input.frame.canvas.height;
    const value: Partial<SceneNode["transform"]> = {};
    if (anchor.horizontal === "start") value.x = round(left + offsetX);
    else if (anchor.horizontal === "center")
      value.x = round(left + (width - node.transform.width) / 2 + offsetX);
    else if (anchor.horizontal === "end")
      value.x = round(left + width - node.transform.width + offsetX);
    else {
      const stretched = width - Math.abs(offsetX) * 2;
      if (stretched <= 0)
        warn({
          code: "INVALID_LAYOUT",
          severity: "warning",
          message: `Horizontal stretch for role “${role.name}” produces non-positive width.`,
          roleId: role.id,
          nodeIds: [node.id],
        });
      else {
        value.x = round(left + Math.abs(offsetX));
        value.width = round(stretched);
      }
    }
    if (anchor.vertical === "start") value.y = round(top + offsetY);
    else if (anchor.vertical === "center")
      value.y = round(top + (height - node.transform.height) / 2 + offsetY);
    else if (anchor.vertical === "end")
      value.y = round(top + height - node.transform.height + offsetY);
    else {
      const stretched = height - Math.abs(offsetY) * 2;
      if (stretched <= 0)
        warn({
          code: "INVALID_LAYOUT",
          severity: "warning",
          message: `Vertical stretch for role “${role.name}” produces non-positive height.`,
          roleId: role.id,
          nodeIds: [node.id],
        });
      else {
        value.y = round(top + Math.abs(offsetY));
        value.height = round(stretched);
      }
    }
    const next = { ...node.transform, ...value };
    if (changed(node.transform, next))
      push(
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "transform",
          value,
        },
        {
          intent: "layout",
          roleId: role.id,
          nodeId: node.id,
          summary: `Applied anchor for “${role.name}”.`,
        },
      );
  }

  return result();
};
