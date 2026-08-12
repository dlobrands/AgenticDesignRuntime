import { z } from "zod";
import type { BrandKitRecord } from "./brand.js";
import type { DesignPlan, FrameDocument, SceneNode } from "./model.js";
import type { FrameOperation } from "./operations.js";
import type {
  DesignPlanCompilation,
  DesignPlanCompilationWarning,
  DesignPlanCompiledChange,
} from "./intent-compiler.js";
import { findNode, isLocked } from "./scene.js";

const uuid = z.string().uuid();

export const CompileBrandBindingsOptionsSchema = z
  .object({
    roleIds: z
      .array(uuid)
      .min(1)
      .max(100)
      .refine((values) => new Set(values).size === values.length, {
        message: "Brand-binding role IDs must be unique.",
      })
      .optional(),
  })
  .strict();

export type CompileBrandBindingsOptions = z.infer<
  typeof CompileBrandBindingsOptionsSchema
>;

type CompileInput = CompileBrandBindingsOptions & {
  plan: DesignPlan;
  frame: FrameDocument;
  brandKit?: BrandKitRecord;
  brandResourceMap?: Record<string, string>;
};

const changed = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) !== JSON.stringify(right);

const fillNode = (
  node: SceneNode,
): node is Extract<
  SceneNode,
  { type: "rectangle" | "ellipse" | "vectorPath" }
> =>
  node.type === "rectangle" ||
  node.type === "ellipse" ||
  node.type === "vectorPath";

export const compileBrandBindings = (
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
      message: `Design plan is ${input.plan.approval.state}; Brand binding remains preview-only and does not imply approval.`,
    });

  const requestedRoleIds = input.roleIds ?? [
    ...new Set(input.plan.brandBindings.map((binding) => binding.roleId)),
  ];
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
        "Design plan has no target frame and cannot compile Brand bindings.",
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
  if (requestedRoleIds.length === 0) {
    warn({
      code: "BRAND_BINDING_NOT_FOUND",
      severity: "warning",
      message: "Design plan has no declared Brand bindings.",
    });
    return result();
  }

  for (const role of roles) {
    const bindings = input.plan.brandBindings.filter(
      (candidate) => candidate.roleId === role.id,
    );
    if (bindings.length === 0) {
      warn({
        code: "BRAND_BINDING_NOT_FOUND",
        severity: "warning",
        message: `Role “${role.name}” has no declared Brand binding.`,
        roleId: role.id,
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
        message: `Role “${role.name}” is bound to a locked node; no Brand operation was emitted for it.`,
        roleId: role.id,
        nodeIds: [node.id],
      });
      continue;
    }
    const decisions = input.plan.protectedDecisions.filter(
      (decision) =>
        (decision.kind === "brandBinding" ||
          decision.kind === "node" ||
          decision.kind === "role") &&
        (!decision.roleId || decision.roleId === role.id) &&
        (!decision.nodeId || decision.nodeId === node.id),
    );
    if (decisions.length > 0) {
      decisions.forEach((decision) => protectedDecisionIds.add(decision.id));
      warn({
        code: "PROTECTED_DECISION",
        severity: "info",
        message: `Brand binding for role “${role.name}” was preserved by protected human decision.`,
        roleId: role.id,
        nodeIds: [node.id],
        protectedDecisionIds: decisions.map((decision) => decision.id),
      });
      continue;
    }
    if (!input.brandKit) {
      warn({
        code: "BRAND_KIT_UNAVAILABLE",
        severity: "warning",
        message: `Brand bindings for role “${role.name}” cannot resolve without the exact pinned Brand Kit.`,
        roleId: role.id,
        nodeIds: [node.id],
      });
      continue;
    }

    for (const binding of bindings) {
      if (binding.property === "typography") {
        const token = input.brandKit.typeRoles.find(
          (candidate) => candidate.key === binding.tokenKey,
        );
        if (!token) {
          warn({
            code: "BRAND_TOKEN_UNAVAILABLE",
            severity: "warning",
            message: `Typography token ${binding.tokenKey} is unavailable.`,
            roleId: role.id,
            nodeIds: [node.id],
          });
          continue;
        }
        if (node.type !== "text") {
          warn({
            code: "INCOMPATIBLE_NODE",
            severity: "warning",
            message: `Typography token ${binding.tokenKey} requires a text node.`,
            roleId: role.id,
            nodeIds: [node.id],
          });
          continue;
        }
        const fontId = input.brandResourceMap?.[token.font.id];
        if (!fontId) {
          warn({
            code: "BRAND_TOKEN_UNAVAILABLE",
            severity: "warning",
            message: `Typography token ${binding.tokenKey} has no pinned project font mapping.`,
            roleId: role.id,
            nodeIds: [node.id],
          });
          continue;
        }
        const color = token.colorToken
          ? input.brandKit.palette.find((item) => item.key === token.colorToken)
              ?.color
          : undefined;
        const value = {
          fontId,
          fontSize: token.fontSize,
          lineHeight: token.lineHeight,
          letterSpacing: token.letterSpacing,
          ...(color ? { color } : {}),
        };
        if (
          Object.entries(value).some(
            ([key, candidate]) =>
              node.typography[key as keyof typeof node.typography] !==
              candidate,
          )
        )
          push(
            {
              kind: "updateNode",
              nodeId: node.id,
              propertyGroup: "typography",
              value,
            },
            {
              intent: "brand",
              roleId: role.id,
              nodeId: node.id,
              summary: `Applied typography token ${binding.tokenKey}.`,
            },
          );
        continue;
      }
      if (["effect", "spacing", "radius"].includes(binding.property)) {
        warn({
          code: "UNSUPPORTED_INTENT",
          severity: "info",
          message: `${binding.property} token ${binding.tokenKey} remains intent until its live token contract exists.`,
          roleId: role.id,
          nodeIds: [node.id],
        });
        continue;
      }
      const token = input.brandKit.palette.find(
        (candidate) => candidate.key === binding.tokenKey,
      );
      if (!token) {
        warn({
          code: "BRAND_TOKEN_UNAVAILABLE",
          severity: "warning",
          message: `Palette token ${binding.tokenKey} is unavailable.`,
          roleId: role.id,
          nodeIds: [node.id],
        });
        continue;
      }
      if (binding.property === "textColor") {
        if (node.type !== "text")
          warn({
            code: "INCOMPATIBLE_NODE",
            severity: "warning",
            message: `Text-color token ${binding.tokenKey} requires a text node.`,
            roleId: role.id,
            nodeIds: [node.id],
          });
        else if (node.typography.color !== token.color)
          push(
            {
              kind: "updateNode",
              nodeId: node.id,
              propertyGroup: "typography",
              value: { color: token.color },
            },
            {
              intent: "brand",
              roleId: role.id,
              nodeId: node.id,
              summary: `Applied text-color token ${binding.tokenKey}.`,
            },
          );
      } else if (binding.property === "fill") {
        if (!fillNode(node))
          warn({
            code: "INCOMPATIBLE_NODE",
            severity: "warning",
            message: `Fill token ${binding.tokenKey} requires a fill-capable vector node.`,
            roleId: role.id,
            nodeIds: [node.id],
          });
        else {
          const fill = {
            type: "solid" as const,
            color: token.color,
            opacity: 1,
          };
          if (changed(node.fill, fill))
            push(
              {
                kind: "updateNode",
                nodeId: node.id,
                propertyGroup: "fill",
                value: { fill },
              },
              {
                intent: "brand",
                roleId: role.id,
                nodeId: node.id,
                summary: `Applied fill token ${binding.tokenKey}.`,
              },
            );
        }
      } else if (binding.property === "stroke") {
        if (!fillNode(node) || !node.stroke)
          warn({
            code: "INCOMPATIBLE_NODE",
            severity: "warning",
            message: `Stroke token ${binding.tokenKey} requires an existing stroke.`,
            roleId: role.id,
            nodeIds: [node.id],
          });
        else {
          const stroke = {
            ...node.stroke,
            paint: { type: "solid" as const, color: token.color, opacity: 1 },
          };
          if (changed(node.stroke, stroke))
            push(
              {
                kind: "updateNode",
                nodeId: node.id,
                propertyGroup: "stroke",
                value: { stroke },
              },
              {
                intent: "brand",
                roleId: role.id,
                nodeId: node.id,
                summary: `Applied stroke token ${binding.tokenKey}.`,
              },
            );
        }
      }
    }
  }

  return result();
};
