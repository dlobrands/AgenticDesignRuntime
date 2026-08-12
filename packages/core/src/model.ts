export const SCHEMA_VERSION = 1 as const;

export const SUPPORTED_BLEND_MODES = [
  "normal",
  "dissolve",
  "darken",
  "multiply",
  "color-burn",
  "linear-burn",
  "darker-color",
  "lighten",
  "screen",
  "color-dodge",
  "linear-dodge",
  "lighter-color",
  "overlay",
  "soft-light",
  "hard-light",
  "vivid-light",
  "linear-light",
  "pin-light",
  "hard-mix",
  "difference",
  "exclusion",
  "subtract",
  "divide",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

export const GROUP_BLEND_MODES = [
  ...SUPPORTED_BLEND_MODES,
  "pass-through",
] as const;

export type SupportedBlendMode = (typeof SUPPORTED_BLEND_MODES)[number];
export type GroupBlendMode = (typeof GROUP_BLEND_MODES)[number];
export type ActorSource =
  "studio" | "http" | "mcp" | "filesystem" | "system" | "recovery";
export type MutationMode = "preview" | "commit";
export type CapabilityMode = "strict" | "clamp";

export type Transform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  anchorX: number;
  anchorY: number;
};

export type GradientStop = {
  id: string;
  offset: number;
  color: string;
  opacity: number;
};

export type SolidFill = {
  type: "solid";
  color: string;
  opacity: number;
};

export type LinearGradientFill = {
  type: "linearGradient";
  start: { x: number; y: number };
  end: { x: number; y: number };
  stops: GradientStop[];
  interpolation: "linear-srgb";
  spread: "pad";
  dither: true;
};

export type RadialGradientFill = {
  type: "radialGradient";
  center: { x: number; y: number };
  radius: { x: number; y: number };
  focalPoint?: { x: number; y: number };
  stops: GradientStop[];
  interpolation: "linear-srgb";
  spread: "pad";
  dither: true;
};

export type ShapeFill = SolidFill | LinearGradientFill | RadialGradientFill;
export type CanvasBackground = { type: "transparent" } | ShapeFill;

export type CanvasGuide = {
  id: string;
  axis: "horizontal" | "vertical";
  position: number;
};

export type SafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type ResizeConstraints = {
  horizontal: "left" | "center" | "right" | "stretch" | "scale";
  vertical: "top" | "middle" | "bottom" | "stretch" | "scale";
};

export type BrandBindableProperty =
  "fill" | "stroke" | "textColor" | "typography" | "effects" | "radius";

export type BrandStyleBinding = {
  id: string;
  property: BrandBindableProperty;
  kitId: string;
  kitRevision: number;
  kitContentHash: string;
  tokenKey: string;
};

export type CanvasSpacingBinding = {
  id: string;
  property: "safeArea";
  kitId: string;
  kitRevision: number;
  kitContentHash: string;
  tokenKey: string;
};

export type FrameBrandMode = {
  kitId: string;
  kitRevision: number;
  kitContentHash: string;
  modeKey: string;
};

export const TEMPLATE_SLOT_ROLES = [
  "headline",
  "supportingCopy",
  "heroImage",
  "logo",
  "cta",
  "background",
  "badge",
  "legalCopy",
] as const;
export type TemplateSlotRole = (typeof TEMPLATE_SLOT_ROLES)[number];

export const DESIGN_SEMANTIC_ROLES = [
  "headline",
  "subheadline",
  "body",
  "cta",
  "heroSubject",
  "background",
  "logo",
  "badge",
  "supportingGraphic",
  "legalCopy",
] as const;
export type DesignSemanticRole = (typeof DESIGN_SEMANTIC_ROLES)[number];

export type DesignBriefCopyItem = {
  id: string;
  role: "headline" | "subheadline" | "body" | "cta" | "legalCopy" | "other";
  text: string;
};

export type DesignBrief = {
  id: string;
  name: string;
  objective: string;
  audience: {
    primary: string;
    secondary: string[];
    locale?: string;
    context?: string;
  };
  format: {
    width: number;
    height: number;
    unit: "px";
    channel:
      | "socialPost"
      | "youtubeThumbnail"
      | "poster"
      | "promotionalCard"
      | "presentation"
      | "print"
      | "custom";
  };
  requiredCopy: DesignBriefCopyItem[];
  optionalCopy: DesignBriefCopyItem[];
  brandContext: {
    description: string;
    brandKit?: { kitId: string; revision: number };
    requiredTokenKeys: string[];
    prohibitedUses: string[];
  };
  assetRequirements: Array<{
    id: string;
    role: DesignSemanticRole;
    description: string;
    required: boolean;
    assetId?: string;
  }>;
  hierarchyRequirements: Array<{
    id: string;
    role: DesignSemanticRole;
    priority: number;
    description: string;
  }>;
  mood: {
    keywords: string[];
    avoid: string[];
    notes?: string;
  };
  constraints: Array<{
    id: string;
    priority: "must" | "should" | "may";
    description: string;
  }>;
  accessibilityRequirements: {
    minimumContrastRatio: number;
    requirements: string[];
    readingOrder: DesignSemanticRole[];
  };
  exportRequirements: Array<{
    id: string;
    name: string;
    format: ExportFormat;
    scale: number;
    quality?: number;
    matteColor?: string;
    transparentBackground: "required" | "allowed" | "forbidden";
  }>;
  createdAt: string;
  updatedAt: string;
};

export type DesignPlan = {
  id: string;
  name: string;
  briefId?: string;
  targetFrameId?: string;
  objectiveSummary: string;
  semanticRoles: Array<{
    id: string;
    key: string;
    name: string;
    role: DesignSemanticRole;
    required: boolean;
    nodeId?: string;
    copyItemId?: string;
  }>;
  contentHierarchy: Array<{
    id: string;
    roleId: string;
    parentRoleId?: string;
    priority: number;
  }>;
  layoutRegions: Array<{
    id: string;
    key: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  anchors: Array<{
    id: string;
    roleId: string;
    regionId?: string;
    horizontal: "start" | "center" | "end" | "stretch";
    vertical: "start" | "center" | "end" | "stretch";
    offsetX: number;
    offsetY: number;
  }>;
  constraints: Array<{
    id: string;
    kind:
      | "preserve"
      | "position"
      | "spacing"
      | "size"
      | "content"
      | "brand"
      | "accessibility";
    priority: "must" | "should" | "may";
    description: string;
    roleId?: string;
    nodeId?: string;
  }>;
  safeAreas: Array<{
    id: string;
    name: string;
    top: number;
    right: number;
    bottom: number;
    left: number;
    regionId?: string;
  }>;
  brandBindings: Array<{
    id: string;
    roleId: string;
    property:
      | "fill"
      | "stroke"
      | "textColor"
      | "typography"
      | "effect"
      | "spacing"
      | "radius";
    tokenKey: string;
  }>;
  assetAssignments: Array<{
    id: string;
    roleId: string;
    assetId: string;
    fit: "cover" | "contain" | "stretch";
    preserveCrop: boolean;
  }>;
  effectIntentions: Array<{
    id: string;
    roleId: string;
    effectType:
      | "outerShadow"
      | "innerShadow"
      | "blur"
      | "innerGlow"
      | "outerGlow"
      | "colorOverlay"
      | "gradientOverlay";
    enabled: boolean;
    description: string;
  }>;
  variantRules: Array<{
    id: string;
    name: string;
    description: string;
    format?: {
      width: number;
      height: number;
      channel:
        | "socialPost"
        | "youtubeThumbnail"
        | "poster"
        | "promotionalCard"
        | "presentation"
        | "print"
        | "custom";
    };
    roleBehaviors: Array<{
      roleId: string;
      behavior: "preserve" | "reflow" | "resize" | "hide";
    }>;
  }>;
  protectedDecisions: Array<{
    id: string;
    kind:
      | "node"
      | "role"
      | "copy"
      | "crop"
      | "hierarchy"
      | "brandBinding"
      | "position";
    description: string;
    roleId?: string;
    nodeId?: string;
  }>;
  approval: {
    state: "draft" | "proposed" | "approved" | "changesRequested";
    notes: string[];
    decidedBy?: string;
    decidedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type TemplateInstanceMetadata = {
  templateId: string;
  instanceId: string;
  sourceNodeId?: string;
};

export type TemplateSlotMetadata = {
  slotId: string;
  key: string;
  name: string;
  role: TemplateSlotRole;
};

export type ComponentOverrideProperty =
  | "visibility"
  | "transform"
  | "compositing"
  | "textContent"
  | "typography"
  | "textBox"
  | "fill"
  | "stroke"
  | "vectorPath"
  | "effects"
  | "radius"
  | "crop"
  | "asset";

export type BrandComponentInstanceMetadata = {
  instanceId: string;
  kitId: string;
  kitRevision: number;
  kitContentHash: string;
  definitionKey: string;
  variantGroupKey?: string;
  variantKey?: string;
  sourceNodeId: string;
  allowedOverrides: ComponentOverrideProperty[];
  overrides: ComponentOverrideProperty[];
};

export type FrameResizeStrategy = "canvasOnly" | "scale" | "constraints";

export type Stroke = {
  enabled: boolean;
  width: number;
  alignment: "inside" | "center" | "outside";
  opacity: number;
  paint: ShapeFill;
  dash?: {
    values: number[];
    offset: number;
    cap: "butt" | "round" | "square";
  };
};

export type OuterShadow = {
  enabled: boolean;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  opacity: number;
};

export type EffectBase<TType extends string> = {
  id: string;
  type: TType;
  enabled: boolean;
};

export type OuterShadowEffect = EffectBase<"outerShadow"> &
  Omit<OuterShadow, "enabled">;
export type InnerShadowEffect = EffectBase<"innerShadow"> &
  Omit<OuterShadow, "enabled">;
export type BlurEffect = EffectBase<"blur"> & { radius: number };
export type GlowEffect = EffectBase<"innerGlow" | "outerGlow"> & {
  blur: number;
  spread: number;
  color: string;
  opacity: number;
};
export type ColorOverlayEffect = EffectBase<"colorOverlay"> & {
  paint: SolidFill;
  opacity: number;
};
export type GradientOverlayEffect = EffectBase<"gradientOverlay"> & {
  paint: LinearGradientFill | RadialGradientFill;
  opacity: number;
};
export type Effect =
  | OuterShadowEffect
  | InnerShadowEffect
  | BlurEffect
  | GlowEffect
  | ColorOverlayEffect
  | GradientOverlayEffect;
export type EffectStack = { items: Effect[]; outerShadow?: never };
export type LegacyEffects = { outerShadow: OuterShadow; items?: never };
export type Effects = EffectStack | LegacyEffects;

export type SceneNodeType =
  | "group"
  | "rasterImage"
  | "text"
  | "rectangle"
  | "ellipse"
  | "vectorPath"
  | "svg"
  | "mask"
  | "adjustment";

export type BaseNode = {
  id: string;
  type: SceneNodeType;
  name: string;
  visible: boolean;
  locked: boolean;
  transform: Transform;
  resizeConstraints?: ResizeConstraints;
  templateInstance?: TemplateInstanceMetadata;
  templateSlot?: TemplateSlotMetadata;
  brandComponent?: BrandComponentInstanceMetadata;
  brandBindings?: BrandStyleBinding[];
};

export type CompositingProperties<TBlend extends string = SupportedBlendMode> =
  {
    opacity: number;
    blendMode: TBlend;
    effects?: Effects;
  };

export type GroupNode = BaseNode &
  CompositingProperties<GroupBlendMode> & {
    type: "group";
    children: SceneNode[];
  };

export type RasterImageNode = BaseNode &
  CompositingProperties & {
    type: "rasterImage";
    assetId: string;
    fit: "fill" | "contain" | "cover" | "none";
    crop?: { x: number; y: number; width: number; height: number };
  };

export type TextSpanStyle = {
  fontId?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  color?: string;
  opacity?: number;
  letterSpacing?: number;
  baselineShift?: number;
  decoration?: "none" | "underline" | "lineThrough";
};

export type TextSpan = {
  id: string;
  start: number;
  end: number;
  style: TextSpanStyle;
};

export type TextNode = BaseNode &
  CompositingProperties & {
    type: "text";
    text: string;
    typography: {
      fontId: string;
      fontSize: number;
      fontWeight: number;
      fontStyle: "normal" | "italic";
      lineHeight: number;
      letterSpacing: number;
      alignment: "left" | "center" | "right" | "justify";
      verticalAlignment: "top" | "middle" | "bottom";
      color: string;
      opacity: number;
    };
    spans?: TextSpan[];
    textBox: {
      mode: "autoWidth" | "autoHeight" | "fixed";
      width: number;
      height?: number;
      wrapping: "word" | "character" | "none";
      overflow: "visible" | "clip";
      overflowAccepted?: boolean;
    };
  };

export type RectangleNode = BaseNode &
  CompositingProperties & {
    type: "rectangle";
    fill: ShapeFill;
    stroke?: Stroke;
    cornerRadius: {
      topLeft: number;
      topRight: number;
      bottomRight: number;
      bottomLeft: number;
    };
  };

export type EllipseNode = BaseNode &
  CompositingProperties & {
    type: "ellipse";
    fill: ShapeFill;
    stroke?: Stroke;
  };

export type VectorPathPoint = { x: number; y: number };

export type VectorPathCommand =
  | { id: string; kind: "move"; to: VectorPathPoint }
  | { id: string; kind: "line"; to: VectorPathPoint }
  | {
      id: string;
      kind: "cubic";
      control1: VectorPathPoint;
      control2: VectorPathPoint;
      to: VectorPathPoint;
    }
  | { id: string; kind: "close" };

export type VectorPathNode = BaseNode &
  CompositingProperties & {
    type: "vectorPath";
    commands: VectorPathCommand[];
    fill?: ShapeFill;
    stroke?: Stroke;
  };

export type SvgNode = BaseNode &
  CompositingProperties & {
    type: "svg";
    assetId: string;
    intrinsicSize: { width: number; height: number };
  };

export type MaskSourceNode =
  RectangleNode | EllipseNode | VectorPathNode | RasterImageNode | SvgNode;

export type MaskNode = BaseNode & {
  type: "mask";
  mode: "alpha" | "luminance";
  inverted: boolean;
  maskSource: MaskSourceNode;
  children: SceneNode[];
  effects?: Effects;
};

export type AdjustmentValues = {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  blur: number;
};

export type AdjustmentNode = BaseNode & {
  type: "adjustment";
  enabled: boolean;
  targetId: string;
  values: AdjustmentValues;
};

export type SceneNode =
  | GroupNode
  | RasterImageNode
  | TextNode
  | RectangleNode
  | EllipseNode
  | VectorPathNode
  | SvgNode
  | MaskNode
  | AdjustmentNode;

export type ProjectTemplateSlot = TemplateSlotMetadata & {
  nodeId: string;
};

export type ProjectTemplateDefinition = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  nodes: SceneNode[];
  slots: ProjectTemplateSlot[];
};

export type RootGroup = {
  id: "root";
  type: "group";
  name: "Root";
  visible: true;
  locked: false;
  children: SceneNode[];
};

export type FrameDocument = {
  schemaVersion: 1;
  id: string;
  slug: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  brandMode?: FrameBrandMode;
  canvas: {
    width: number;
    height: number;
    background: CanvasBackground;
    clipContent: boolean;
    guides?: CanvasGuide[];
    safeArea?: SafeAreaInsets;
    spacingBinding?: CanvasSpacingBinding;
  };
  root: RootGroup;
};

export type FrameReference = {
  id: string;
  slug: string;
  name: string;
  path: string;
};

export type RenderProfile = {
  version: 1;
  engine: "pixi-webgl";
  colorSpace: "srgb";
  resolution: 1;
  antialias: true;
  roundPixels: false;
  textRenderer: "canvas";
};

export const EXPORT_FORMATS = ["png", "jpeg", "webp"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportSettings = {
  format: ExportFormat;
  scale: number;
  quality?: number;
  matteColor?: string;
};

export type ExportPreset = ExportSettings & {
  id: string;
  name: string;
};

export type ProjectDocument = {
  schemaVersion: 1;
  id: string;
  slug: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  frames: FrameReference[];
  frameOrder: string[];
  renderProfile: RenderProfile;
  exportPresets?: ExportPreset[];
  templates?: ProjectTemplateDefinition[];
  designBriefs?: DesignBrief[];
  designPlans?: DesignPlan[];
  brandKitPin?: {
    kitId: string;
    revision: number;
    contentHash: string;
    resourceMap: Record<string, string>;
  };
};

export type RasterAsset = {
  id: string;
  type: "raster";
  path: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  hash: string;
  sizeBytes: number;
  width: number;
  height: number;
};

export type SvgAsset = {
  id: string;
  type: "svg";
  path: string;
  mimeType: "image/svg+xml";
  hash: string;
  sizeBytes: number;
  width: number;
  height: number;
  thumbnailPath?: string;
};

export type Asset = RasterAsset | SvgAsset;
export type AssetManifest = { schemaVersion: 1; assets: Asset[] };

export type FontRecord = {
  id: string;
  family: string;
  style: "normal" | "italic";
  weight: number;
  format: "woff2" | "woff" | "ttf" | "otf";
  source: "runtime" | "project";
  path: string;
  hash: string;
  licenseNotes: string;
};

export type FontManifest = { schemaVersion: 1; fonts: FontRecord[] };

export type DesignConfig = {
  schemaVersion: 1;
  workspaceId: string;
  server: { host: string; port: number; allowLan: boolean };
  rasterLimits: {
    maxFileSizeMb: number;
    maxDimension: number;
    maxDecodedMegapixels: number;
    maxDecodedMemoryMb: number;
    capabilityMode: CapabilityMode;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error" | "fatal";
    maxFileSizeMb: number;
    maxFiles: number;
    retentionDays: number;
  };
};

export type RuntimeCapabilities = {
  maxTextureSize: number;
  maxRenderbufferSize: number;
  maxCanvasDimension: number;
  effectiveRasterLimits: DesignConfig["rasterLimits"];
};

export const DEFAULT_RENDER_PROFILE: RenderProfile = {
  version: 1,
  engine: "pixi-webgl",
  colorSpace: "srgb",
  resolution: 1,
  antialias: true,
  roundPixels: false,
  textRenderer: "canvas",
};

export const IDENTITY_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  anchorX: 0,
  anchorY: 0,
};

export const DEFAULT_CONFIG = (workspaceId: string): DesignConfig => ({
  schemaVersion: SCHEMA_VERSION,
  workspaceId,
  server: { host: "127.0.0.1", port: 4100, allowLan: false },
  rasterLimits: {
    maxFileSizeMb: 100,
    maxDimension: 16_384,
    maxDecodedMegapixels: 64,
    maxDecodedMemoryMb: 512,
    capabilityMode: "clamp",
  },
  logging: {
    level: "info",
    maxFileSizeMb: 10,
    maxFiles: 10,
    retentionDays: 14,
  },
});
