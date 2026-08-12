import type { ZodError } from "zod";
import type {
  Asset,
  FontRecord,
  FrameDocument,
  RuntimeCapabilities,
  SceneNode,
} from "./model.js";
import { RuntimeError, type RuntimeErrorCode } from "./errors.js";
import { effectItems } from "./effects.js";
import { FrameDocumentSchema } from "./schema.js";
import { getNodeWorldMatrix, listNodes, walkScene } from "./scene.js";
import { matrixBounds } from "./transform.js";
import type { FrameWarning } from "./warnings.js";

export type ValidationContext = {
  assets?: readonly Asset[];
  fonts?: readonly FontRecord[];
  capabilities?: RuntimeCapabilities;
};

export type ValidationIssue = {
  code: RuntimeErrorCode;
  message: string;
  nodeId?: string;
  path?: string;
};

export type FrameValidationReport = {
  valid: boolean;
  nodeCount: number;
  maximumDepth: number;
  complexityScore: number;
  errors: ValidationIssue[];
  warnings: FrameWarning[];
};

const complexityWeight = (node: SceneNode): number => {
  let score = 1;
  if (node.type === "mask") score += node.mode === "luminance" ? 8 : 5;
  if (node.type === "adjustment") score += 4 + (node.values.blur > 0 ? 5 : 0);
  if ("effects" in node)
    for (const effect of effectItems(node.effects)) {
      if (!effect.enabled) continue;
      score +=
        effect.type === "blur"
          ? 5
          : effect.type === "innerShadow" || effect.type.endsWith("Glow")
            ? 8
            : 6;
    }
  if (
    "blendMode" in node &&
    node.blendMode !== "normal" &&
    node.blendMode !== "pass-through"
  )
    score += 3;
  if (
    (node.type === "rectangle" ||
      node.type === "ellipse" ||
      node.type === "vectorPath") &&
    node.fill?.type !== "solid"
  )
    score += 2;
  if (
    (node.type === "rectangle" ||
      node.type === "ellipse" ||
      node.type === "vectorPath") &&
    node.stroke?.dash
  )
    score += 2;
  return score;
};

const schemaIssues = (error: ZodError): ValidationIssue[] =>
  error.issues.map((issue) => ({
    code:
      issue.path[0] === "schemaVersion"
        ? "SCHEMA_VERSION_UNSUPPORTED"
        : "FRAME_FILE_INVALID",
    message: issue.message,
    path: issue.path.join("."),
  }));

export const validateFrame = (
  frameInput: unknown,
  context: ValidationContext = {},
): FrameValidationReport => {
  const parsed = FrameDocumentSchema.safeParse(frameInput);
  if (!parsed.success) {
    return {
      valid: false,
      nodeCount: 0,
      maximumDepth: 0,
      complexityScore: 0,
      errors: schemaIssues(parsed.error),
      warnings: [],
    };
  }
  const frame = parsed.data;
  const visits = [...walkScene(frame)];
  const nodes = visits.map((visit) => visit.node);
  const errors: ValidationIssue[] = [];
  const warnings: FrameWarning[] = [];
  const ids = new Set<string>();
  let maximumDepth = 0;
  let complexityScore = 0;

  for (const visit of visits) {
    maximumDepth = Math.max(maximumDepth, visit.depth);
    complexityScore += complexityWeight(visit.node);
    if (ids.has(visit.node.id)) {
      errors.push({
        code: "DUPLICATE_NODE_ID",
        message: `Duplicate node ID ${visit.node.id}.`,
        nodeId: visit.node.id,
      });
    }
    ids.add(visit.node.id);
    if (visit.node.type === "adjustment" && visit.parentId !== "root") {
      errors.push({
        code: "INVALID_PARENT",
        message: "Adjustment nodes must be direct root children.",
        nodeId: visit.node.id,
      });
    }
  }

  if (nodes.length > 500) {
    errors.push({
      code: "FRAME_LIMIT_EXCEEDED",
      message: `Frame contains ${nodes.length} nodes; the hard limit is 500.`,
    });
  } else if (nodes.length > 300) {
    warnings.push({
      code: "FRAME_COMPLEXITY_WARNING",
      message: `Frame contains ${nodes.length} nodes; interactive performance may decline.`,
    });
  }
  if (maximumDepth > 32) {
    errors.push({
      code: "FRAME_LIMIT_EXCEEDED",
      message: `Frame nesting depth ${maximumDepth} exceeds the limit of 32.`,
    });
  }
  if (complexityScore > 1_000) {
    warnings.push({
      code: "HIGH_COMPLEXITY_SCORE",
      message: `Frame complexity score is ${complexityScore}.`,
    });
  }

  if (!frame.canvas.clipContent) {
    warnings.push({
      code: "CLIP_CONTENT_DEPRECATED",
      message:
        "clipContent: false is a deprecated V1 compatibility value. Studio preview and export still clip to the exact canvas; set true to normalize the frame.",
    });
  }

  const targets = new Map<string, string>();
  for (const adjustment of nodes.filter((node) => node.type === "adjustment")) {
    const target =
      adjustment.targetId === "root"
        ? frame.root
        : nodes.find((node) => node.id === adjustment.targetId);
    if (
      !target ||
      ("type" in target &&
        !["rasterImage", "svg", "group", "mask"].includes(target.type))
    ) {
      errors.push({
        code: "ADJUSTMENT_CYCLE",
        message: `Adjustment target ${adjustment.targetId} is invalid.`,
        nodeId: adjustment.id,
      });
    }
    const existing = targets.get(adjustment.targetId);
    if (existing) {
      errors.push({
        code: "ADJUSTMENT_CYCLE",
        message: `Target ${adjustment.targetId} already has adjustment ${existing}.`,
        nodeId: adjustment.id,
      });
    }
    targets.set(adjustment.targetId, adjustment.id);
  }

  const assets = new Set(context.assets?.map((asset) => asset.id) ?? []);
  const assetsById = new Map(
    context.assets?.map((asset) => [asset.id, asset]) ?? [],
  );
  const fonts = new Set(context.fonts?.map((font) => font.id) ?? []);
  if (context.assets) {
    for (const node of nodes) {
      if (node.type !== "rasterImage" && node.type !== "svg") continue;
      if (!assets.has(node.assetId)) {
        errors.push({
          code: "ASSET_NOT_FOUND",
          message: `Asset ${node.assetId} is missing.`,
          nodeId: node.id,
        });
        continue;
      }
      const asset = assetsById.get(node.assetId)!;
      const expectedType = node.type === "rasterImage" ? "raster" : "svg";
      if (asset.type !== expectedType) {
        errors.push({
          code: "ASSET_TYPE_MISMATCH",
          message: `${node.name} requires a ${expectedType} asset, but ${node.assetId} is ${asset.type}.`,
          nodeId: node.id,
        });
      }
    }
  }
  if (context.fonts) {
    for (const node of nodes) {
      if (node.type === "text" && !fonts.has(node.typography.fontId)) {
        errors.push({
          code: "FONT_MISSING",
          message: `Font ${node.typography.fontId} is missing.`,
          nodeId: node.id,
        });
      }
      if (node.type === "text")
        for (const span of node.spans ?? [])
          if (span.style.fontId && !fonts.has(span.style.fontId))
            errors.push({
              code: "FONT_MISSING",
              message: `Font ${span.style.fontId} is missing from rich-text span ${span.id}.`,
              nodeId: node.id,
            });
    }
  }

  if (context.capabilities) {
    const max = context.capabilities.maxCanvasDimension;
    if (frame.canvas.width > max || frame.canvas.height > max) {
      errors.push({
        code: "RENDER_CAPABILITY_EXCEEDED",
        message: `Canvas exceeds the detected ${max}px render limit.`,
      });
    }
  }

  for (const node of nodes) {
    if (node.type === "adjustment") continue;
    const matrix = getNodeWorldMatrix(frame, node.id);
    const bounds = matrixBounds(
      matrix,
      node.transform.width,
      node.transform.height,
    );
    if (
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.x + bounds.width > frame.canvas.width ||
      bounds.y + bounds.height > frame.canvas.height
    ) {
      warnings.push({
        code: "CONTENT_OUTSIDE_ARTBOARD",
        message: frame.canvas.clipContent
          ? `${node.name} extends outside the artboard and is clipped in Studio preview and export.`
          : `${node.name} extends outside the artboard. The deprecated clipContent: false value does not preserve it; Studio preview and export still clip to the exact canvas.`,
        nodeIds: [node.id],
      });
    }
    if (node.type === "rasterImage") {
      const asset = assetsById.get(node.assetId);
      if (asset?.type === "raster") {
        const sourceWidth = asset.width * (node.crop?.width ?? 1);
        const sourceHeight = asset.height * (node.crop?.height ?? 1);
        if (
          sourceWidth < bounds.width * 0.75 ||
          sourceHeight < bounds.height * 0.75
        ) {
          warnings.push({
            code: "LOW_RESOLUTION_ASSET",
            message: `${node.name} is displayed substantially above its effective source resolution.`,
            nodeIds: [node.id],
            details: {
              sourceWidth,
              sourceHeight,
              displayWidth: bounds.width,
              displayHeight: bounds.height,
            },
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    nodeCount: nodes.length,
    maximumDepth,
    complexityScore,
    errors,
    warnings,
  };
};

export const assertValidFrame = (
  frame: unknown,
  context: ValidationContext = {},
): FrameDocument => {
  const report = validateFrame(frame, context);
  const error = report.errors[0];
  if (error)
    throw new RuntimeError(error.code, error.message, {
      nodeId: error.nodeId,
      path: error.path,
    });
  return FrameDocumentSchema.parse(frame);
};

export const estimateTextureMemory = (
  frame: FrameDocument,
  assets: readonly Asset[],
): number => {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  let bytes = frame.canvas.width * frame.canvas.height * 4;
  for (const node of listNodes(frame)) {
    if (node.type !== "rasterImage" && node.type !== "svg") continue;
    const asset = byId.get(node.assetId);
    if (asset) bytes += asset.width * asset.height * 4;
  }
  return bytes;
};
