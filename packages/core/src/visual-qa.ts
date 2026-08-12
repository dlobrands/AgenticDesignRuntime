import type { BrandKitRecord } from "./brand.js";
import { z } from "zod";
import type {
  DesignBrief,
  DesignPlan,
  FrameDocument,
  SceneNode,
  TextNode,
} from "./model.js";
import { findNode, getNodeWorldMatrix, listNodes, walkScene } from "./scene.js";
import { matrixBounds } from "./transform.js";
import type { FrameValidationReport } from "./validation.js";

export const VISUAL_QA_CODES = [
  "TEXT_OVERFLOW",
  "LOW_RESOLUTION_RASTER_USE",
  "OFF_CANVAS_CONTENT",
  "EXCESSIVE_COMPLEXITY",
  "LOW_CONTRAST",
  "UNSAFE_EDGE_PROXIMITY",
  "DUPLICATE_TEXT",
  "OVERLAPPING_TEXT",
  "HIDDEN_IMPORTANT_CONTENT",
  "CLIPPED_IMPORTANT_CONTENT",
  "BRAND_TOKEN_DIVERGENCE",
  "MISSING_SEMANTIC_ROLE",
  "MISSING_REQUIRED_COPY",
] as const;

export type VisualQaCode = (typeof VISUAL_QA_CODES)[number];
export type VisualQaFinding = {
  id: string;
  classification: "deterministic";
  code: VisualQaCode;
  severity: "error" | "warning" | "info";
  message: string;
  nodeIds: string[];
  roleIds: string[];
  details?: Record<string, unknown>;
};

export type VisualQaReport = {
  schemaVersion: 1;
  projectId: string;
  frameId: string;
  frameRevision: number;
  planId?: string;
  briefId?: string;
  classification: "deterministic";
  summary: { errors: number; warnings: number; info: number };
  findings: VisualQaFinding[];
  unevaluated: Array<{
    category: "heuristic" | "modelJudged";
    checks: string[];
    reason: string;
  }>;
};

export type VisualQaInput = {
  projectId: string;
  frame: FrameDocument;
  validation: FrameValidationReport;
  plan?: DesignPlan;
  brief?: DesignBrief;
  brandKit?: BrandKitRecord;
};

export const VisualQaOptionsSchema = z
  .object({ planId: z.string().uuid().optional() })
  .strict();
export type VisualQaOptions = z.infer<typeof VisualQaOptionsSchema>;

type Bounds = { x: number; y: number; width: number; height: number };

const nodeBounds = (frame: FrameDocument, node: SceneNode): Bounds =>
  matrixBounds(
    getNodeWorldMatrix(frame, node.id),
    node.transform.width,
    node.transform.height,
  );

const overlaps = (left: Bounds, right: Bounds): boolean =>
  Math.min(left.x + left.width, right.x + right.width) -
    Math.max(left.x, right.x) >
    0.5 &&
  Math.min(left.y + left.height, right.y + right.height) -
    Math.max(left.y, right.y) >
    0.5;

const within = (inner: Bounds, outer: Bounds): boolean =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

const normalizeText = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

const effectiveVisible = (frame: FrameDocument, nodeId: string): boolean => {
  const visit = [...walkScene(frame)].find(
    (candidate) => candidate.node.id === nodeId,
  );
  if (!visit) return false;
  for (const id of visit.path) {
    if (id === "root") continue;
    const node = findNode(frame, id);
    if (!node?.visible) return false;
    if ("opacity" in node && node.opacity <= 0) return false;
  }
  return true;
};

const hexRgb = (value: string): [number, number, number] => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
];

const composite = (
  foreground: [number, number, number],
  background: [number, number, number],
  alpha: number,
): [number, number, number] =>
  foreground.map((channel, index) =>
    Math.round(channel * alpha + background[index]! * (1 - alpha)),
  ) as [number, number, number];

const luminance = (rgb: [number, number, number]): number => {
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
};

const contrastRatio = (
  foreground: string,
  background: string,
  alpha: number,
): number => {
  const backgroundRgb = hexRgb(background);
  const foregroundRgb = composite(hexRgb(foreground), backgroundRgb, alpha);
  const left = luminance(foregroundRgb);
  const right = luminance(backgroundRgb);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
};

const stableFindingId = (
  code: VisualQaCode,
  nodeIds: readonly string[],
  roleIds: readonly string[],
  suffix = "",
): string =>
  [code, ...[...nodeIds].sort(), ...[...roleIds].sort(), suffix].join(":");

export const auditVisualQuality = (input: VisualQaInput): VisualQaReport => {
  const { frame, validation, plan, brief, brandKit } = input;
  const findings: VisualQaFinding[] = [];
  const add = (
    finding: Omit<VisualQaFinding, "id" | "classification"> & {
      suffix?: string;
    },
  ) => {
    const { suffix, ...value } = finding;
    findings.push({
      ...value,
      id: stableFindingId(value.code, value.nodeIds, value.roleIds, suffix),
      classification: "deterministic",
    });
  };

  for (const warning of validation.warnings) {
    const mapping =
      warning.code === "TEXT_OVERFLOW"
        ? ({ code: "TEXT_OVERFLOW", severity: "error" } as const)
        : warning.code === "LOW_RESOLUTION_ASSET"
          ? ({
              code: "LOW_RESOLUTION_RASTER_USE",
              severity: "warning",
            } as const)
          : warning.code === "CONTENT_OUTSIDE_ARTBOARD"
            ? ({ code: "OFF_CANVAS_CONTENT", severity: "warning" } as const)
            : warning.code === "FRAME_COMPLEXITY_WARNING" ||
                warning.code === "HIGH_COMPLEXITY_SCORE"
              ? ({ code: "EXCESSIVE_COMPLEXITY", severity: "warning" } as const)
              : undefined;
    if (mapping)
      add({
        ...mapping,
        message: warning.message,
        nodeIds: warning.nodeIds ?? [],
        roleIds: [],
        details: warning.details,
        suffix: warning.code,
      });
  }

  const visibleText = listNodes(frame).filter(
    (node): node is TextNode =>
      node.type === "text" && effectiveVisible(frame, node.id),
  );
  const texts = new Map<string, TextNode[]>();
  for (const node of visibleText) {
    const normalized = normalizeText(node.text);
    if (!normalized) continue;
    const matches = texts.get(normalized) ?? [];
    matches.push(node);
    texts.set(normalized, matches);
  }
  for (const [text, nodes] of texts)
    if (nodes.length > 1)
      add({
        code: "DUPLICATE_TEXT",
        severity: "warning",
        message: `The same visible text appears in ${nodes.length} nodes.`,
        nodeIds: nodes.map((node) => node.id),
        roleIds: [],
        details: { normalizedText: text, occurrences: nodes.length },
      });

  for (let leftIndex = 0; leftIndex < visibleText.length; leftIndex += 1)
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < visibleText.length;
      rightIndex += 1
    ) {
      const left = visibleText[leftIndex]!;
      const right = visibleText[rightIndex]!;
      if (!overlaps(nodeBounds(frame, left), nodeBounds(frame, right)))
        continue;
      add({
        code: "OVERLAPPING_TEXT",
        severity: "warning",
        message: `Text bounds for “${left.name}” and “${right.name}” overlap.`,
        nodeIds: [left.id, right.id],
        roleIds: [],
      });
    }

  if (
    frame.canvas.background.type === "solid" &&
    frame.canvas.background.opacity === 1
  ) {
    const backgroundColor = frame.canvas.background.color;
    const rootIndex = new Map(
      frame.root.children.map((node, index) => [node.id, index]),
    );
    for (const node of visibleText) {
      const index = rootIndex.get(node.id);
      if (index === undefined) continue;
      const bounds = nodeBounds(frame, node);
      const obscuredBackground = frame.root.children
        .slice(0, index)
        .some(
          (candidate) =>
            effectiveVisible(frame, candidate.id) &&
            overlaps(bounds, nodeBounds(frame, candidate)),
        );
      if (obscuredBackground) continue;
      const colors = [
        {
          color: node.typography.color,
          opacity: node.typography.opacity * node.opacity,
        },
        ...(node.spans ?? []).map((span) => ({
          color: span.style.color ?? node.typography.color,
          opacity:
            (span.style.opacity ?? node.typography.opacity) * node.opacity,
        })),
      ];
      const ratio = Math.min(
        ...colors.map((color) =>
          contrastRatio(color.color, backgroundColor, color.opacity),
        ),
      );
      const requiredRatio =
        brief?.accessibilityRequirements.minimumContrastRatio ?? 4.5;
      if (ratio + 0.001 < requiredRatio)
        add({
          code: "LOW_CONTRAST",
          severity: "warning",
          message: `“${node.name}” has ${ratio.toFixed(2)}:1 contrast against the provable solid canvas background; ${requiredRatio}:1 is required.`,
          nodeIds: [node.id],
          roleIds: [],
          details: {
            ratio,
            requiredRatio,
            background: backgroundColor,
          },
        });
    }
  }

  if (plan) {
    const briefCopy = new Map(
      [...(brief?.requiredCopy ?? []), ...(brief?.optionalCopy ?? [])].map(
        (item) => [item.id, item],
      ),
    );
    const planSafeArea = plan.safeAreas.find((area) => !area.regionId);
    const safeArea = planSafeArea
      ? {
          ...planSafeArea,
          top: planSafeArea.top * frame.canvas.height,
          right: planSafeArea.right * frame.canvas.width,
          bottom: planSafeArea.bottom * frame.canvas.height,
          left: planSafeArea.left * frame.canvas.width,
        }
      : frame.canvas.safeArea
        ? {
            id: "canvas-safe-area",
            name: "Canvas safe area",
            ...frame.canvas.safeArea,
          }
        : undefined;
    const safeBounds = safeArea
      ? {
          x: safeArea.left,
          y: safeArea.top,
          width: frame.canvas.width - safeArea.left - safeArea.right,
          height: frame.canvas.height - safeArea.top - safeArea.bottom,
        }
      : undefined;
    for (const role of plan.semanticRoles) {
      const node = role.nodeId ? findNode(frame, role.nodeId) : undefined;
      if (role.required && !node)
        add({
          code: "MISSING_SEMANTIC_ROLE",
          severity: "error",
          message: `Required ${role.role} role “${role.name}” is not bound to an existing node.`,
          nodeIds: role.nodeId ? [role.nodeId] : [],
          roleIds: [role.id],
        });
      if (!node) continue;
      if (role.required && !effectiveVisible(frame, node.id))
        add({
          code: "HIDDEN_IMPORTANT_CONTENT",
          severity: "error",
          message: `Required ${role.role} role “${role.name}” is hidden by its own or an ancestor visibility/opacity state.`,
          nodeIds: [node.id],
          roleIds: [role.id],
        });
      const bounds = nodeBounds(frame, node);
      const canvasBounds = {
        x: 0,
        y: 0,
        width: frame.canvas.width,
        height: frame.canvas.height,
      };
      if (role.required && !within(bounds, canvasBounds))
        add({
          code: "CLIPPED_IMPORTANT_CONTENT",
          severity: "error",
          message: `Required ${role.role} role “${role.name}” extends outside the exact export canvas.`,
          nodeIds: [node.id],
          roleIds: [role.id],
          details: { bounds, canvasBounds },
        });
      if (role.required && safeBounds && !within(bounds, safeBounds))
        add({
          code: "UNSAFE_EDGE_PROXIMITY",
          severity: "warning",
          message: `Required ${role.role} role “${role.name}” extends beyond “${safeArea!.name}”.`,
          nodeIds: [node.id],
          roleIds: [role.id],
          details: { bounds, safeBounds, safeAreaId: safeArea!.id },
        });
      if (role.copyItemId) {
        const copy = briefCopy.get(role.copyItemId);
        if (copy && (node.type !== "text" || node.text !== copy.text))
          add({
            code: "MISSING_REQUIRED_COPY",
            severity: "error",
            message: `Role “${role.name}” does not contain its exact required copy.`,
            nodeIds: [node.id],
            roleIds: [role.id],
            details: {
              copyItemId: copy.id,
              expected: copy.text,
              actual: node.type === "text" ? node.text : null,
            },
          });
      }
    }

    if (brief)
      for (const copy of brief.requiredCopy) {
        const assigned = plan.semanticRoles.some(
          (role) => role.copyItemId === copy.id && role.nodeId,
        );
        if (!assigned && !visibleText.some((node) => node.text === copy.text))
          add({
            code: "MISSING_REQUIRED_COPY",
            severity: "error",
            message: `Required copy “${copy.role}” is absent from visible text nodes.`,
            nodeIds: [],
            roleIds: [],
            details: { copyItemId: copy.id, expected: copy.text },
            suffix: copy.id,
          });
      }

    if (brandKit)
      for (const binding of plan.brandBindings) {
        const role = plan.semanticRoles.find(
          (candidate) => candidate.id === binding.roleId,
        );
        const node = role?.nodeId ? findNode(frame, role.nodeId) : undefined;
        if (!role || !node) continue;
        let matches: boolean | undefined;
        let expected: unknown;
        let actual: unknown;
        if (binding.property === "textColor" && node.type === "text") {
          expected = brandKit.palette.find(
            (token) => token.key === binding.tokenKey,
          )?.color;
          actual = node.typography.color;
          matches = expected === undefined ? undefined : actual === expected;
        } else if (binding.property === "fill" && "fill" in node) {
          expected = brandKit.palette.find(
            (token) => token.key === binding.tokenKey,
          )?.color;
          actual = node.fill
            ? node.fill.type === "solid"
              ? node.fill.color
              : node.fill.type
            : undefined;
          matches =
            expected === undefined || actual === undefined
              ? undefined
              : actual === expected;
        } else if (binding.property === "stroke" && "stroke" in node) {
          expected = brandKit.palette.find(
            (token) => token.key === binding.tokenKey,
          )?.color;
          actual =
            node.stroke?.paint.type === "solid"
              ? node.stroke.paint.color
              : node.stroke?.paint.type;
          matches = expected === undefined ? undefined : actual === expected;
        } else if (binding.property === "typography" && node.type === "text") {
          const token = brandKit.typeRoles.find(
            (item) => item.key === binding.tokenKey,
          );
          expected = token
            ? {
                fontId: token.font.id,
                fontSize: token.fontSize,
                lineHeight: token.lineHeight,
                letterSpacing: token.letterSpacing,
              }
            : undefined;
          actual = {
            fontId: node.typography.fontId,
            fontSize: node.typography.fontSize,
            lineHeight: node.typography.lineHeight,
            letterSpacing: node.typography.letterSpacing,
          };
          matches =
            expected === undefined || !token
              ? undefined
              : node.typography.fontId === token.font.id &&
                node.typography.fontSize === token.fontSize &&
                node.typography.lineHeight === token.lineHeight &&
                node.typography.letterSpacing === token.letterSpacing;
        }
        if (matches === false)
          add({
            code: "BRAND_TOKEN_DIVERGENCE",
            severity: "warning",
            message: `Role “${role.name}” diverges from ${binding.property} token “${binding.tokenKey}”.`,
            nodeIds: [node.id],
            roleIds: [role.id],
            details: {
              bindingId: binding.id,
              property: binding.property,
              tokenKey: binding.tokenKey,
              expected,
              actual,
            },
          });
      }
  }

  findings.sort(
    (left, right) =>
      left.code.localeCompare(right.code) || left.id.localeCompare(right.id),
  );
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    frameId: frame.id,
    frameRevision: frame.revision,
    ...(plan ? { planId: plan.id } : {}),
    ...(brief ? { briefId: brief.id } : {}),
    classification: "deterministic",
    summary: {
      errors: findings.filter((finding) => finding.severity === "error").length,
      warnings: findings.filter((finding) => finding.severity === "warning")
        .length,
      info: findings.filter((finding) => finding.severity === "info").length,
    },
    findings,
    unevaluated: [
      {
        category: "heuristic",
        checks: [
          "inconsistent margins",
          "misaligned clusters",
          "irregular spacing",
          "hierarchy quality",
          "logo misuse without machine-readable rules",
        ],
        reason:
          "These checks require an explicit heuristic contract and must not be presented as objective facts.",
      },
      {
        category: "modelJudged",
        checks: ["mood fit", "composition quality", "creative effectiveness"],
        reason:
          "No model judgment was requested or executed by this deterministic audit.",
      },
    ],
  };
};
