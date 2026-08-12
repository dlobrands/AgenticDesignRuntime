import { z } from "zod";
import {
  GROUP_BLEND_MODES,
  SUPPORTED_BLEND_MODES,
  DESIGN_SEMANTIC_ROLES,
  TEMPLATE_SLOT_ROLES,
  type AdjustmentNode,
  type AssetManifest,
  type DesignConfig,
  type DesignBrief,
  type DesignPlan,
  type Effect,
  type Effects,
  type FontManifest,
  type FrameDocument,
  type MaskSourceNode,
  type ProjectDocument,
  type SceneNode,
  type ShapeFill,
  type Stroke,
} from "./model.js";
import { EXPORT_FORMATS } from "./model.js";

const finite = z.number().finite();
const nonNegative = finite.min(0);
const positive = finite.gt(0);
const opacity = finite.min(0).max(1);
const normalized = finite.min(0).max(1);
const uuid = z.string().uuid();
const slug = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase kebab-case slug.");
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Expected an sRGB #RRGGBB color.");
const relativePath = z
  .string()
  .min(1)
  .refine(
    (value) => !value.startsWith("/") && !value.startsWith("\\"),
    "Absolute paths are prohibited.",
  )
  .refine(
    (value) => !value.split(/[\\/]/).includes(".."),
    "Parent traversal is prohibited.",
  )
  .refine(
    (value) => !value.includes("\\"),
    "Persisted paths must use / separators.",
  );

export const TransformSchema = z
  .object({
    x: finite,
    y: finite,
    width: positive,
    height: positive,
    rotation: finite,
    scaleX: finite,
    scaleY: finite,
    skewX: finite,
    skewY: finite,
    anchorX: normalized,
    anchorY: normalized,
  })
  .strict();

export const GradientStopSchema = z
  .object({ id: uuid, offset: normalized, color, opacity })
  .strict();

const gradientBase = {
  stops: z.array(GradientStopSchema).min(2).max(16),
  interpolation: z.literal("linear-srgb"),
  spread: z.literal("pad"),
  dither: z.literal(true),
};

export const SolidFillSchema = z
  .object({ type: z.literal("solid"), color, opacity })
  .strict();

export const LinearGradientFillSchema = z
  .object({
    type: z.literal("linearGradient"),
    start: z.object({ x: finite, y: finite }).strict(),
    end: z.object({ x: finite, y: finite }).strict(),
    ...gradientBase,
  })
  .strict();

export const RadialGradientFillSchema = z
  .object({
    type: z.literal("radialGradient"),
    center: z.object({ x: finite, y: finite }).strict(),
    radius: z.object({ x: positive, y: positive }).strict(),
    focalPoint: z.object({ x: finite, y: finite }).strict().optional(),
    ...gradientBase,
  })
  .strict();

export const ShapeFillSchema: z.ZodType<ShapeFill> = z.discriminatedUnion(
  "type",
  [SolidFillSchema, LinearGradientFillSchema, RadialGradientFillSchema],
);

export const StrokeSchema: z.ZodType<Stroke> = z
  .object({
    enabled: z.boolean(),
    width: nonNegative,
    alignment: z.enum(["inside", "center", "outside"]),
    opacity,
    paint: ShapeFillSchema,
    dash: z
      .object({
        values: z.array(positive).min(2).max(16),
        offset: finite,
        cap: z.enum(["butt", "round", "square"]),
      })
      .strict()
      .refine(
        (dash) => dash.values.length % 2 === 0,
        "Dash arrays must contain an even number of values.",
      )
      .optional(),
  })
  .strict();

export const OuterShadowSchema = z
  .object({
    enabled: z.boolean(),
    offsetX: finite.min(-500).max(500),
    offsetY: finite.min(-500).max(500),
    blur: finite.min(0).max(128),
    spread: finite.min(-64).max(128),
    color,
    opacity,
  })
  .strict();

const effectId = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9:_.@-]+$/, "Use a stable portable effect ID.");
const effectBase = { id: effectId, enabled: z.boolean() };
const shadowEffectShape = {
  ...effectBase,
  offsetX: finite.min(-500).max(500),
  offsetY: finite.min(-500).max(500),
  blur: finite.min(0).max(128),
  spread: finite.min(-64).max(128),
  color,
  opacity,
};

export const EffectSchema: z.ZodType<Effect> = z.discriminatedUnion("type", [
  z.object({ ...shadowEffectShape, type: z.literal("outerShadow") }).strict(),
  z.object({ ...shadowEffectShape, type: z.literal("innerShadow") }).strict(),
  z
    .object({
      ...effectBase,
      type: z.literal("blur"),
      radius: finite.min(0).max(128),
    })
    .strict(),
  z
    .object({
      ...effectBase,
      type: z.literal("innerGlow"),
      blur: finite.min(0).max(128),
      spread: finite.min(-64).max(128),
      color,
      opacity,
    })
    .strict(),
  z
    .object({
      ...effectBase,
      type: z.literal("outerGlow"),
      blur: finite.min(0).max(128),
      spread: finite.min(-64).max(128),
      color,
      opacity,
    })
    .strict(),
  z
    .object({
      ...effectBase,
      type: z.literal("colorOverlay"),
      paint: SolidFillSchema,
      opacity,
    })
    .strict(),
  z
    .object({
      ...effectBase,
      type: z.literal("gradientOverlay"),
      paint: z.union([LinearGradientFillSchema, RadialGradientFillSchema]),
      opacity,
    })
    .strict(),
]);

export const EffectStackSchema = z
  .object({ items: z.array(EffectSchema).min(1).max(16) })
  .strict()
  .superRefine((stack, context) => {
    const ids = new Set<string>();
    stack.items.forEach((effect, index) => {
      if (ids.has(effect.id))
        context.addIssue({
          code: "custom",
          message: `Effect ID ${effect.id} is duplicated.`,
          path: ["items", index, "id"],
        });
      ids.add(effect.id);
    });
  });

export const EffectsSchema: z.ZodType<Effects> = z.union([
  EffectStackSchema,
  z.object({ outerShadow: OuterShadowSchema }).strict(),
]);

export const ResizeConstraintsSchema = z
  .object({
    horizontal: z.enum(["left", "center", "right", "stretch", "scale"]),
    vertical: z.enum(["top", "middle", "bottom", "stretch", "scale"]),
  })
  .strict();

export const TemplateInstanceMetadataSchema = z
  .object({
    templateId: uuid,
    instanceId: uuid,
    sourceNodeId: uuid.optional(),
  })
  .strict();

export const TemplateSlotMetadataSchema = z
  .object({
    slotId: uuid,
    key: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    name: z.string().min(1).max(80),
    role: z.enum(TEMPLATE_SLOT_ROLES),
  })
  .strict();

export const ComponentOverridePropertySchema = z.enum([
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
]);

export const BrandComponentInstanceMetadataSchema = z
  .object({
    instanceId: uuid,
    kitId: uuid,
    kitRevision: z.number().int().positive(),
    kitContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    definitionKey: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    variantGroupKey: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,63}$/)
      .optional(),
    variantKey: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,63}$/)
      .optional(),
    sourceNodeId: uuid,
    allowedOverrides: z.array(ComponentOverridePropertySchema).max(13),
    overrides: z.array(ComponentOverridePropertySchema).max(13),
  })
  .strict()
  .superRefine((metadata, context) => {
    if (
      (metadata.variantGroupKey === undefined) !==
      (metadata.variantKey === undefined)
    )
      context.addIssue({
        code: "custom",
        message: "Component variant group and key must be present together.",
        path: ["variantKey"],
      });
    if (
      new Set(metadata.allowedOverrides).size !==
      metadata.allowedOverrides.length
    )
      context.addIssue({
        code: "custom",
        message: "Allowed component overrides must be unique.",
        path: ["allowedOverrides"],
      });
    if (new Set(metadata.overrides).size !== metadata.overrides.length)
      context.addIssue({
        code: "custom",
        message: "Component overrides must be unique.",
        path: ["overrides"],
      });
    for (const property of metadata.overrides)
      if (!metadata.allowedOverrides.includes(property))
        context.addIssue({
          code: "custom",
          message: "Component override is not allowed.",
          path: ["overrides"],
        });
  });

export const BrandStyleBindingSchema = z
  .object({
    id: uuid,
    property: z.enum([
      "fill",
      "stroke",
      "textColor",
      "typography",
      "effects",
      "radius",
    ]),
    kitId: uuid,
    kitRevision: z.number().int().positive(),
    kitContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    tokenKey: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9-]{0,63}$/),
  })
  .strict();

const baseNodeShape = {
  id: uuid,
  name: z.string().min(1).max(160),
  visible: z.boolean(),
  locked: z.boolean(),
  transform: TransformSchema,
  resizeConstraints: ResizeConstraintsSchema.optional(),
  templateInstance: TemplateInstanceMetadataSchema.optional(),
  templateSlot: TemplateSlotMetadataSchema.optional(),
  brandComponent: BrandComponentInstanceMetadataSchema.optional(),
  brandBindings: z
    .array(BrandStyleBindingSchema)
    .max(16)
    .refine(
      (bindings) =>
        new Set(bindings.map((binding) => binding.id)).size === bindings.length,
      { message: "Brand binding IDs must be unique." },
    )
    .refine(
      (bindings) =>
        new Set(bindings.map((binding) => binding.property)).size ===
        bindings.length,
      { message: "A node property may have only one Brand binding." },
    )
    .optional(),
};

const compositingShape = {
  opacity,
  blendMode: z.enum(SUPPORTED_BLEND_MODES),
  effects: EffectsSchema.optional(),
};

const groupCompositingShape = {
  opacity,
  blendMode: z.enum(GROUP_BLEND_MODES),
  effects: EffectsSchema.optional(),
};

export const RasterImageNodeSchema = z
  .object({
    ...baseNodeShape,
    ...compositingShape,
    type: z.literal("rasterImage"),
    assetId: uuid,
    fit: z.enum(["fill", "contain", "cover", "none"]),
    crop: z
      .object({
        x: normalized,
        y: normalized,
        width: positive.max(1),
        height: positive.max(1),
      })
      .strict()
      .refine(
        (crop) => crop.x + crop.width <= 1 && crop.y + crop.height <= 1,
        "Crop must remain inside the source.",
      )
      .optional(),
  })
  .strict();

export const TextSpanStyleSchema = z
  .object({
    fontId: uuid.optional(),
    fontSize: positive.optional(),
    fontWeight: z.number().int().min(1).max(1000).optional(),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    color: color.optional(),
    opacity: opacity.optional(),
    letterSpacing: finite.optional(),
    baselineShift: finite.optional(),
    decoration: z.enum(["none", "underline", "lineThrough"]).optional(),
  })
  .strict();

export const TextSpanSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9:_.@-]+$/, "Use a stable portable span ID."),
    start: z.number().int().min(0),
    end: z.number().int().positive(),
    style: TextSpanStyleSchema,
  })
  .strict();

export const TextNodeSchema = z
  .object({
    ...baseNodeShape,
    ...compositingShape,
    type: z.literal("text"),
    text: z.string(),
    typography: z
      .object({
        fontId: uuid,
        fontSize: positive,
        fontWeight: z.number().int().min(1).max(1000),
        fontStyle: z.enum(["normal", "italic"]),
        lineHeight: positive,
        letterSpacing: finite,
        alignment: z.enum(["left", "center", "right", "justify"]),
        verticalAlignment: z.enum(["top", "middle", "bottom"]),
        color,
        opacity,
      })
      .strict(),
    spans: z.array(TextSpanSchema).min(1).max(256).optional(),
    textBox: z
      .object({
        mode: z.enum(["autoWidth", "autoHeight", "fixed"]),
        width: positive,
        height: positive.optional(),
        wrapping: z.enum(["word", "character", "none"]),
        overflow: z.enum(["visible", "clip"]),
        overflowAccepted: z.boolean().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((node, context) => {
    if (node.spans) {
      const ids = new Set<string>();
      let expectedStart = 0;
      node.spans.forEach((span, index) => {
        if (ids.has(span.id))
          context.addIssue({
            code: "custom",
            message: "Text span IDs must be unique within a text node.",
            path: ["spans", index, "id"],
          });
        ids.add(span.id);
        if (span.start !== expectedStart)
          context.addIssue({
            code: "custom",
            message: "Text spans must be ordered, contiguous, and start at 0.",
            path: ["spans", index, "start"],
          });
        if (span.end <= span.start || span.end > node.text.length)
          context.addIssue({
            code: "custom",
            message: "Text span ranges must be non-empty and inside the text.",
            path: ["spans", index, "end"],
          });
        for (const [key, offset] of [
          ["start", span.start],
          ["end", span.end],
        ] as const)
          if (
            offset > 0 &&
            offset < node.text.length &&
            /[\uD800-\uDBFF]/.test(node.text[offset - 1]!) &&
            /[\uDC00-\uDFFF]/.test(node.text[offset]!)
          )
            context.addIssue({
              code: "custom",
              message: "Text span boundaries cannot split a surrogate pair.",
              path: ["spans", index, key],
            });
        expectedStart = span.end;
      });
      if (expectedStart !== node.text.length)
        context.addIssue({
          code: "custom",
          message: "Text spans must cover the complete text.",
          path: ["spans"],
        });
    }
    if (node.textBox.mode === "fixed" && node.textBox.height === undefined) {
      context.addIssue({
        code: "custom",
        message: "Fixed text boxes require a height.",
        path: ["textBox", "height"],
      });
    }
    if (Math.abs(node.transform.width - node.textBox.width) > 1e-6) {
      context.addIssue({
        code: "custom",
        message: "Text transform and text-box widths must match.",
        path: ["textBox", "width"],
      });
    }
    if (
      node.textBox.height !== undefined &&
      Math.abs(node.transform.height - node.textBox.height) > 1e-6
    ) {
      context.addIssue({
        code: "custom",
        message: "Text transform and text-box heights must match.",
        path: ["textBox", "height"],
      });
    }
  });

export const RectangleNodeSchema = z
  .object({
    ...baseNodeShape,
    ...compositingShape,
    type: z.literal("rectangle"),
    fill: ShapeFillSchema,
    stroke: StrokeSchema.optional(),
    cornerRadius: z
      .object({
        topLeft: nonNegative,
        topRight: nonNegative,
        bottomRight: nonNegative,
        bottomLeft: nonNegative,
      })
      .strict(),
  })
  .strict();

export const EllipseNodeSchema = z
  .object({
    ...baseNodeShape,
    ...compositingShape,
    type: z.literal("ellipse"),
    fill: ShapeFillSchema,
    stroke: StrokeSchema.optional(),
  })
  .strict();

export const VectorPathPointSchema = z
  .object({ x: normalized, y: normalized })
  .strict();

const vectorCommandId = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9:_.@-]+$/, "Use a stable portable command ID.");

export const VectorPathCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: vectorCommandId,
      kind: z.literal("move"),
      to: VectorPathPointSchema,
    })
    .strict(),
  z
    .object({
      id: vectorCommandId,
      kind: z.literal("line"),
      to: VectorPathPointSchema,
    })
    .strict(),
  z
    .object({
      id: vectorCommandId,
      kind: z.literal("cubic"),
      control1: VectorPathPointSchema,
      control2: VectorPathPointSchema,
      to: VectorPathPointSchema,
    })
    .strict(),
  z.object({ id: vectorCommandId, kind: z.literal("close") }).strict(),
]);

export const VectorPathNodeSchema = z
  .object({
    ...baseNodeShape,
    ...compositingShape,
    type: z.literal("vectorPath"),
    commands: z.array(VectorPathCommandSchema).min(2).max(1024),
    fill: ShapeFillSchema.optional(),
    stroke: StrokeSchema.optional(),
  })
  .strict()
  .superRefine((node, context) => {
    if (!node.fill && !node.stroke)
      context.addIssue({
        code: "custom",
        message: "Vector paths require a fill or stroke.",
        path: ["fill"],
      });
    if (node.commands[0]?.kind !== "move")
      context.addIssue({
        code: "custom",
        message: "Vector paths must begin with a move command.",
        path: ["commands", 0],
      });
    const ids = new Set<string>();
    let subpathOpen = false;
    let drawable = false;
    node.commands.forEach((command, index) => {
      if (ids.has(command.id))
        context.addIssue({
          code: "custom",
          message: "Vector command IDs must be unique within a path.",
          path: ["commands", index, "id"],
        });
      ids.add(command.id);
      if (command.kind === "move") subpathOpen = true;
      else if (command.kind === "close") {
        if (!subpathOpen)
          context.addIssue({
            code: "custom",
            message: "Close commands require an open subpath.",
            path: ["commands", index],
          });
        subpathOpen = false;
      } else {
        if (!subpathOpen)
          context.addIssue({
            code: "custom",
            message: "Line and cubic commands require a preceding move.",
            path: ["commands", index],
          });
        drawable = true;
      }
    });
    if (!drawable)
      context.addIssue({
        code: "custom",
        message: "Vector paths require at least one line or cubic command.",
        path: ["commands"],
      });
  });

export const SvgNodeSchema = z
  .object({
    ...baseNodeShape,
    ...compositingShape,
    type: z.literal("svg"),
    assetId: uuid,
    intrinsicSize: z.object({ width: positive, height: positive }).strict(),
  })
  .strict();

export const MaskSourceNodeSchema: z.ZodType<MaskSourceNode> =
  z.discriminatedUnion("type", [
    RasterImageNodeSchema,
    RectangleNodeSchema,
    EllipseNodeSchema,
    VectorPathNodeSchema,
    SvgNodeSchema,
  ]);

export const AdjustmentValuesSchema = z
  .object({
    brightness: finite.min(-100).max(100),
    contrast: finite.min(-100).max(100),
    saturation: finite.min(-100).max(100),
    hue: finite.min(-180).max(180),
    blur: finite.min(0).max(64),
  })
  .strict();

export const AdjustmentNodeSchema: z.ZodType<AdjustmentNode> = z
  .object({
    ...baseNodeShape,
    type: z.literal("adjustment"),
    enabled: z.boolean(),
    targetId: z.union([uuid, z.literal("root")]),
    values: AdjustmentValuesSchema,
  })
  .strict();

export const SceneNodeSchema: z.ZodType<SceneNode> = z.lazy(() =>
  z.union([
    z
      .object({
        ...baseNodeShape,
        ...groupCompositingShape,
        type: z.literal("group"),
        children: z.array(SceneNodeSchema),
      })
      .strict(),
    RasterImageNodeSchema,
    TextNodeSchema,
    RectangleNodeSchema,
    EllipseNodeSchema,
    VectorPathNodeSchema,
    SvgNodeSchema,
    z
      .object({
        ...baseNodeShape,
        type: z.literal("mask"),
        mode: z.enum(["alpha", "luminance"]),
        inverted: z.boolean(),
        maskSource: MaskSourceNodeSchema,
        children: z.array(SceneNodeSchema),
        effects: EffectsSchema.optional(),
      })
      .strict(),
    AdjustmentNodeSchema,
  ]),
);

export const ProjectTemplateSlotSchema = TemplateSlotMetadataSchema.extend({
  nodeId: uuid,
}).strict();

export const ProjectTemplateDefinitionSchema = z
  .object({
    id: uuid,
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    nodes: z.array(SceneNodeSchema).min(1).max(200),
    slots: z.array(ProjectTemplateSlotSchema).max(64),
  })
  .strict()
  .superRefine((template, context) => {
    const nodeIds: string[] = [];
    const visit = (node: SceneNode): void => {
      nodeIds.push(node.id);
      if (node.type === "group") node.children.forEach(visit);
      if (node.type === "mask") {
        visit(node.maskSource);
        node.children.forEach(visit);
      }
    };
    template.nodes.forEach(visit);
    const available = new Set(nodeIds);
    if (nodeIds.length > 499)
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message:
          "Template may contain at most 499 total nodes so its instance group remains within the frame limit.",
      });
    if (available.size !== nodeIds.length)
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Template source node IDs must be unique.",
      });
    const slotIds = template.slots.map((slot) => slot.slotId);
    const slotKeys = template.slots.map((slot) => slot.key);
    const slotNodeIds = template.slots.map((slot) => slot.nodeId);
    if (new Set(slotIds).size !== slotIds.length)
      context.addIssue({
        code: "custom",
        path: ["slots"],
        message: "Template slot IDs must be unique.",
      });
    if (new Set(slotKeys).size !== slotKeys.length)
      context.addIssue({
        code: "custom",
        path: ["slots"],
        message: "Template slot keys must be unique.",
      });
    if (new Set(slotNodeIds).size !== slotNodeIds.length)
      context.addIssue({
        code: "custom",
        path: ["slots"],
        message: "Each template node may own at most one slot.",
      });
    template.slots.forEach((slot, index) => {
      if (!available.has(slot.nodeId))
        context.addIssue({
          code: "custom",
          path: ["slots", index, "nodeId"],
          message: "Template slot must reference a source node.",
        });
    });
  });

export const ApplyProjectTemplateInputSchema = z
  .object({
    instanceId: uuid,
    groupId: uuid,
    idMap: z.record(uuid, uuid),
    parentId: z.union([z.literal("root"), uuid]).default("root"),
    index: z.number().int().nonnegative().optional(),
  })
  .strict();

const briefText = (max: number) => z.string().trim().min(1).max(max);
const portableKey = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z][A-Za-z0-9:_.@-]*$/);
const uniqueStrings = (max: number) =>
  z
    .array(briefText(120))
    .max(max)
    .refine((values) => new Set(values).size === values.length, {
      message: "Values must be unique.",
    });

export const DesignBriefCopyItemSchema = z
  .object({
    id: uuid,
    role: z.enum([
      "headline",
      "subheadline",
      "body",
      "cta",
      "legalCopy",
      "other",
    ]),
    text: briefText(2_000),
  })
  .strict();

export const DesignBriefSchema = z
  .object({
    id: uuid,
    name: briefText(120),
    objective: briefText(2_000),
    audience: z
      .object({
        primary: briefText(500),
        secondary: uniqueStrings(16),
        locale: z
          .string()
          .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
          .optional(),
        context: briefText(500).optional(),
      })
      .strict(),
    format: z
      .object({
        width: z.number().int().min(1).max(16_384),
        height: z.number().int().min(1).max(16_384),
        unit: z.literal("px"),
        channel: z.enum([
          "socialPost",
          "youtubeThumbnail",
          "poster",
          "promotionalCard",
          "presentation",
          "print",
          "custom",
        ]),
      })
      .strict(),
    requiredCopy: z.array(DesignBriefCopyItemSchema).max(64),
    optionalCopy: z.array(DesignBriefCopyItemSchema).max(64),
    brandContext: z
      .object({
        description: briefText(2_000),
        brandKit: z
          .object({ kitId: uuid, revision: z.number().int().positive() })
          .strict()
          .optional(),
        requiredTokenKeys: z
          .array(portableKey)
          .max(64)
          .refine((values) => new Set(values).size === values.length, {
            message: "Required token keys must be unique.",
          }),
        prohibitedUses: uniqueStrings(32),
      })
      .strict(),
    assetRequirements: z
      .array(
        z
          .object({
            id: uuid,
            role: z.enum(DESIGN_SEMANTIC_ROLES),
            description: briefText(1_000),
            required: z.boolean(),
            assetId: uuid.optional(),
          })
          .strict(),
      )
      .max(64),
    hierarchyRequirements: z
      .array(
        z
          .object({
            id: uuid,
            role: z.enum(DESIGN_SEMANTIC_ROLES),
            priority: z.number().int().min(1).max(10),
            description: briefText(1_000),
          })
          .strict(),
      )
      .max(32),
    mood: z
      .object({
        keywords: uniqueStrings(24).refine((values) => values.length > 0, {
          message: "At least one mood keyword is required.",
        }),
        avoid: uniqueStrings(24),
        notes: briefText(1_000).optional(),
      })
      .strict(),
    constraints: z
      .array(
        z
          .object({
            id: uuid,
            priority: z.enum(["must", "should", "may"]),
            description: briefText(1_000),
          })
          .strict(),
      )
      .max(64),
    accessibilityRequirements: z
      .object({
        minimumContrastRatio: z.number().finite().min(1).max(21),
        requirements: uniqueStrings(32),
        readingOrder: z
          .array(z.enum(DESIGN_SEMANTIC_ROLES))
          .max(DESIGN_SEMANTIC_ROLES.length)
          .refine((roles) => new Set(roles).size === roles.length, {
            message: "Reading-order roles must be unique.",
          }),
      })
      .strict(),
    exportRequirements: z
      .array(
        z
          .object({
            id: uuid,
            name: briefText(80),
            format: z.enum(EXPORT_FORMATS),
            scale: z.number().finite().min(0.25).max(4),
            quality: z.number().int().min(1).max(100).optional(),
            matteColor: color.optional(),
            transparentBackground: z.enum(["required", "allowed", "forbidden"]),
          })
          .strict()
          .superRefine((value, context) => {
            if (value.format === "png" && value.quality !== undefined)
              context.addIssue({
                code: "custom",
                path: ["quality"],
                message: "PNG export does not accept lossy quality.",
              });
            if (value.format !== "jpeg" && value.matteColor !== undefined)
              context.addIssue({
                code: "custom",
                path: ["matteColor"],
                message: "Only JPEG export accepts a matte color.",
              });
            if (
              value.format === "jpeg" &&
              value.transparentBackground === "required"
            )
              context.addIssue({
                code: "custom",
                path: ["transparentBackground"],
                message: "JPEG cannot require a transparent background.",
              });
          }),
      )
      .min(1)
      .max(16),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((brief, context) => {
    const copyIds = [...brief.requiredCopy, ...brief.optionalCopy].map(
      (item) => item.id,
    );
    if (new Set(copyIds).size !== copyIds.length)
      context.addIssue({
        code: "custom",
        path: ["requiredCopy"],
        message:
          "Copy item IDs must be unique across required and optional copy.",
      });
    for (const [path, ids] of [
      ["assetRequirements", brief.assetRequirements.map((item) => item.id)],
      [
        "hierarchyRequirements",
        brief.hierarchyRequirements.map((item) => item.id),
      ],
      ["constraints", brief.constraints.map((item) => item.id)],
      ["exportRequirements", brief.exportRequirements.map((item) => item.id)],
    ] as const)
      if (new Set(ids).size !== ids.length)
        context.addIssue({
          code: "custom",
          path: [path],
          message: `${path} IDs must be unique.`,
        });
  }) satisfies z.ZodType<DesignBrief>;

const {
  id: designBriefIdSchema,
  createdAt: designBriefCreatedAtSchema,
  updatedAt: designBriefUpdatedAtSchema,
  ...designBriefInputShape
} = DesignBriefSchema.shape;
void designBriefIdSchema;
void designBriefCreatedAtSchema;
void designBriefUpdatedAtSchema;

export const DesignBriefInputSchema = z.object(designBriefInputShape).strict();

const planReference = uuid;
const planNormalized = z.number().finite().min(0).max(1);
const planFormatSchema = z
  .object({
    width: z.number().int().min(1).max(16_384),
    height: z.number().int().min(1).max(16_384),
    channel: z.enum([
      "socialPost",
      "youtubeThumbnail",
      "poster",
      "promotionalCard",
      "presentation",
      "print",
      "custom",
    ]),
  })
  .strict();

export const DesignPlanSchema = z
  .object({
    id: uuid,
    name: briefText(120),
    briefId: uuid.optional(),
    targetFrameId: uuid.optional(),
    objectiveSummary: briefText(2_000),
    semanticRoles: z
      .array(
        z
          .object({
            id: uuid,
            key: portableKey,
            name: briefText(120),
            role: z.enum(DESIGN_SEMANTIC_ROLES),
            required: z.boolean(),
            nodeId: uuid.optional(),
            copyItemId: uuid.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(128),
    contentHierarchy: z
      .array(
        z
          .object({
            id: uuid,
            roleId: planReference,
            parentRoleId: planReference.optional(),
            priority: z.number().int().min(1).max(128),
          })
          .strict(),
      )
      .max(128),
    layoutRegions: z
      .array(
        z
          .object({
            id: uuid,
            key: portableKey,
            name: briefText(120),
            x: planNormalized,
            y: planNormalized,
            width: z.number().finite().positive().max(1),
            height: z.number().finite().positive().max(1),
          })
          .strict()
          .superRefine((region, context) => {
            if (region.x + region.width > 1)
              context.addIssue({
                code: "custom",
                path: ["width"],
                message: "Layout region must remain inside normalized width.",
              });
            if (region.y + region.height > 1)
              context.addIssue({
                code: "custom",
                path: ["height"],
                message: "Layout region must remain inside normalized height.",
              });
          }),
      )
      .max(64),
    anchors: z
      .array(
        z
          .object({
            id: uuid,
            roleId: planReference,
            regionId: planReference.optional(),
            horizontal: z.enum(["start", "center", "end", "stretch"]),
            vertical: z.enum(["start", "center", "end", "stretch"]),
            offsetX: z.number().finite().min(-1).max(1),
            offsetY: z.number().finite().min(-1).max(1),
          })
          .strict(),
      )
      .max(128),
    constraints: z
      .array(
        z
          .object({
            id: uuid,
            kind: z.enum([
              "preserve",
              "position",
              "spacing",
              "size",
              "content",
              "brand",
              "accessibility",
            ]),
            priority: z.enum(["must", "should", "may"]),
            description: briefText(1_000),
            roleId: planReference.optional(),
            nodeId: uuid.optional(),
          })
          .strict(),
      )
      .max(128),
    safeAreas: z
      .array(
        z
          .object({
            id: uuid,
            name: briefText(120),
            top: planNormalized,
            right: planNormalized,
            bottom: planNormalized,
            left: planNormalized,
            regionId: planReference.optional(),
          })
          .strict()
          .superRefine((safeArea, context) => {
            if (safeArea.left + safeArea.right >= 1)
              context.addIssue({
                code: "custom",
                path: ["right"],
                message:
                  "Safe-area horizontal insets must leave content space.",
              });
            if (safeArea.top + safeArea.bottom >= 1)
              context.addIssue({
                code: "custom",
                path: ["bottom"],
                message: "Safe-area vertical insets must leave content space.",
              });
          }),
      )
      .max(32),
    brandBindings: z
      .array(
        z
          .object({
            id: uuid,
            roleId: planReference,
            property: z.enum([
              "fill",
              "stroke",
              "textColor",
              "typography",
              "effect",
              "spacing",
              "radius",
            ]),
            tokenKey: portableKey,
          })
          .strict(),
      )
      .max(128),
    assetAssignments: z
      .array(
        z
          .object({
            id: uuid,
            roleId: planReference,
            assetId: uuid,
            fit: z.enum(["cover", "contain", "stretch"]),
            preserveCrop: z.boolean(),
          })
          .strict(),
      )
      .max(64),
    effectIntentions: z
      .array(
        z
          .object({
            id: uuid,
            roleId: planReference,
            effectType: z.enum([
              "outerShadow",
              "innerShadow",
              "blur",
              "innerGlow",
              "outerGlow",
              "colorOverlay",
              "gradientOverlay",
            ]),
            enabled: z.boolean(),
            description: briefText(1_000),
          })
          .strict(),
      )
      .max(128),
    variantRules: z
      .array(
        z
          .object({
            id: uuid,
            name: briefText(120),
            description: briefText(1_000),
            format: planFormatSchema.optional(),
            roleBehaviors: z
              .array(
                z
                  .object({
                    roleId: planReference,
                    behavior: z.enum(["preserve", "reflow", "resize", "hide"]),
                  })
                  .strict(),
              )
              .max(128)
              .refine(
                (behaviors) =>
                  new Set(behaviors.map((behavior) => behavior.roleId)).size ===
                  behaviors.length,
                { message: "Variant role behaviors must be unique by role." },
              ),
          })
          .strict(),
      )
      .max(32),
    protectedDecisions: z
      .array(
        z
          .object({
            id: uuid,
            kind: z.enum([
              "node",
              "role",
              "copy",
              "crop",
              "hierarchy",
              "brandBinding",
              "position",
            ]),
            description: briefText(1_000),
            roleId: planReference.optional(),
            nodeId: uuid.optional(),
          })
          .strict(),
      )
      .max(128),
    approval: z
      .object({
        state: z.enum(["draft", "proposed", "approved", "changesRequested"]),
        notes: uniqueStrings(64),
        decidedBy: briefText(128).optional(),
        decidedAt: z.string().datetime().optional(),
      })
      .strict()
      .superRefine((approval, context) => {
        const decided = approval.state === "approved";
        if (decided && (!approval.decidedBy || !approval.decidedAt))
          context.addIssue({
            code: "custom",
            message: "Approved plans require a decision author and timestamp.",
          });
        if (!decided && (approval.decidedBy || approval.decidedAt))
          context.addIssue({
            code: "custom",
            message: "Only approved plans may contain decision metadata.",
          });
        if (
          approval.state === "changesRequested" &&
          approval.notes.length === 0
        )
          context.addIssue({
            code: "custom",
            path: ["notes"],
            message: "Requested changes require at least one review note.",
          });
      }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((plan, context) => {
    const roleIds = new Set(plan.semanticRoles.map((role) => role.id));
    const regionIds = new Set(plan.layoutRegions.map((region) => region.id));
    const roleReference = (roleId: string, path: (string | number)[]) => {
      if (!roleIds.has(roleId))
        context.addIssue({
          code: "custom",
          path,
          message: `Design plan references missing semantic role ${roleId}.`,
        });
    };
    const regionReference = (regionId: string, path: (string | number)[]) => {
      if (!regionIds.has(regionId))
        context.addIssue({
          code: "custom",
          path,
          message: `Design plan references missing layout region ${regionId}.`,
        });
    };
    for (const [index, item] of plan.contentHierarchy.entries()) {
      roleReference(item.roleId, ["contentHierarchy", index, "roleId"]);
      if (item.parentRoleId) {
        roleReference(item.parentRoleId, [
          "contentHierarchy",
          index,
          "parentRoleId",
        ]);
        if (item.parentRoleId === item.roleId)
          context.addIssue({
            code: "custom",
            path: ["contentHierarchy", index, "parentRoleId"],
            message: "A semantic role cannot parent itself.",
          });
      }
    }
    for (const [collection, items] of [
      ["anchors", plan.anchors],
      ["brandBindings", plan.brandBindings],
      ["assetAssignments", plan.assetAssignments],
      ["effectIntentions", plan.effectIntentions],
    ] as const)
      items.forEach((item, index) =>
        roleReference(item.roleId, [collection, index, "roleId"]),
      );
    plan.constraints.forEach((item, index) => {
      if (item.roleId)
        roleReference(item.roleId, ["constraints", index, "roleId"]);
    });
    plan.protectedDecisions.forEach((item, index) => {
      if (item.roleId)
        roleReference(item.roleId, ["protectedDecisions", index, "roleId"]);
      if (item.kind === "node" && !item.nodeId)
        context.addIssue({
          code: "custom",
          path: ["protectedDecisions", index, "nodeId"],
          message: "A node protection requires a node ID.",
        });
      if (item.kind === "role" && !item.roleId)
        context.addIssue({
          code: "custom",
          path: ["protectedDecisions", index, "roleId"],
          message: "A role protection requires a semantic role ID.",
        });
    });
    plan.variantRules.forEach((rule, ruleIndex) =>
      rule.roleBehaviors.forEach((behavior, behaviorIndex) =>
        roleReference(behavior.roleId, [
          "variantRules",
          ruleIndex,
          "roleBehaviors",
          behaviorIndex,
          "roleId",
        ]),
      ),
    );
    plan.anchors.forEach((anchor, index) => {
      if (anchor.regionId)
        regionReference(anchor.regionId, ["anchors", index, "regionId"]);
    });
    plan.safeAreas.forEach((safeArea, index) => {
      if (safeArea.regionId)
        regionReference(safeArea.regionId, ["safeAreas", index, "regionId"]);
    });
    for (const [path, values] of [
      ["semanticRoles", plan.semanticRoles],
      ["contentHierarchy", plan.contentHierarchy],
      ["layoutRegions", plan.layoutRegions],
      ["anchors", plan.anchors],
      ["constraints", plan.constraints],
      ["safeAreas", plan.safeAreas],
      ["brandBindings", plan.brandBindings],
      ["assetAssignments", plan.assetAssignments],
      ["effectIntentions", plan.effectIntentions],
      ["variantRules", plan.variantRules],
      ["protectedDecisions", plan.protectedDecisions],
    ] as const)
      if (new Set(values.map((value) => value.id)).size !== values.length)
        context.addIssue({
          code: "custom",
          path: [path],
          message: `${path} IDs must be unique.`,
        });
    if (
      new Set(plan.semanticRoles.map((role) => role.key)).size !==
      plan.semanticRoles.length
    )
      context.addIssue({
        code: "custom",
        path: ["semanticRoles"],
        message: "Semantic role keys must be unique.",
      });
    if (
      new Set(plan.contentHierarchy.map((item) => item.roleId)).size !==
      plan.contentHierarchy.length
    )
      context.addIssue({
        code: "custom",
        path: ["contentHierarchy"],
        message:
          "Each semantic role may appear only once in the content hierarchy.",
      });
    if (
      new Set(plan.layoutRegions.map((region) => region.key)).size !==
      plan.layoutRegions.length
    )
      context.addIssue({
        code: "custom",
        path: ["layoutRegions"],
        message: "Layout region keys must be unique.",
      });
    const parents = new Map(
      plan.contentHierarchy
        .filter((item) => item.parentRoleId)
        .map((item) => [item.roleId, item.parentRoleId!]),
    );
    for (const roleId of parents.keys()) {
      const visiting = new Set<string>();
      let current: string | undefined = roleId;
      while (current) {
        if (visiting.has(current)) {
          context.addIssue({
            code: "custom",
            path: ["contentHierarchy"],
            message: `Content hierarchy cycle includes role ${current}.`,
          });
          break;
        }
        visiting.add(current);
        current = parents.get(current);
      }
    }
  }) satisfies z.ZodType<DesignPlan>;

const {
  id: designPlanIdSchema,
  createdAt: designPlanCreatedAtSchema,
  updatedAt: designPlanUpdatedAtSchema,
  ...designPlanInputShape
} = DesignPlanSchema.shape;
void designPlanIdSchema;
void designPlanCreatedAtSchema;
void designPlanUpdatedAtSchema;

export const DesignPlanInputSchema = z.object(designPlanInputShape).strict();

export const RootGroupSchema = z
  .object({
    id: z.literal("root"),
    type: z.literal("group"),
    name: z.literal("Root"),
    visible: z.literal(true),
    locked: z.literal(false),
    children: z.array(SceneNodeSchema),
  })
  .strict();

const canvasBackgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("transparent") }).strict(),
  SolidFillSchema,
  LinearGradientFillSchema,
  RadialGradientFillSchema,
]);

export const CanvasGuideSchema = z
  .object({
    id: uuid,
    axis: z.enum(["horizontal", "vertical"]),
    position: finite.min(0),
  })
  .strict();

export const SafeAreaInsetsSchema = z
  .object({
    top: finite.min(0),
    right: finite.min(0),
    bottom: finite.min(0),
    left: finite.min(0),
  })
  .strict();

export const CanvasSpacingBindingSchema = z
  .object({
    id: uuid,
    property: z.literal("safeArea"),
    kitId: uuid,
    kitRevision: z.number().int().positive(),
    kitContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    tokenKey: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  })
  .strict();

export const FrameBrandModeSchema = z
  .object({
    kitId: uuid,
    kitRevision: z.number().int().positive(),
    kitContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    modeKey: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  })
  .strict();

export const FrameDocumentSchema: z.ZodType<FrameDocument> = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    slug,
    name: z.string().min(1).max(160),
    revision: z.number().int().min(0),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    brandMode: FrameBrandModeSchema.optional(),
    canvas: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        background: canvasBackgroundSchema,
        clipContent: z.boolean(),
        guides: z.array(CanvasGuideSchema).max(128).optional(),
        safeArea: SafeAreaInsetsSchema.optional(),
        spacingBinding: CanvasSpacingBindingSchema.optional(),
      })
      .strict(),
    root: RootGroupSchema,
  })
  .strict()
  .superRefine((frame, context) => {
    const guideIds = new Set<string>();
    frame.canvas.guides?.forEach((guide, index) => {
      if (guideIds.has(guide.id))
        context.addIssue({
          code: "custom",
          message: "Canvas guide IDs must be unique within a frame.",
          path: ["canvas", "guides", index, "id"],
        });
      guideIds.add(guide.id);
      const limit =
        guide.axis === "vertical" ? frame.canvas.width : frame.canvas.height;
      if (guide.position > limit)
        context.addIssue({
          code: "custom",
          message: "Canvas guides must remain inside the canvas bounds.",
          path: ["canvas", "guides", index, "position"],
        });
    });
    const safeArea = frame.canvas.safeArea;
    if (
      safeArea &&
      (safeArea.left + safeArea.right >= frame.canvas.width ||
        safeArea.top + safeArea.bottom >= frame.canvas.height)
    )
      context.addIssue({
        code: "custom",
        message: "Safe-area insets must leave a positive interior region.",
        path: ["canvas", "safeArea"],
      });
    const bindingIds = new Set<string>();
    if (frame.canvas.spacingBinding)
      bindingIds.add(frame.canvas.spacingBinding.id);
    const inspectBindings = (nodes: SceneNode[]) => {
      for (const node of nodes) {
        node.brandBindings?.forEach((binding) => {
          if (bindingIds.has(binding.id))
            context.addIssue({
              code: "custom",
              message: "Brand binding IDs must be unique within a frame.",
              path: ["root", "children"],
            });
          bindingIds.add(binding.id);
        });
        if (node.type === "group" || node.type === "mask")
          inspectBindings(node.children);
        if (node.type === "mask") inspectBindings([node.maskSource]);
      }
    };
    inspectBindings(frame.root.children);
  });

export const RenderProfileSchema = z
  .object({
    version: z.literal(1),
    engine: z.literal("pixi-webgl"),
    colorSpace: z.literal("srgb"),
    resolution: z.literal(1),
    antialias: z.literal(true),
    roundPixels: z.literal(false),
    textRenderer: z.literal("canvas"),
  })
  .strict();

export const ExportSettingsSchema = z
  .object({
    format: z.enum(EXPORT_FORMATS),
    scale: z.number().finite().min(0.25).max(4),
    quality: z.number().int().min(1).max(100).optional(),
    matteColor: color.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.format === "png" && value.quality !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quality"],
        message: "PNG export does not accept a lossy quality value.",
      });
    if (value.format !== "jpeg" && value.matteColor !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["matteColor"],
        message: "Only JPEG export accepts a transparency matte color.",
      });
  });

export const ExportSettingsInputSchema = z
  .object({
    format: z.enum(EXPORT_FORMATS).optional(),
    scale: z.number().finite().min(0.25).max(4).optional(),
    quality: z.number().int().min(1).max(100).optional(),
    matteColor: color.optional(),
  })
  .strict();

export const BatchExportRequestSchema = z
  .object({
    frameIds: z
      .array(uuid)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Batch export frame IDs must be unique.",
      }),
    settings: ExportSettingsInputSchema.optional(),
  })
  .strict();

export const ExportPresetSchema = z
  .object({
    id: uuid,
    name: z.string().trim().min(1).max(80),
    format: z.enum(EXPORT_FORMATS),
    scale: z.number().finite().min(0.25).max(4),
    quality: z.number().int().min(1).max(100).optional(),
    matteColor: color.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.format === "png" && value.quality !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quality"],
        message: "PNG export does not accept a lossy quality value.",
      });
    if (value.format !== "jpeg" && value.matteColor !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["matteColor"],
        message: "Only JPEG export accepts a transparency matte color.",
      });
  });

export const ProjectDocumentSchema: z.ZodType<ProjectDocument> = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    slug,
    name: z.string().min(1).max(160),
    revision: z.number().int().min(0),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    frames: z.array(
      z
        .object({
          id: uuid,
          slug,
          name: z.string().min(1).max(160),
          path: relativePath,
        })
        .strict(),
    ),
    frameOrder: z.array(uuid),
    renderProfile: RenderProfileSchema,
    exportPresets: z
      .array(ExportPresetSchema)
      .max(40)
      .refine(
        (presets) =>
          new Set(presets.map((preset) => preset.id)).size === presets.length,
        { message: "Export preset IDs must be unique." },
      )
      .refine(
        (presets) =>
          new Set(presets.map((preset) => preset.name.toLocaleLowerCase()))
            .size === presets.length,
        { message: "Export preset names must be unique." },
      )
      .optional(),
    templates: z
      .array(ProjectTemplateDefinitionSchema)
      .max(100)
      .refine(
        (templates) =>
          new Set(templates.map((template) => template.id)).size ===
          templates.length,
        { message: "Project template IDs must be unique." },
      )
      .refine(
        (templates) =>
          new Set(
            templates.map((template) => template.name.toLocaleLowerCase()),
          ).size === templates.length,
        { message: "Project template names must be unique." },
      )
      .optional(),
    designBriefs: z
      .array(DesignBriefSchema)
      .max(100)
      .refine(
        (briefs) =>
          new Set(briefs.map((brief) => brief.id)).size === briefs.length,
        { message: "Design brief IDs must be unique." },
      )
      .refine(
        (briefs) =>
          new Set(briefs.map((brief) => brief.name.toLocaleLowerCase()))
            .size === briefs.length,
        { message: "Design brief names must be unique." },
      )
      .optional(),
    designPlans: z
      .array(DesignPlanSchema)
      .max(100)
      .refine(
        (plans) => new Set(plans.map((plan) => plan.id)).size === plans.length,
        { message: "Design plan IDs must be unique." },
      )
      .refine(
        (plans) =>
          new Set(plans.map((plan) => plan.name.toLocaleLowerCase())).size ===
          plans.length,
        { message: "Design plan names must be unique." },
      )
      .optional(),
    brandKitPin: z
      .object({
        kitId: uuid,
        revision: z.number().int().positive(),
        contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        resourceMap: z.record(uuid, uuid),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((project, context) => {
    const ids = new Set(project.frames.map((frame) => frame.id));
    if (ids.size !== project.frames.length) {
      context.addIssue({
        code: "custom",
        message: "Frame IDs must be unique.",
        path: ["frames"],
      });
    }
    if (
      project.frameOrder.length !== ids.size ||
      project.frameOrder.some((id) => !ids.has(id))
    ) {
      context.addIssue({
        code: "custom",
        message: "frameOrder must contain each frame ID exactly once.",
        path: ["frameOrder"],
      });
    }
  });

export const RasterAssetSchema = z
  .object({
    id: uuid,
    type: z.literal("raster"),
    path: relativePath,
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    sizeBytes: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const SvgAssetSchema = z
  .object({
    id: uuid,
    type: z.literal("svg"),
    path: relativePath,
    mimeType: z.literal("image/svg+xml"),
    hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    sizeBytes: z.number().int().nonnegative(),
    width: positive,
    height: positive,
    thumbnailPath: relativePath.optional(),
  })
  .strict();

export const AssetSchema = z.discriminatedUnion("type", [
  RasterAssetSchema,
  SvgAssetSchema,
]);

export const AssetManifestSchema: z.ZodType<AssetManifest> = z
  .object({ schemaVersion: z.literal(1), assets: z.array(AssetSchema) })
  .strict();

export const FontRecordSchema = z
  .object({
    id: uuid,
    family: z.string().min(1),
    style: z.enum(["normal", "italic"]),
    weight: z.number().int().min(1).max(1000),
    format: z.enum(["woff2", "woff", "ttf", "otf"]),
    source: z.enum(["runtime", "project"]),
    path: relativePath,
    hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    licenseNotes: z.string(),
  })
  .strict();

export const FontManifestSchema: z.ZodType<FontManifest> = z
  .object({
    schemaVersion: z.literal(1),
    fonts: z.array(FontRecordSchema),
  })
  .strict();

export const DesignConfigSchema: z.ZodType<DesignConfig> = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: uuid,
    server: z
      .object({
        host: z.string().min(1),
        port: z.number().int().min(1).max(65_535),
        allowLan: z.boolean(),
      })
      .strict(),
    rasterLimits: z
      .object({
        maxFileSizeMb: positive,
        maxDimension: z.number().int().positive(),
        maxDecodedMegapixels: positive,
        maxDecodedMemoryMb: positive,
        capabilityMode: z.enum(["strict", "clamp"]),
      })
      .strict(),
    logging: z
      .object({
        level: z.enum(["debug", "info", "warn", "error", "fatal"]),
        maxFileSizeMb: positive,
        maxFiles: z.number().int().positive(),
        retentionDays: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export const parseFrameDocument = (input: unknown): FrameDocument =>
  FrameDocumentSchema.parse(input);
export const parseProjectDocument = (input: unknown): ProjectDocument =>
  ProjectDocumentSchema.parse(input);
