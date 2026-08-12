import "pixi.js/advanced-blend-modes";
import "pixi.js/filters";
import "pixi.js/unsafe-eval";
import {
  Assets,
  BlurFilter,
  CanvasTextMetrics,
  ColorMatrixFilter,
  Container,
  Graphics,
  MaskFilter,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
  WebGLRenderer,
  type Filter,
  type FillInput,
  type StrokeStyle,
} from "pixi.js";
import {
  assertNever,
  deterministicSeed,
  effectItems,
  findNode,
  findNodeLocation,
  hasEnabledEffects,
  type AdjustmentNode,
  type Asset,
  type Effects,
  type FontRecord,
  type FrameDocument,
  type SceneNode,
  type ShapeFill,
  type Stroke,
  type TextNode,
  type Transform,
} from "@agentic-design/core";
import { registerAgenticBlendModes } from "./blend-modes.js";
import { dissolveFilter, luminanceToAlphaFilter } from "./filters.js";
import { gradientCanvas, solidColorNumber } from "./gradient.js";
import {
  planFrameReconciliation,
  type RendererDirtyCategory,
} from "./reconciliation.js";
import {
  layoutRichTextNode,
  richTextStyleOptions,
} from "./rich-text-layout.js";
import { vectorPathSubpaths } from "./vector-path.js";

export type RendererResources = {
  assetUrl: (assetId: string) => string;
  asset?: (assetId: string) => Asset | undefined;
  fontFamily?: (fontId: string) => string;
};

export type RendererSetFrameOptions = {
  deferFinalRender?: boolean;
};

const assetFormat = (asset: Asset): string =>
  asset.mimeType === "image/jpeg"
    ? "jpg"
    : asset.mimeType === "image/svg+xml"
      ? "svg"
      : asset.mimeType.split("/")[1]!;

const hasEnabledEffectsInTree = (nodes: readonly SceneNode[]): boolean =>
  nodes.some((node) => {
    if ("effects" in node && hasEnabledEffects(node.effects)) return true;
    if (node.type === "mask")
      return hasEnabledEffectsInTree([node.maskSource, ...node.children]);
    return node.type === "group" && hasEnabledEffectsInTree(node.children);
  });

type RenderRecord = {
  node: SceneNode;
  wrapper: Container;
  content: Container;
  childrenContainer: Container;
};

export type RendererPoint = { x: number; y: number };
export type RendererNodeState = {
  id: string;
  locked: boolean;
  transform: Transform;
};
export type RendererBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type RendererReconciliationMetrics = {
  mode: "full" | "incremental";
  reason?:
    "initial" | "canvas" | "canvas-metadata" | "hierarchy" | "node-content";
  dirty: RendererDirtyCategory[];
  reconciliationDurationMs: number;
  renderDurationMs: number;
  nodesRebuilt: number;
  nodesUpdatedInPlace: number;
  textureAllocations: number;
  activeGeneratedTextures: number;
  activeAssetTextures: number;
  cacheInvalidations: number;
};

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

export const projectFontFamily = (fontId: string): string =>
  `ADR_${fontId.replaceAll("-", "_")}`;

type RegisteredFontFace = {
  signature: string;
  face: FontFace;
  loaded: Promise<FontFace>;
};

const registeredFontFaces = new WeakMap<
  FontFaceSet,
  Map<string, RegisteredFontFace>
>();

const fontFaceRegistry = (): Map<string, RegisteredFontFace> => {
  const existing = registeredFontFaces.get(document.fonts);
  if (existing) return existing;
  const created = new Map<string, RegisteredFontFace>();
  registeredFontFaces.set(document.fonts, created);
  return created;
};

export const loadProjectFonts = async (
  fonts: readonly FontRecord[],
  fontUrl: (fontId: string) => string,
): Promise<void> => {
  const registry = fontFaceRegistry();
  await Promise.all(
    fonts.map(async (font) => {
      const family = projectFontFamily(font.id);
      const signature = `${font.hash}:${font.style}:${font.weight}`;
      const existing = registry.get(family);
      if (existing?.signature === signature) {
        await existing.loaded;
        if (!document.fonts.has(existing.face))
          document.fonts.add(existing.face);
        return;
      }
      const face = new FontFace(family, `url("${fontUrl(font.id)}")`, {
        style: font.style,
        weight: String(font.weight),
      });
      const registered = { signature, face, loaded: face.load() };
      registry.set(family, registered);
      try {
        await registered.loaded;
      } catch (error) {
        if (registry.get(family) === registered) registry.delete(family);
        throw error;
      }
      if (registry.get(family) !== registered) return;
      if (existing) document.fonts.delete(existing.face);
      document.fonts.add(face);
    }),
  );
  await document.fonts.ready;
};

const applyTransform = (display: Container, transform: Transform): void => {
  display.position.set(transform.x, transform.y);
  display.pivot.set(
    transform.anchorX * transform.width,
    transform.anchorY * transform.height,
  );
  display.scale.set(transform.scaleX, transform.scaleY);
  display.rotation = radians(transform.rotation);
  display.skew.set(radians(transform.skewX), radians(transform.skewY));
};

const roundedRectanglePath = (
  graphics: Graphics,
  width: number,
  height: number,
  corners: {
    topLeft: number;
    topRight: number;
    bottomRight: number;
    bottomLeft: number;
  },
): Graphics => {
  const maximum = Math.min(width, height) / 2;
  const tl = Math.min(corners.topLeft, maximum);
  const tr = Math.min(corners.topRight, maximum);
  const br = Math.min(corners.bottomRight, maximum);
  const bl = Math.min(corners.bottomLeft, maximum);
  return graphics
    .moveTo(tl, 0)
    .lineTo(width - tr, 0)
    .quadraticCurveTo(width, 0, width, tr)
    .lineTo(width, height - br)
    .quadraticCurveTo(width, height, width - br, height)
    .lineTo(bl, height)
    .quadraticCurveTo(0, height, 0, height - bl)
    .lineTo(0, tl)
    .quadraticCurveTo(0, 0, tl, 0)
    .closePath();
};

type SegmentPoint = { x: number; y: number };

const dashedPolyline = (
  graphics: Graphics,
  points: SegmentPoint[],
  pattern: number[],
  offset: number,
  closed: boolean,
): void => {
  const total = pattern.reduce((sum, value) => sum + value, 0);
  let phase = ((offset % total) + total) % total;
  let patternIndex = 0;
  while (phase >= pattern[patternIndex]!) {
    phase -= pattern[patternIndex]!;
    patternIndex = (patternIndex + 1) % pattern.length;
  }
  let remaining = pattern[patternIndex]! - phase;
  let drawing = patternIndex % 2 === 0;
  const sequence = closed ? [...points, points[0]!] : points;
  for (let index = 1; index < sequence.length; index += 1) {
    const start = sequence[index - 1]!;
    const end = sequence[index]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0) continue;
    let consumed = 0;
    while (consumed < length - 1e-6) {
      const amount = Math.min(remaining, length - consumed);
      const from = consumed / length;
      const to = (consumed + amount) / length;
      if (drawing) {
        graphics
          .moveTo(start.x + dx * from, start.y + dy * from)
          .lineTo(start.x + dx * to, start.y + dy * to);
      }
      consumed += amount;
      remaining -= amount;
      if (remaining <= 1e-6) {
        patternIndex = (patternIndex + 1) % pattern.length;
        remaining = pattern[patternIndex]!;
        drawing = patternIndex % 2 === 0;
      }
    }
  }
};

const rectanglePoints = (width: number, height: number): SegmentPoint[] => [
  { x: width / 2, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
  { x: 0, y: 0 },
  { x: width / 2, y: 0 },
];

const ellipsePoints = (
  width: number,
  height: number,
  segments = 192,
): SegmentPoint[] =>
  Array.from({ length: segments }, (_, index) => {
    const angle = -Math.PI / 2 + (index / segments) * Math.PI * 2;
    return {
      x: width / 2 + (Math.cos(angle) * width) / 2,
      y: height / 2 + (Math.sin(angle) * height) / 2,
    };
  });

export class DesignRenderer {
  readonly renderer = new WebGLRenderer();
  readonly stage = new Container();
  readonly #records = new Map<string, RenderRecord>();
  readonly #generatedTextures = new Set<Texture>();
  readonly #textureOwners = new Map<string, Set<Texture>>();
  readonly #effectFilters = new Set<Filter>();
  readonly #effectFilterOwners = new Map<string, Set<Filter>>();
  #activeAssetUrls = new Set<string>();
  #textureAllocationCount = 0;
  #frame?: FrameDocument;
  #resources?: RendererResources;
  #canvas?: HTMLCanvasElement;
  #artboard?: Container;
  #initialized = false;
  #renderResolution = 1;
  #lastReconciliation: RendererReconciliationMetrics = {
    mode: "full",
    reason: "initial",
    dirty: [],
    reconciliationDurationMs: 0,
    renderDurationMs: 0,
    nodesRebuilt: 0,
    nodesUpdatedInPlace: 0,
    textureAllocations: 0,
    activeGeneratedTextures: 0,
    activeAssetTextures: 0,
    cacheInvalidations: 0,
  };

  async initialize(
    canvas: HTMLCanvasElement,
    width = 1,
    height = 1,
    resolution = 1,
  ): Promise<void> {
    if (this.#initialized) return;
    if (!Number.isFinite(resolution) || resolution < 0.25 || resolution > 4)
      throw new Error("Renderer resolution must be between 0.25× and 4×.");
    registerAgenticBlendModes();
    this.#canvas = canvas;
    this.#renderResolution = resolution;
    await this.renderer.init({
      canvas,
      width,
      height,
      failIfMajorPerformanceCaveat: false,
      skipExtensionImports: true,
      antialias: true,
      resolution,
      autoDensity: false,
      backgroundAlpha: 0,
      hello: false,
    });
    this.#initialized = true;
  }

  async setFrame(
    frame: FrameDocument,
    resources: RendererResources,
    options: RendererSetFrameOptions = {},
  ): Promise<void> {
    if (!this.#initialized)
      throw new Error("Initialize the renderer before loading a frame.");
    const started = performance.now();
    const allocationsBefore = this.#textureAllocationCount;
    const previousFrame = this.#frame;
    const plan = planFrameReconciliation(previousFrame, frame);
    const nextAssetUrls = this.#assetUrlsForFrame(frame, resources);
    const staleAssetUrls = [...this.#activeAssetUrls].filter(
      (url) => !nextAssetUrls.has(url),
    );
    this.#activeAssetUrls = nextAssetUrls;
    const releaseStaleAssets = async (): Promise<void> => {
      await Promise.all(
        staleAssetUrls.map((url) => Assets.unload(url).catch(() => undefined)),
      );
    };
    this.#frame = structuredClone(frame);
    const renderFrame = this.#frame;
    this.#resources = resources;
    if (
      plan.mode === "incremental" &&
      this.#artboard &&
      (!plan.dirty.includes("hierarchy") ||
        (previousFrame &&
          this.#canReconcileHierarchy(previousFrame, renderFrame)))
    ) {
      let updated = plan.dirty.includes("hierarchy")
        ? this.#reconcileHierarchy(renderFrame)
        : 0;
      for (const change of plan.changes) {
        const record = this.#records.get(change.nodeId);
        const node = findNode(renderFrame, change.nodeId);
        if (!record || !node) continue;
        record.node = node;
        record.wrapper.label = `${node.type}:${node.name}`;
        record.wrapper.visible = node.visible;
        if (change.transformChanged)
          applyTransform(record.wrapper, node.transform);
        updated += 1;
      }
      if (updated === 0) {
        if (plan.reason === "canvas-metadata")
          this.#lastReconciliation = {
            mode: "incremental",
            reason: plan.reason,
            dirty: plan.dirty,
            reconciliationDurationMs: performance.now() - started,
            renderDurationMs: 0,
            nodesRebuilt: 0,
            nodesUpdatedInPlace: 0,
            textureAllocations: 0,
            activeGeneratedTextures: this.#generatedTextures.size,
            activeAssetTextures: this.#activeAssetUrls.size,
            cacheInvalidations: 0,
          };
        await releaseStaleAssets();
        return;
      }
      const renderStarted = performance.now();
      this.renderer.render({ container: this.stage });
      const renderDurationMs = performance.now() - renderStarted;
      this.#lastReconciliation = {
        mode: "incremental",
        dirty: plan.dirty,
        reconciliationDurationMs: performance.now() - started,
        renderDurationMs,
        nodesRebuilt: 0,
        nodesUpdatedInPlace: updated,
        textureAllocations: 0,
        activeGeneratedTextures: this.#generatedTextures.size,
        activeAssetTextures: this.#activeAssetUrls.size,
        cacheInvalidations: 0,
      };
      await releaseStaleAssets();
      return;
    }
    if (this.#canReconcileLeafRecords(plan, renderFrame)) {
      let updated = 0;
      let rebuilt = 0;
      let cacheInvalidations = 0;
      for (const change of plan.changes) {
        const node = findNode(renderFrame, change.nodeId);
        if (!node) continue;
        if (change.dirty.some((dirty) => dirty !== "transform")) {
          cacheInvalidations += await this.#replaceLeafRecord(node);
          rebuilt += 1;
        } else {
          const record = this.#records.get(change.nodeId);
          if (!record) continue;
          record.node = node;
          record.wrapper.label = `${node.type}:${node.name}`;
          record.wrapper.visible = node.visible;
          if (change.transformChanged)
            applyTransform(record.wrapper, node.transform);
          updated += 1;
        }
      }
      const renderStarted = performance.now();
      this.renderer.render({ container: this.stage });
      this.#lastReconciliation = {
        mode: "incremental",
        dirty: plan.dirty,
        reconciliationDurationMs: performance.now() - started,
        renderDurationMs: performance.now() - renderStarted,
        nodesRebuilt: rebuilt,
        nodesUpdatedInPlace: updated,
        textureAllocations: this.#textureAllocationCount - allocationsBefore,
        activeGeneratedTextures: this.#generatedTextures.size,
        activeAssetTextures: this.#activeAssetUrls.size,
        cacheInvalidations,
      };
      await releaseStaleAssets();
      return;
    }
    if (
      previousFrame &&
      this.#canReconcileNodeSet(plan, previousFrame, renderFrame)
    ) {
      const { rebuilt, updated } = await this.#reconcileNodeSet(
        plan,
        previousFrame,
        renderFrame,
      );
      const renderStarted = performance.now();
      this.renderer.render({ container: this.stage });
      this.#lastReconciliation = {
        mode: "incremental",
        reason: "hierarchy",
        dirty: plan.dirty,
        reconciliationDurationMs: performance.now() - started,
        renderDurationMs: performance.now() - renderStarted,
        nodesRebuilt: rebuilt,
        nodesUpdatedInPlace: updated,
        textureAllocations: this.#textureAllocationCount - allocationsBefore,
        activeGeneratedTextures: this.#generatedTextures.size,
        activeAssetTextures: this.#activeAssetUrls.size,
        cacheInvalidations: 0,
      };
      await releaseStaleAssets();
      return;
    }
    this.#records.clear();
    this.#artboard = undefined;
    for (const child of this.stage.removeChildren())
      child.destroy({ children: true });
    this.renderer.resetState();
    for (const filter of this.#effectFilters) filter.destroy();
    this.#effectFilters.clear();
    this.#effectFilterOwners.clear();
    for (const texture of this.#generatedTextures) texture.destroy(true);
    this.#generatedTextures.clear();
    this.#textureOwners.clear();
    this.renderer.resize(renderFrame.canvas.width, renderFrame.canvas.height);

    const artboard = new Container();
    this.#artboard = artboard;
    const background = this.#background(renderFrame);
    if (background) artboard.addChild(background);
    for (const node of renderFrame.root.children) {
      if (node.type === "adjustment") continue;
      artboard.addChild(await this.#buildNode(node));
    }
    // The WebGL render target is exactly the artboard dimensions, so it is
    // already the canonical export clip. A self-child Pixi mask here would
    // recursively mask the artboard and can make the entire scene transparent.
    this.stage.addChild(artboard);
    const requiresPostProcessing =
      hasEnabledEffectsInTree(renderFrame.root.children) ||
      renderFrame.root.children.some(
        (node) => node.type === "adjustment" && node.enabled,
      );
    let renderDurationMs = 0;
    if (!options.deferFinalRender || requiresPostProcessing) {
      const firstRenderStarted = performance.now();
      this.renderer.render({ container: this.stage });
      renderDurationMs = performance.now() - firstRenderStarted;
    }
    if (requiresPostProcessing) {
      this.#applyEffects(renderFrame.root.children);
      this.#applyAdjustments(renderFrame.root.children);
      if (!options.deferFinalRender) {
        const secondRenderStarted = performance.now();
        this.renderer.render({ container: this.stage });
        renderDurationMs += performance.now() - secondRenderStarted;
      }
    }
    this.#lastReconciliation = {
      mode: "full",
      reason: plan.dirty.includes("hierarchy") ? "hierarchy" : plan.reason,
      dirty: plan.dirty,
      reconciliationDurationMs: performance.now() - started,
      renderDurationMs,
      nodesRebuilt: this.#records.size,
      nodesUpdatedInPlace: 0,
      textureAllocations: this.#textureAllocationCount - allocationsBefore,
      activeGeneratedTextures: this.#generatedTextures.size,
      activeAssetTextures: this.#activeAssetUrls.size,
      cacheInvalidations: plan.reason === "initial" ? 0 : 1,
    };
    await releaseStaleAssets();
  }

  getLastReconciliationMetrics(): RendererReconciliationMetrics {
    return structuredClone(this.#lastReconciliation);
  }

  render(): void {
    if (!this.#initialized) return;
    this.renderer.render({ container: this.stage });
  }

  hitTestNode(point: RendererPoint): string | undefined {
    const entries = [...this.#records.entries()].reverse();
    return entries.find(([, record]) => {
      if (record.node.type === "adjustment" || !record.node.visible)
        return false;
      const bounds = record.wrapper.getBounds();
      return (
        point.x >= bounds.x &&
        point.x <= bounds.x + bounds.width &&
        point.y >= bounds.y &&
        point.y <= bounds.y + bounds.height
      );
    })?.[0];
  }

  getNodeState(nodeId: string): RendererNodeState | undefined {
    const record = this.#records.get(nodeId);
    if (!record || record.node.type === "adjustment") return undefined;
    return {
      id: nodeId,
      locked: record.node.locked,
      transform: structuredClone(record.node.transform),
    };
  }

  getNodeBounds(nodeId: string): RendererBounds | undefined {
    const bounds = this.#records.get(nodeId)?.wrapper.getBounds();
    if (!bounds) return undefined;
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  }

  canvasDeltaToParent(nodeId: string, delta: RendererPoint): RendererPoint {
    const parent = this.#records.get(nodeId)?.wrapper.parent;
    if (!parent) return delta;
    const inverse = parent.worldTransform.clone().invert();
    const origin = inverse.apply({ x: 0, y: 0 });
    const target = inverse.apply(delta);
    return { x: target.x - origin.x, y: target.y - origin.y };
  }

  getNodeIdsInBounds(bounds: RendererBounds): string[] {
    const matching = [...this.#records.entries()].filter(([, record]) => {
      if (record.node.type === "adjustment" || !record.node.visible)
        return false;
      const candidate = record.wrapper.getBounds();
      return (
        candidate.x < bounds.x + bounds.width &&
        candidate.x + candidate.width > bounds.x &&
        candidate.y < bounds.y + bounds.height &&
        candidate.y + candidate.height > bounds.y
      );
    });
    const wrappers = new Set(matching.map(([, record]) => record.wrapper));
    return matching
      .filter(([, record]) => {
        let ancestor = record.wrapper.parent;
        while (ancestor) {
          if (wrappers.has(ancestor)) return false;
          ancestor = ancestor.parent;
        }
        return true;
      })
      .map(([nodeId]) => nodeId);
  }

  previewTransform(nodeId: string, transform: Transform): void {
    this.previewTransforms([{ nodeId, transform }]);
  }

  previewTransforms(
    transforms: readonly { nodeId: string; transform: Transform }[],
  ): void {
    const started = performance.now();
    let updated = 0;
    for (const { nodeId, transform } of transforms) {
      const record = this.#records.get(nodeId);
      if (!record) continue;
      record.node.transform = structuredClone(transform);
      applyTransform(record.wrapper, transform);
      updated += 1;
    }
    if (!updated) return;
    const renderStarted = performance.now();
    this.render();
    this.#lastReconciliation = {
      mode: "incremental",
      dirty: ["transform"],
      reconciliationDurationMs: performance.now() - started,
      renderDurationMs: performance.now() - renderStarted,
      nodesRebuilt: 0,
      nodesUpdatedInPlace: updated,
      textureAllocations: 0,
      activeGeneratedTextures: this.#generatedTextures.size,
      activeAssetTextures: this.#activeAssetUrls.size,
      cacheInvalidations: 0,
    };
  }

  getCanvas(): HTMLCanvasElement {
    if (!this.#canvas) throw new Error("Renderer has not been initialized.");
    return this.#canvas;
  }

  async toPngBlob(resolution = 1): Promise<Blob> {
    if (!this.#frame) throw new Error("Renderer has no frame to export.");
    if (!Number.isFinite(resolution) || resolution < 0.25 || resolution > 4)
      throw new Error("Export resolution must be between 0.25× and 4×.");
    // Pixi extraction renders the target container into its own canvas. An
    // explicit render here would draw the entire scene twice for every export.
    const canvas = this.renderer.extract.canvas({
      target: this.stage,
      frame: new Rectangle(
        0,
        0,
        this.#frame.canvas.width,
        this.#frame.canvas.height,
      ),
      resolution,
    }) as HTMLCanvasElement;
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("PNG extraction failed.")),
        "image/png",
      );
    });
  }

  destroy(): void {
    if (!this.#initialized) return;
    this.renderer.resetState();
    for (const filter of this.#effectFilters) filter.destroy();
    this.stage.destroy({
      children: true,
      texture: true,
      textureSource: true,
    });
    this.renderer.destroy(true);
    this.#initialized = false;
    this.#artboard = undefined;
    this.#records.clear();
    this.#generatedTextures.clear();
    this.#textureOwners.clear();
    this.#effectFilters.clear();
    this.#effectFilterOwners.clear();
    void Assets.unload([...this.#activeAssetUrls]).catch(() => undefined);
    this.#activeAssetUrls.clear();
  }

  #assetUrlsForFrame(
    frame: FrameDocument,
    resources: RendererResources,
  ): Set<string> {
    const urls = new Set<string>();
    const visit = (node: SceneNode): void => {
      if (node.type === "rasterImage" || node.type === "svg")
        urls.add(resources.assetUrl(node.assetId));
      if (node.type === "mask") {
        visit(node.maskSource);
        node.children.forEach(visit);
      } else if (node.type === "group") node.children.forEach(visit);
    };
    frame.root.children.forEach(visit);
    return urls;
  }

  #canReconcileLeafRecords(
    plan: ReturnType<typeof planFrameReconciliation>,
    frame: FrameDocument,
  ): boolean {
    if (plan.mode !== "full" || plan.reason !== "node-content") return false;
    const hasEnabledAdjustment = (nodes: readonly SceneNode[]): boolean =>
      nodes.some((node) => {
        if (node.type === "adjustment") return node.enabled;
        if (node.type === "mask")
          return (
            hasEnabledAdjustment([node.maskSource]) ||
            hasEnabledAdjustment(node.children)
          );
        return node.type === "group" && hasEnabledAdjustment(node.children);
      });
    if (hasEnabledAdjustment(frame.root.children)) return false;
    return plan.changes.every((change) => {
      if (
        change.dirty.some((dirty) =>
          ["hierarchy", "composite-cache"].includes(dirty),
        )
      )
        return false;
      const node = findNode(frame, change.nodeId);
      if (
        !node ||
        node.type === "group" ||
        node.type === "mask" ||
        node.type === "adjustment"
      )
        return false;
      if (
        effectItems(node.effects).some(
          (effect) =>
            effect.enabled &&
            [
              "innerShadow",
              "innerGlow",
              "colorOverlay",
              "gradientOverlay",
            ].includes(effect.type),
        )
      )
        return false;
      let location = findNodeLocation(frame, node.id);
      while (location && location.parentId !== "root") {
        const parent = findNode(frame, location.parentId);
        if (!parent || parent.type === "mask") return false;
        if (parent.type === "group" && hasEnabledEffects(parent.effects))
          return false;
        location = findNodeLocation(frame, parent.id);
      }
      return true;
    });
  }

  #canReconcileHierarchy(
    previous: FrameDocument,
    next: FrameDocument,
  ): boolean {
    const parentIsSafe = (frame: FrameDocument, parentId: string): boolean => {
      if (parentId === "root") return true;
      const parent = findNode(frame, parentId);
      return Boolean(
        parent?.type === "group" &&
        parent.blendMode === "pass-through" &&
        parent.opacity === 1 &&
        !hasEnabledEffects(parent.effects),
      );
    };
    const nodeIds = [...this.#records.keys()];
    for (const nodeId of nodeIds) {
      const before = findNodeLocation(previous, nodeId);
      const after = findNodeLocation(next, nodeId);
      if (!before || !after) return false;
      if (
        before.parentId === after.parentId &&
        before.index === after.index &&
        before.locationKind === after.locationKind
      )
        continue;
      if (
        before.locationKind !== "child" ||
        after.locationKind !== "child" ||
        !parentIsSafe(previous, before.parentId) ||
        !parentIsSafe(next, after.parentId)
      )
        return false;
    }
    return true;
  }

  #canReconcileNodeSet(
    plan: ReturnType<typeof planFrameReconciliation>,
    previous: FrameDocument,
    next: FrameDocument,
  ): boolean {
    const added = plan.addedNodeIds ?? [];
    const removed = plan.removedNodeIds ?? [];
    if (
      plan.mode !== "full" ||
      plan.reason !== "hierarchy" ||
      added.length + removed.length === 0 ||
      plan.changes.length > 0
    )
      return false;
    const parentIsSafe = (frame: FrameDocument, parentId: string): boolean => {
      if (parentId === "root") return true;
      const parent = findNode(frame, parentId);
      return Boolean(
        parent?.type === "group" &&
        parent.blendMode === "pass-through" &&
        parent.opacity === 1 &&
        !hasEnabledEffects(parent.effects),
      );
    };
    const subtreeIsSafe = (node: SceneNode): boolean => {
      if (node.type === "mask" || node.type === "adjustment") return false;
      if (hasEnabledEffects(node.effects)) return false;
      return (
        node.type !== "group" ||
        (node.blendMode === "pass-through" &&
          node.opacity === 1 &&
          node.children.every(subtreeIsSafe))
      );
    };
    const subtreeIds = (node: SceneNode): string[] => [
      node.id,
      ...(node.type === "group"
        ? node.children.flatMap(subtreeIds)
        : node.type === "mask"
          ? [node.maskSource, ...node.children].flatMap(subtreeIds)
          : []),
    ];
    const safeChange = (
      frame: FrameDocument,
      nodeId: string,
      candidates: readonly string[],
    ): boolean => {
      const node = findNode(frame, nodeId);
      const location = findNodeLocation(frame, nodeId);
      return Boolean(
        node &&
        location?.locationKind === "child" &&
        parentIsSafe(frame, location.parentId) &&
        subtreeIsSafe(node) &&
        subtreeIds(node).every((id) => candidates.includes(id)),
      );
    };
    return (
      added.every((nodeId) => safeChange(next, nodeId, added)) &&
      removed.every((nodeId) => safeChange(previous, nodeId, removed))
    );
  }

  async #reconcileNodeSet(
    plan: ReturnType<typeof planFrameReconciliation>,
    previous: FrameDocument,
    next: FrameDocument,
  ): Promise<{ rebuilt: number; updated: number }> {
    const added = new Set(plan.addedNodeIds ?? []);
    const removed = new Set(plan.removedNodeIds ?? []);
    const topLevelIds = (
      frame: FrameDocument,
      candidates: ReadonlySet<string>,
    ): string[] =>
      [...candidates].filter((nodeId) => {
        const location = findNodeLocation(frame, nodeId);
        return !location || !candidates.has(location.parentId);
      });
    const subtreeIds = (node: SceneNode): string[] => [
      node.id,
      ...(node.type === "group"
        ? node.children.flatMap(subtreeIds)
        : node.type === "mask"
          ? [node.maskSource, ...node.children].flatMap(subtreeIds)
          : []),
    ];

    for (const nodeId of topLevelIds(previous, removed)) {
      const node = findNode(previous, nodeId);
      const record = this.#records.get(nodeId);
      if (!node || !record) continue;
      record.wrapper.parent?.removeChild(record.wrapper);
      record.wrapper.destroy({ children: true });
      for (const removedId of subtreeIds(node)) {
        this.#destroyEffectFilters(removedId);
        this.#destroyGeneratedTextures(removedId);
        this.#records.delete(removedId);
      }
    }

    let rebuilt = 0;
    for (const nodeId of topLevelIds(next, added)) {
      const node = findNode(next, nodeId);
      const location = findNodeLocation(next, nodeId);
      if (!node || !location) continue;
      const parent =
        location.parentId === "root"
          ? this.#artboard
          : this.#records.get(location.parentId)?.childrenContainer;
      if (!parent) continue;
      parent.addChild(await this.#buildNode(node));
      rebuilt += subtreeIds(node).length;
    }
    const updated = this.#reconcileHierarchy(next);
    return { rebuilt, updated };
  }

  #reconcileHierarchy(frame: FrameDocument): number {
    let moved = 0;
    const reconcile = (
      nodes: readonly SceneNode[],
      container: Container,
      offset = 0,
    ): void => {
      const visibleNodes = nodes.filter((node) => node.type !== "adjustment");
      visibleNodes.forEach((node, index) => {
        const record = this.#records.get(node.id);
        if (!record) return;
        record.node = node;
        const desiredIndex = offset + index;
        if (
          record.wrapper.parent !== container ||
          container.getChildIndex(record.wrapper) !== desiredIndex
        ) {
          container.addChildAt(record.wrapper, desiredIndex);
          moved += 1;
        }
        if (node.type === "group" || node.type === "mask")
          reconcile(node.children, record.childrenContainer);
      });
    };
    reconcile(
      frame.root.children,
      this.#artboard!,
      frame.canvas.background.type === "transparent" ? 0 : 1,
    );
    return moved;
  }

  async #replaceLeafRecord(node: SceneNode): Promise<number> {
    const previous = this.#records.get(node.id);
    const parent = previous?.wrapper.parent;
    if (!previous || !parent)
      throw new Error(`Renderer record ${node.id} cannot be reconciled.`);
    const index = parent.getChildIndex(previous.wrapper);
    parent.removeChild(previous.wrapper);
    previous.wrapper.destroy({ children: true });
    this.renderer.resetState();
    this.#destroyEffectFilters(node.id);
    this.#destroyGeneratedTextures(node.id);
    const replacement = await this.#buildNode(node);
    parent.addChildAt(replacement, index);
    this.#applyEffects([node]);
    return this.#invalidateAncestorCaches(this.#frame!, node.id);
  }

  #invalidateAncestorCaches(frame: FrameDocument, nodeId: string): number {
    let invalidated = 0;
    let location = findNodeLocation(frame, nodeId);
    while (location && location.parentId !== "root") {
      const parent = findNode(frame, location.parentId);
      if (!parent || parent.type !== "group") break;
      if (parent.blendMode !== "pass-through" || parent.opacity < 1) {
        this.#records.get(parent.id)?.content.updateCacheTexture();
        invalidated += 1;
      }
      location = findNodeLocation(frame, parent.id);
    }
    return invalidated;
  }

  #trackGeneratedTexture(texture: Texture, ownerId: string): Texture {
    this.#generatedTextures.add(texture);
    const owned = this.#textureOwners.get(ownerId) ?? new Set<Texture>();
    owned.add(texture);
    this.#textureOwners.set(ownerId, owned);
    this.#textureAllocationCount += 1;
    return texture;
  }

  #trackEffectFilter<TFilter extends Filter>(
    filter: TFilter,
    ownerId: string,
  ): TFilter {
    this.#effectFilters.add(filter);
    const owned = this.#effectFilterOwners.get(ownerId) ?? new Set<Filter>();
    owned.add(filter);
    this.#effectFilterOwners.set(ownerId, owned);
    return filter;
  }

  #destroyEffectFilters(ownerId: string): void {
    const filters = this.#effectFilterOwners.get(ownerId);
    if (!filters) return;
    for (const filter of filters) {
      this.#effectFilters.delete(filter);
      filter.destroy();
    }
    this.#effectFilterOwners.delete(ownerId);
  }

  #destroyGeneratedTextures(ownerId: string): void {
    const textures = this.#textureOwners.get(ownerId);
    if (!textures) return;
    for (const texture of textures) {
      this.#generatedTextures.delete(texture);
      texture.destroy(true);
    }
    this.#textureOwners.delete(ownerId);
  }

  #background(frame: FrameDocument): Container | undefined {
    if (frame.canvas.background.type === "transparent") return undefined;
    if (frame.canvas.background.type === "solid") {
      return new Graphics()
        .rect(0, 0, frame.canvas.width, frame.canvas.height)
        .fill({
          color: solidColorNumber(frame.canvas.background.color),
          alpha: frame.canvas.background.opacity,
        });
    }
    const texture = this.#textureForPaint(
      frame.canvas.background,
      frame.canvas.width,
      frame.canvas.height,
      [frame.id, "canvas"],
    );
    const sprite = new Sprite(texture);
    sprite.width = frame.canvas.width;
    sprite.height = frame.canvas.height;
    return sprite;
  }

  async #buildNode(node: SceneNode): Promise<Container> {
    const wrapper = new Container();
    wrapper.label = `${node.type}:${node.name}`;
    wrapper.visible = node.visible;
    applyTransform(wrapper, node.transform);
    const content = new Container();
    wrapper.addChild(content);
    const record = { node, wrapper, content, childrenContainer: content };
    this.#records.set(node.id, record);

    switch (node.type) {
      case "group":
        for (const child of node.children) {
          if (child.type !== "adjustment")
            content.addChild(await this.#buildNode(child));
        }
        break;
      case "rectangle": {
        const graphics = roundedRectanglePath(
          new Graphics(),
          node.transform.width,
          node.transform.height,
          node.cornerRadius,
        );
        graphics.fill(
          this.#paint(node.fill, node.transform.width, node.transform.height, [
            this.#frame!.id,
            node.id,
            "fill",
          ]),
        );
        this.#stroke(
          graphics,
          node.stroke,
          "rectangle",
          node.transform.width,
          node.transform.height,
          [this.#frame!.id, node.id, "stroke"],
        );
        content.addChild(graphics);
        break;
      }
      case "ellipse": {
        const graphics = new Graphics().ellipse(
          node.transform.width / 2,
          node.transform.height / 2,
          node.transform.width / 2,
          node.transform.height / 2,
        );
        graphics.fill(
          this.#paint(node.fill, node.transform.width, node.transform.height, [
            this.#frame!.id,
            node.id,
            "fill",
          ]),
        );
        this.#stroke(
          graphics,
          node.stroke,
          "ellipse",
          node.transform.width,
          node.transform.height,
          [this.#frame!.id, node.id, "stroke"],
        );
        content.addChild(graphics);
        break;
      }
      case "vectorPath": {
        const graphics = new Graphics();
        for (const command of node.commands) {
          switch (command.kind) {
            case "move":
              graphics.moveTo(
                command.to.x * node.transform.width,
                command.to.y * node.transform.height,
              );
              break;
            case "line":
              graphics.lineTo(
                command.to.x * node.transform.width,
                command.to.y * node.transform.height,
              );
              break;
            case "cubic":
              graphics.bezierCurveTo(
                command.control1.x * node.transform.width,
                command.control1.y * node.transform.height,
                command.control2.x * node.transform.width,
                command.control2.y * node.transform.height,
                command.to.x * node.transform.width,
                command.to.y * node.transform.height,
              );
              break;
            case "close":
              graphics.closePath();
              break;
            default:
              assertNever(command, "vector renderer command switch");
          }
        }
        if (node.fill)
          graphics.fill(
            this.#paint(
              node.fill,
              node.transform.width,
              node.transform.height,
              [this.#frame!.id, node.id, "fill"],
            ),
          );
        this.#vectorStroke(graphics, node);
        content.addChild(graphics);
        break;
      }
      case "rasterImage": {
        const source = await this.#loadAssetTexture(node.assetId);
        let texture = source;
        if (node.crop) {
          texture = new Texture({
            source: source.source,
            frame: new Rectangle(
              node.crop.x * source.width,
              node.crop.y * source.height,
              node.crop.width * source.width,
              node.crop.height * source.height,
            ),
          });
          this.#trackGeneratedTexture(texture, node.id);
        }
        const sprite = new Sprite(texture);
        this.#fitSprite(
          sprite,
          node.fit,
          node.transform.width,
          node.transform.height,
        );
        content.addChild(sprite);
        const clip = new Graphics()
          .rect(0, 0, node.transform.width, node.transform.height)
          .fill({ color: 0xffffff });
        content.addChild(clip);
        sprite.setMask({ mask: clip });
        break;
      }
      case "svg": {
        const texture = await this.#loadAssetTexture(node.assetId);
        const sprite = new Sprite(texture);
        sprite.width = node.transform.width;
        sprite.height = node.transform.height;
        content.addChild(sprite);
        break;
      }
      case "text": {
        if (node.spans?.length) {
          const rich = new Container();
          const layout = layoutRichTextNode(node, (fontId) =>
            this.#fontFamily(fontId),
          );
          for (const fragment of layout.fragments) {
            const text = new Text({
              text: fragment.text,
              style: new TextStyle(richTextStyleOptions(fragment.style)),
            });
            text.x = fragment.x;
            text.y = fragment.y;
            text.alpha = fragment.style.opacity;
            rich.addChild(text);
            if (fragment.style.decoration !== "none") {
              const decorationY =
                fragment.style.decoration === "underline"
                  ? fragment.y + fragment.height * 0.88
                  : fragment.y + fragment.height * 0.52;
              rich.addChild(
                new Graphics()
                  .moveTo(fragment.x, decorationY)
                  .lineTo(fragment.x + fragment.width, decorationY)
                  .stroke({
                    color: solidColorNumber(fragment.style.color),
                    alpha: fragment.style.opacity,
                    width: Math.max(1, fragment.style.fontSize / 16),
                  }),
              );
            }
          }
          if (node.typography.verticalAlignment === "middle")
            rich.y = (node.transform.height - layout.height) / 2;
          if (node.typography.verticalAlignment === "bottom")
            rich.y = node.transform.height - layout.height;
          content.addChild(rich);
          if (node.textBox.overflow === "clip") {
            const clip = new Graphics()
              .rect(0, 0, node.transform.width, node.transform.height)
              .fill({ color: 0xffffff });
            content.addChild(clip);
            rich.setMask({ mask: clip });
          }
          break;
        }
        const style = this.#textStyle(node);
        const text = new Text({ text: node.text, style });
        text.alpha = node.typography.opacity;
        const measuredHeight = text.height;
        if (node.typography.verticalAlignment === "middle")
          text.y = (node.transform.height - measuredHeight) / 2;
        if (node.typography.verticalAlignment === "bottom")
          text.y = node.transform.height - measuredHeight;
        content.addChild(text);
        if (node.textBox.overflow === "clip") {
          const clip = new Graphics()
            .rect(0, 0, node.transform.width, node.transform.height)
            .fill({ color: 0xffffff });
          content.addChild(clip);
          text.setMask({ mask: clip });
        }
        break;
      }
      case "mask": {
        const source = await this.#buildNode(node.maskSource);
        const masked = new Container();
        record.childrenContainer = masked;
        for (const child of node.children) {
          if (child.type !== "adjustment")
            masked.addChild(await this.#buildNode(child));
        }
        if (node.mode === "luminance")
          source.filters = [luminanceToAlphaFilter()];
        content.addChild(source, masked);
        masked.setMask({ mask: source, inverse: node.inverted });
        break;
      }
      case "adjustment":
        content.visible = false;
        break;
    }

    if (
      node.type === "group" &&
      (node.blendMode !== "pass-through" ||
        node.opacity < 1 ||
        hasEnabledEffects(node.effects))
    ) {
      content.cacheAsTexture({
        resolution: this.#renderResolution,
        antialias: true,
      });
    }

    if (node.type !== "mask" && node.type !== "adjustment") {
      if (node.blendMode === "dissolve") {
        wrapper.alpha = 1;
        content.filters = [
          dissolveFilter(
            node.opacity,
            deterministicSeed(this.#frame!.id, node.id),
          ),
        ];
        wrapper.blendMode = "normal";
      } else {
        wrapper.alpha = node.opacity;
        wrapper.blendMode = (
          node.blendMode === "pass-through" ? "normal" : node.blendMode
        ) as never;
      }
    }
    return wrapper;
  }

  async #loadAssetTexture(assetId: string): Promise<Texture> {
    const asset = this.#resources?.asset?.(assetId);
    if (!asset)
      throw new Error(`Renderer asset manifest is missing asset ${assetId}.`);
    const texture = await Assets.load<Texture>({
      src: this.#resources!.assetUrl(assetId),
      format: assetFormat(asset),
      parser: asset.type === "svg" ? "svg" : "texture",
    });
    if (!(texture instanceof Texture))
      throw new Error(`Renderer could not initialize texture ${assetId}.`);
    return texture;
  }

  #fontFamily(fontId: string): string {
    return this.#resources?.fontFamily?.(fontId) ?? projectFontFamily(fontId);
  }

  #textStyle(node: TextNode): TextStyle {
    const family = this.#fontFamily(node.typography.fontId);
    return new TextStyle({
      fontFamily: family,
      fontSize: node.typography.fontSize,
      fontWeight: String(node.typography.fontWeight) as "normal",
      fontStyle: node.typography.fontStyle,
      lineHeight: node.typography.lineHeight,
      letterSpacing: node.typography.letterSpacing,
      align: node.typography.alignment,
      fill: node.typography.color,
      wordWrap: node.textBox.wrapping !== "none",
      breakWords: node.textBox.wrapping === "character",
      wordWrapWidth: node.textBox.width,
      whiteSpace: "pre-line",
    });
  }

  #fitSprite(
    sprite: Sprite,
    fit: "fill" | "contain" | "cover" | "none",
    width: number,
    height: number,
  ): void {
    if (fit === "fill") {
      sprite.width = width;
      sprite.height = height;
      return;
    }
    if (fit === "none") return;
    const scale =
      fit === "contain"
        ? Math.min(width / sprite.texture.width, height / sprite.texture.height)
        : Math.max(
            width / sprite.texture.width,
            height / sprite.texture.height,
          );
    sprite.scale.set(scale);
    sprite.x = (width - sprite.texture.width * scale) / 2;
    sprite.y = (height - sprite.texture.height * scale) / 2;
  }

  #textureForPaint(
    fill: Exclude<ShapeFill, { type: "solid" }>,
    width: number,
    height: number,
    seed: string[],
  ): Texture {
    const texture = Texture.from(
      gradientCanvas(fill, width, height, seed),
      true,
    );
    return this.#trackGeneratedTexture(texture, seed[1] ?? "canvas");
  }

  #paint(
    fill: ShapeFill,
    width: number,
    height: number,
    seed: string[],
  ): FillInput {
    if (fill.type === "solid")
      return { color: solidColorNumber(fill.color), alpha: fill.opacity };
    return { texture: this.#textureForPaint(fill, width, height, seed) };
  }

  #stroke(
    graphics: Graphics,
    stroke: Stroke | undefined,
    shape: "rectangle" | "ellipse",
    width: number,
    height: number,
    seed: string[],
  ): void {
    const style = this.#strokeStyle(stroke, width, height, seed);
    if (!style) return;
    if (!stroke?.dash) {
      graphics.stroke(style);
      return;
    }
    const dashed = new Graphics();
    const points =
      shape === "rectangle"
        ? rectanglePoints(width, height)
        : ellipsePoints(width, height);
    dashedPolyline(
      dashed,
      points,
      stroke.dash.values,
      stroke.dash.offset,
      shape === "ellipse",
    );
    dashed.stroke(style);
    graphics.addChild(dashed);
  }

  #strokeStyle(
    stroke: Stroke | undefined,
    width: number,
    height: number,
    seed: string[],
  ): StrokeStyle | undefined {
    if (!stroke?.enabled || stroke.width <= 0) return undefined;
    const paint =
      stroke.paint.type === "solid"
        ? {
            color: solidColorNumber(stroke.paint.color),
            alpha: stroke.opacity * stroke.paint.opacity,
          }
        : {
            texture: this.#textureForPaint(stroke.paint, width, height, seed),
            alpha: stroke.opacity,
          };
    const alignment =
      stroke.alignment === "inside"
        ? 1
        : stroke.alignment === "center"
          ? 0.5
          : 0;
    return {
      ...paint,
      width: stroke.width,
      alignment,
      cap: stroke.dash?.cap ?? "butt",
      join: "miter",
      miterLimit: 4,
    };
  }

  #vectorStroke(
    graphics: Graphics,
    node: Extract<SceneNode, { type: "vectorPath" }>,
  ): void {
    const style = this.#strokeStyle(
      node.stroke,
      node.transform.width,
      node.transform.height,
      [this.#frame!.id, node.id, "stroke"],
    );
    if (!style) return;
    if (!node.stroke?.dash) {
      graphics.stroke(style);
      return;
    }
    const dashed = new Graphics();
    for (const subpath of vectorPathSubpaths(
      node.commands,
      node.transform.width,
      node.transform.height,
    ))
      dashedPolyline(
        dashed,
        subpath.points,
        node.stroke.dash.values,
        node.stroke.dash.offset,
        subpath.closed,
      );
    dashed.stroke(style);
    graphics.addChild(dashed);
  }

  #applyEffects(nodes: readonly SceneNode[]): void {
    const visit = (node: SceneNode): void => {
      const effects: Effects | undefined =
        "effects" in node ? node.effects : undefined;
      const record = this.#records.get(node.id);
      if (record && node.type !== "adjustment") {
        const enabledEffects = effectItems(effects).filter(
          (effect) => effect.enabled,
        );
        const width = Math.max(1, node.transform.width);
        const height = Math.max(1, node.transform.height);
        const sourceTexture = enabledEffects.some(
          (effect) => effect.type !== "blur",
        )
          ? this.#trackGeneratedTexture(
              this.renderer.generateTexture({
                target: record.content,
                frame: new Rectangle(0, 0, width, height),
                resolution: this.#renderResolution,
                antialias: true,
              }),
              node.id,
            )
          : undefined;
        let outerEffectIndex = 0;
        for (const effect of enabledEffects) {
          const width = Math.max(1, node.transform.width);
          const height = Math.max(1, node.transform.height);
          const textureForContent = () => sourceTexture!;
          const blur = (strength: number) =>
            new BlurFilter({ strength, quality: 4, kernelSize: 7 });
          switch (effect.type) {
            case "outerShadow":
            case "outerGlow": {
              const sprite = new Sprite(textureForContent());
              const shadow =
                effect.type === "outerShadow"
                  ? effect
                  : { ...effect, offsetX: 0, offsetY: 0 };
              sprite.x = shadow.offsetX - effect.spread;
              sprite.y = shadow.offsetY - effect.spread;
              sprite.width = Math.max(1, width + effect.spread * 2);
              sprite.height = Math.max(1, height + effect.spread * 2);
              sprite.tint = solidColorNumber(effect.color);
              sprite.alpha = effect.opacity;
              if (effect.blur > 0) sprite.filters = [blur(effect.blur)];
              record.wrapper.addChildAt(sprite, outerEffectIndex);
              outerEffectIndex += 1;
              break;
            }
            case "innerShadow":
            case "innerGlow": {
              const texture = textureForContent();
              const sprite = new Sprite(texture);
              const shadow =
                effect.type === "innerShadow"
                  ? effect
                  : { ...effect, offsetX: 0, offsetY: 0 };
              sprite.x = shadow.offsetX - effect.spread;
              sprite.y = shadow.offsetY - effect.spread;
              sprite.width = Math.max(1, width + effect.spread * 2);
              sprite.height = Math.max(1, height + effect.spread * 2);
              sprite.tint = solidColorNumber(effect.color);
              sprite.alpha = effect.opacity;
              if (effect.blur > 0) sprite.filters = [blur(effect.blur)];
              const mask = new Sprite(texture);
              mask.renderable = false;
              record.content.addChild(sprite, mask);
              sprite.filters = [
                ...(sprite.filters ?? []),
                this.#trackEffectFilter(
                  new MaskFilter({ sprite: mask, channel: "alpha" }),
                  node.id,
                ),
              ];
              break;
            }
            case "blur":
              if (effect.radius > 0)
                record.content.filters = [
                  ...(record.content.filters ?? []),
                  blur(effect.radius),
                ];
              break;
            case "colorOverlay":
            case "gradientOverlay": {
              const mask = new Sprite(textureForContent());
              const overlay = new Graphics()
                .rect(0, 0, width, height)
                .fill(
                  this.#paint(effect.paint, width, height, [
                    this.#frame!.id,
                    node.id,
                    effect.id,
                  ]),
                );
              overlay.alpha = effect.opacity;
              mask.renderable = false;
              record.content.addChild(overlay, mask);
              overlay.filters = [
                this.#trackEffectFilter(
                  new MaskFilter({ sprite: mask, channel: "alpha" }),
                  node.id,
                ),
              ];
              break;
            }
            default:
              assertNever(effect, "effect renderer switch");
          }
        }
      }
      if (node.type === "mask") {
        visit(node.maskSource);
        node.children.forEach(visit);
      } else if (node.type === "group") node.children.forEach(visit);
    };
    nodes.forEach(visit);
  }

  #applyAdjustments(nodes: readonly SceneNode[]): void {
    const adjustments = nodes.filter(
      (node): node is AdjustmentNode => node.type === "adjustment",
    );
    for (const adjustment of adjustments) {
      if (!adjustment.enabled) continue;
      const target =
        adjustment.targetId === "root"
          ? this.#artboard
          : this.#records.get(adjustment.targetId)?.content;
      if (!target) continue;
      const filters = [...(target.filters ?? [])];
      const values = adjustment.values;
      if (
        values.brightness ||
        values.contrast ||
        values.saturation ||
        values.hue
      ) {
        const matrix = new ColorMatrixFilter();
        matrix.brightness(1 + values.brightness / 100, false);
        matrix.contrast(values.contrast / 100, true);
        matrix.saturate(values.saturation / 100, true);
        matrix.hue(values.hue, true);
        filters.push(matrix);
      }
      if (values.blur > 0)
        filters.push(
          new BlurFilter({ strength: values.blur, quality: 4, kernelSize: 7 }),
        );
      target.filters = filters;
    }
  }
}

export const measureTextNode = (
  node: TextNode,
  fontFamily = projectFontFamily(node.typography.fontId),
) => {
  if (node.spans?.length) {
    const layout = layoutRichTextNode(node, (fontId) =>
      fontId === node.typography.fontId
        ? fontFamily
        : projectFontFamily(fontId),
    );
    return {
      width: layout.width,
      height: layout.height,
      lines: layout.lines,
    };
  }
  const style = new TextStyle({
    fontFamily,
    fontSize: node.typography.fontSize,
    fontWeight: String(node.typography.fontWeight) as "normal",
    fontStyle: node.typography.fontStyle,
    lineHeight: node.typography.lineHeight,
    letterSpacing: node.typography.letterSpacing,
    align: node.typography.alignment,
    fill: node.typography.color,
    wordWrap: node.textBox.wrapping !== "none",
    breakWords: node.textBox.wrapping === "character",
    wordWrapWidth: node.textBox.width,
  });
  const metrics = CanvasTextMetrics.measureText(node.text, style);
  return {
    width: metrics.width,
    height: metrics.height,
    lines: metrics.lines.length,
  };
};

export const rendererCapabilities = (renderer: DesignRenderer) => {
  const gl = renderer.renderer.gl;
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxRenderbufferSize = gl.getParameter(
    gl.MAX_RENDERBUFFER_SIZE,
  ) as number;
  return {
    maxTextureSize,
    maxRenderbufferSize,
    maxCanvasDimension: Math.min(maxTextureSize, maxRenderbufferSize),
  };
};
