import { z } from "zod";
import type { BrandKitRecord } from "./brand.js";
import type {
  DesignBrief,
  DesignPlan,
  FrameDocument,
  SceneNode,
} from "./model.js";
import type { FrameOperation } from "./operations.js";
import { findNode, isLocked } from "./scene.js";

const uuid = z.string().uuid();

export const CompileDesignPlanOptionsSchema = z
  .object({
    roleIds: z
      .array(uuid)
      .min(1)
      .max(100)
      .refine((values) => new Set(values).size === values.length, {
        message: "Compiled role IDs must be unique.",
      })
      .optional(),
    variantRuleId: uuid.optional(),
  })
  .strict();

export type CompileDesignPlanOptions = z.infer<
  typeof CompileDesignPlanOptionsSchema
>;

export type DesignPlanCompilationWarning = {
  code:
    | "PLAN_NOT_APPROVED"
    | "TARGET_FRAME_REQUIRED"
    | "TARGET_FRAME_MISMATCH"
    | "ROLE_NOT_FOUND"
    | "ROLE_UNBOUND"
    | "ASSET_ASSIGNMENT_NOT_FOUND"
    | "NODE_NOT_FOUND"
    | "NODE_LOCKED"
    | "PROTECTED_DECISION"
    | "COPY_NOT_FOUND"
    | "INCOMPATIBLE_NODE"
    | "INVALID_LAYOUT"
    | "BRAND_BINDING_NOT_FOUND"
    | "BRAND_KIT_UNAVAILABLE"
    | "BRAND_TOKEN_UNAVAILABLE"
    | "UNSUPPORTED_INTENT"
    | "VARIANT_NOT_FOUND";
  severity: "info" | "warning";
  message: string;
  roleId?: string;
  nodeIds?: string[];
  protectedDecisionIds?: string[];
};

export type DesignPlanCompiledChange = {
  operationIndex: number;
  roleId?: string;
  nodeId?: string;
  intent:
    "copy" | "asset" | "crop" | "layout" | "brand" | "variant" | "safeArea";
  summary: string;
};

export type DesignPlanCompilation = {
  schemaVersion: 1;
  planId: string;
  frameId: string;
  baseRevision: number;
  selectedRoleIds: string[];
  operations: FrameOperation[];
  changes: DesignPlanCompiledChange[];
  warnings: DesignPlanCompilationWarning[];
  protectedDecisionIds: string[];
};

type CompileInput = CompileDesignPlanOptions & {
  plan: DesignPlan;
  frame: FrameDocument;
  brief?: DesignBrief;
  brandKit?: BrandKitRecord;
  brandResourceMap?: Record<string, string>;
};

const round = (value: number): number => Math.round(value * 1_000) / 1_000;
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

export const compileDesignPlan = (
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
      message: `Design plan is ${input.plan.approval.state}; compilation is preview-only and does not imply approval.`,
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
        "Design plan has no target frame and cannot compile artwork operations.",
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

  const variant = input.variantRuleId
    ? input.plan.variantRules.find((rule) => rule.id === input.variantRuleId)
    : undefined;
  if (input.variantRuleId && !variant)
    warn({
      code: "VARIANT_NOT_FOUND",
      severity: "warning",
      message: `Variant rule ${input.variantRuleId} is not present in the plan.`,
    });
  if (
    variant?.format &&
    (variant.format.width !== input.frame.canvas.width ||
      variant.format.height !== input.frame.canvas.height)
  )
    warn({
      code: "UNSUPPORTED_INTENT",
      severity: "warning",
      message:
        "Variant format changes require the explicit frame-resize workflow; the compiler will not resize the canvas implicitly.",
    });

  const copyItems = new Map(
    input.brief
      ? [...input.brief.requiredCopy, ...input.brief.optionalCopy].map(
          (item) => [item.id, item],
        )
      : [],
  );
  const decisionsFor = (
    role: DesignPlan["semanticRoles"][number],
    node: SceneNode,
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
  const protectedAction = (
    role: DesignPlan["semanticRoles"][number],
    node: SceneNode,
    kind: DesignPlan["protectedDecisions"][number]["kind"],
    summary: string,
  ): boolean => {
    const decisions = decisionsFor(role, node, kind);
    if (decisions.length === 0) return false;
    decisions.forEach((decision) => protectedDecisionIds.add(decision.id));
    warn({
      code: "PROTECTED_DECISION",
      severity: "info",
      message: `${summary} was preserved by protected human decision.`,
      roleId: role.id,
      nodeIds: [node.id],
      protectedDecisionIds: decisions.map((decision) => decision.id),
    });
    return true;
  };

  if (!input.roleIds) {
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
        message: `Role “${role.name}” is bound to a locked node; no operations were emitted for it.`,
        roleId: role.id,
        nodeIds: [node.id],
      });
      continue;
    }

    if (role.copyItemId) {
      const copy = copyItems.get(role.copyItemId);
      if (!copy)
        warn({
          code: "COPY_NOT_FOUND",
          severity: "warning",
          message: `Role “${role.name}” references unavailable brief copy ${role.copyItemId}.`,
          roleId: role.id,
          nodeIds: [node.id],
        });
      else if (node.type !== "text")
        warn({
          code: "INCOMPATIBLE_NODE",
          severity: "warning",
          message: `Brief copy for role “${role.name}” requires a text node.`,
          roleId: role.id,
          nodeIds: [node.id],
        });
      else if (
        node.text !== copy.text &&
        !protectedAction(role, node, "copy", `Copy for role “${role.name}”`)
      )
        push(
          {
            kind: "updateNode",
            nodeId: node.id,
            propertyGroup: "textContent",
            value: { text: copy.text },
          },
          {
            intent: "copy",
            roleId: role.id,
            nodeId: node.id,
            summary: `Applied brief copy to “${role.name}”.`,
          },
        );
    }

    const assignment = input.plan.assetAssignments.find(
      (candidate) => candidate.roleId === role.id,
    );
    if (assignment) {
      if (node.type !== "rasterImage" && node.type !== "svg")
        warn({
          code: "INCOMPATIBLE_NODE",
          severity: "warning",
          message: `Asset assignment for role “${role.name}” requires a raster or SVG node.`,
          roleId: role.id,
          nodeIds: [node.id],
        });
      else if (
        !protectedAction(role, node, "node", `Asset for role “${role.name}”`)
      ) {
        const fit =
          node.type === "rasterImage"
            ? assignment.fit === "stretch"
              ? "fill"
              : assignment.fit
            : undefined;
        if (
          node.assetId !== assignment.assetId ||
          (node.type === "rasterImage" && fit !== node.fit)
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
              summary: `Applied asset assignment to “${role.name}”.`,
            },
          );
        if (
          node.type === "rasterImage" &&
          !assignment.preserveCrop &&
          node.crop &&
          !protectedAction(role, node, "crop", `Crop for role “${role.name}”`)
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
              summary: `Reset crop for “${role.name}”.`,
            },
          );
      }
    }

    const anchor = input.plan.anchors.find(
      (candidate) => candidate.roleId === role.id,
    );
    if (
      anchor &&
      !protectedAction(
        role,
        node,
        "position",
        `Position for role “${role.name}”`,
      )
    ) {
      const region = anchor.regionId
        ? input.plan.layoutRegions.find(
            (candidate) => candidate.id === anchor.regionId,
          )
        : { x: 0, y: 0, width: 1, height: 1 };
      if (!region)
        warn({
          code: "INVALID_LAYOUT",
          severity: "warning",
          message: `Anchor for role “${role.name}” references an unavailable layout region.`,
          roleId: role.id,
          nodeIds: [node.id],
        });
      else {
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
    }

    for (const binding of input.plan.brandBindings.filter(
      (candidate) => candidate.roleId === role.id,
    )) {
      if (
        protectedAction(
          role,
          node,
          "brandBinding",
          `Brand binding for role “${role.name}”`,
        )
      )
        continue;
      if (!input.brandKit) {
        warn({
          code: "BRAND_KIT_UNAVAILABLE",
          severity: "warning",
          message: `Brand binding ${binding.tokenKey} cannot resolve without the exact pinned Brand Kit.`,
          roleId: role.id,
          nodeIds: [node.id],
        });
        continue;
      }
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

    const behavior = variant?.roleBehaviors.find(
      (candidate) => candidate.roleId === role.id,
    );
    if (behavior?.behavior === "hide") {
      if (
        node.visible &&
        !protectedAction(
          role,
          node,
          "node",
          `Visibility for role “${role.name}”`,
        )
      )
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
            summary: `Hid “${role.name}” for variant “${variant?.name}”.`,
          },
        );
    } else if (
      behavior &&
      (behavior.behavior === "reflow" || behavior.behavior === "resize") &&
      !anchor
    )
      warn({
        code: "UNSUPPORTED_INTENT",
        severity: "warning",
        message: `Variant behavior ${behavior.behavior} for role “${role.name}” needs an explicit anchor or resize workflow.`,
        roleId: role.id,
        nodeIds: [node.id],
      });
  }

  for (const intention of input.plan.effectIntentions.filter((item) =>
    roles.some((role) => role.id === item.roleId),
  ))
    warn({
      code: "UNSUPPORTED_INTENT",
      severity: "info",
      message: `Effect intention “${intention.description}” has no deterministic parameters and remains inspectable intent.`,
      roleId: intention.roleId,
    });

  return result();
};
