import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compileDesignPlan,
  createDesignBrief,
  createDesignPlan,
  createFrameDocument,
  createTransform,
  findNode,
  simulateFrameOperations,
  type BrandKitRecord,
  type DesignPlan,
  type RasterImageNode,
  type RectangleNode,
  type TextNode,
} from "../src/index.js";

const now = "2026-08-10T20:00:00.000Z";
const fontId = randomUUID();
const kitFontId = randomUUID();
const nextFontId = randomUUID();
const assetId = randomUUID();
const nextAssetId = randomUUID();

const fixture = () => {
  const frame = createFrameDocument({
    id: randomUUID(),
    slug: "intent-frame",
    name: "Intent frame",
    width: 1_000,
    height: 800,
    now,
  });
  const text: TextNode = {
    id: randomUUID(),
    type: "text",
    name: "Headline",
    visible: true,
    locked: false,
    transform: createTransform({ x: 10, y: 20, width: 300, height: 80 }),
    opacity: 1,
    blendMode: "normal",
    text: "Old headline",
    typography: {
      fontId,
      fontSize: 24,
      fontWeight: 400,
      fontStyle: "normal",
      lineHeight: 1.2,
      letterSpacing: 0,
      alignment: "left",
      verticalAlignment: "top",
      color: "#111111",
      opacity: 1,
    },
    textBox: {
      mode: "fixed",
      width: 300,
      height: 80,
      wrapping: "word",
      overflow: "clip",
    },
  };
  const image: RasterImageNode = {
    id: randomUUID(),
    type: "rasterImage",
    name: "Hero",
    visible: true,
    locked: false,
    transform: createTransform({ x: 400, y: 100, width: 400, height: 400 }),
    opacity: 1,
    blendMode: "normal",
    assetId,
    fit: "contain",
    crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  };
  const panel: RectangleNode = {
    id: randomUUID(),
    type: "rectangle",
    name: "Panel",
    visible: true,
    locked: false,
    transform: createTransform({ x: 0, y: 0, width: 1_000, height: 800 }),
    opacity: 1,
    blendMode: "normal",
    fill: { type: "solid", color: "#FFFFFF", opacity: 1 },
    cornerRadius: {
      topLeft: 0,
      topRight: 0,
      bottomRight: 0,
      bottomLeft: 0,
    },
  };
  const unrelated: RectangleNode = {
    ...structuredClone(panel),
    id: randomUUID(),
    name: "Unrelated",
    transform: createTransform({ x: 20, y: 700, width: 40, height: 40 }),
  };
  frame.root.children.push(panel, image, text, unrelated);

  const copyId = randomUUID();
  const brief = createDesignBrief({
    id: randomUUID(),
    now,
    name: "Intent brief",
    objective: "Compile only explicit campaign intent.",
    audience: { primary: "Design leaders", secondary: [] },
    format: { width: 1_000, height: 800, unit: "px", channel: "socialPost" },
    requiredCopy: [{ id: copyId, role: "headline", text: "Approved headline" }],
    optionalCopy: [],
    brandContext: {
      description: "Use the pinned kit.",
      requiredTokenKeys: ["accent", "display"],
      prohibitedUses: [],
    },
    assetRequirements: [],
    hierarchyRequirements: [],
    mood: { keywords: ["precise"], avoid: [] },
    constraints: [],
    accessibilityRequirements: {
      minimumContrastRatio: 4.5,
      requirements: [],
      readingOrder: ["headline", "heroSubject"],
    },
    exportRequirements: [
      {
        id: randomUUID(),
        name: "Campaign PNG",
        format: "png",
        scale: 1,
        transparentBackground: "allowed",
      },
    ],
  });

  const headlineRoleId = randomUUID();
  const heroRoleId = randomUUID();
  const backgroundRoleId = randomUUID();
  const plan = createDesignPlan({
    id: randomUUID(),
    now,
    name: "Intent plan",
    briefId: brief.id,
    targetFrameId: frame.id,
    objectiveSummary: "Apply approved copy, layout, asset, and brand intent.",
    semanticRoles: [
      {
        id: headlineRoleId,
        key: "headline",
        name: "Headline",
        role: "headline",
        required: true,
        nodeId: text.id,
        copyItemId: copyId,
      },
      {
        id: heroRoleId,
        key: "hero",
        name: "Hero",
        role: "heroSubject",
        required: true,
        nodeId: image.id,
      },
      {
        id: backgroundRoleId,
        key: "background",
        name: "Background",
        role: "background",
        required: true,
        nodeId: panel.id,
      },
    ],
    contentHierarchy: [
      { id: randomUUID(), roleId: backgroundRoleId, priority: 1 },
      { id: randomUUID(), roleId: heroRoleId, priority: 2 },
      { id: randomUUID(), roleId: headlineRoleId, priority: 3 },
    ],
    layoutRegions: [
      {
        id: randomUUID(),
        key: "headline-region",
        name: "Headline region",
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.25,
      },
    ],
    anchors: [],
    constraints: [],
    safeAreas: [
      {
        id: randomUUID(),
        name: "Campaign safe area",
        top: 0.05,
        right: 0.05,
        bottom: 0.05,
        left: 0.05,
      },
    ],
    brandBindings: [
      {
        id: randomUUID(),
        roleId: headlineRoleId,
        property: "typography",
        tokenKey: "display",
      },
      {
        id: randomUUID(),
        roleId: backgroundRoleId,
        property: "fill",
        tokenKey: "accent",
      },
    ],
    assetAssignments: [
      {
        id: randomUUID(),
        roleId: heroRoleId,
        assetId: nextAssetId,
        fit: "cover",
        preserveCrop: false,
      },
    ],
    effectIntentions: [],
    variantRules: [],
    protectedDecisions: [],
    approval: {
      state: "approved",
      notes: ["Approved for deterministic preview."],
      decidedBy: "human-reviewer",
      decidedAt: now,
    },
  });
  plan.anchors.push({
    id: randomUUID(),
    roleId: headlineRoleId,
    regionId: plan.layoutRegions[0]!.id,
    horizontal: "center",
    vertical: "center",
    offsetX: 0.01,
    offsetY: -0.00625,
  });
  const variantRuleId = randomUUID();
  plan.variantRules.push({
    id: variantRuleId,
    name: "No hero",
    description: "Hide the hero for the compact variant.",
    roleBehaviors: [{ roleId: heroRoleId, behavior: "hide" }],
  });

  const kit: BrandKitRecord = {
    schemaVersion: 1,
    id: randomUUID(),
    revision: 1,
    contentHash: `sha256:${"a".repeat(64)}`,
    name: "Intent kit",
    createdAt: now,
    createdBy: "test",
    sourceProjectId: randomUUID(),
    provenance: "Test fixture",
    licenseNotes: "Test fixture",
    palette: [{ key: "accent", name: "Accent", color: "#315CF5" }],
    typeRoles: [
      {
        key: "display",
        name: "Display",
        font: {
          id: kitFontId,
          family: "Display Sans",
          style: "normal",
          weight: 700,
          format: "woff2",
          source: "project",
          path: "fonts/display.woff2",
          hash: `sha256:${"b".repeat(64)}`,
          licenseNotes: "Test fixture",
        },
        fontSize: 48,
        lineHeight: 1.1,
        letterSpacing: -0.5,
        colorToken: "accent",
      },
    ],
    logos: [],
    definitions: [],
  };
  return {
    frame,
    text,
    image,
    panel,
    unrelated,
    brief,
    plan,
    kit,
    headlineRoleId,
    heroRoleId,
    backgroundRoleId,
    variantRuleId,
  };
};

describe("DesignPlan intent compiler", () => {
  it("emits ordinary operations for explicit intent and preserves unrelated IDs", () => {
    const value = fixture();
    const compilation = compileDesignPlan({
      plan: value.plan,
      frame: value.frame,
      brief: value.brief,
      brandKit: value.kit,
      brandResourceMap: { [kitFontId]: nextFontId },
      variantRuleId: value.variantRuleId,
    });
    expect(compilation.warnings).toEqual([]);
    expect(compilation.operations.map((operation) => operation.kind)).toEqual([
      "setCanvas",
      "updateNode",
      "updateNode",
      "updateNode",
      "replaceAsset",
      "updateNode",
      "updateNode",
      "updateNode",
    ]);
    expect(compilation.changes.map((change) => change.intent)).toEqual([
      "safeArea",
      "copy",
      "layout",
      "brand",
      "asset",
      "crop",
      "variant",
      "brand",
    ]);
    const simulation = simulateFrameOperations(
      value.frame,
      compilation.operations,
    );
    const nextText = findNode(simulation.frame, value.text.id);
    const nextImage = findNode(simulation.frame, value.image.id);
    const nextPanel = findNode(simulation.frame, value.panel.id);
    expect(nextText).toMatchObject({
      id: value.text.id,
      text: "Approved headline",
      transform: { x: 360, y: 135 },
      typography: {
        fontId: nextFontId,
        fontSize: 48,
        lineHeight: 1.1,
        letterSpacing: -0.5,
        color: "#315CF5",
      },
    });
    expect(nextImage).toMatchObject({
      id: value.image.id,
      assetId: nextAssetId,
      fit: "cover",
      visible: false,
    });
    expect(nextImage).not.toHaveProperty("crop");
    expect(nextPanel).toMatchObject({
      id: value.panel.id,
      fill: { type: "solid", color: "#315CF5", opacity: 1 },
    });
    expect(simulation.frame.canvas.safeArea).toEqual({
      top: 40,
      right: 50,
      bottom: 40,
      left: 50,
    });
    expect(findNode(simulation.frame, value.unrelated.id)).toEqual(
      findNode(value.frame, value.unrelated.id),
    );
  });

  it("compiles only selected roles for small revisions", () => {
    const value = fixture();
    const compilation = compileDesignPlan({
      plan: value.plan,
      frame: value.frame,
      brief: value.brief,
      roleIds: [value.headlineRoleId],
    });
    expect(
      compilation.operations.every(
        (operation) => operation.kind === "updateNode",
      ),
    ).toBe(true);
    expect(
      compilation.operations.every(
        (operation) =>
          operation.kind !== "updateNode" || operation.nodeId === value.text.id,
      ),
    ).toBe(true);
    expect(compilation.operations).not.toContainEqual(
      expect.objectContaining({ kind: "setCanvas" }),
    );
    expect(compilation.warnings).toEqual([
      expect.objectContaining({ code: "BRAND_KIT_UNAVAILABLE" }),
    ]);
  });

  it("honors protected human decisions instead of guessing through them", () => {
    const value = fixture();
    const copyDecision = randomUUID();
    const positionDecision = randomUUID();
    const cropDecision = randomUUID();
    const brandDecision = randomUUID();
    value.plan.protectedDecisions = [
      {
        id: copyDecision,
        kind: "copy",
        roleId: value.headlineRoleId,
        description: "Keep human copy.",
      },
      {
        id: positionDecision,
        kind: "position",
        roleId: value.headlineRoleId,
        description: "Keep human position.",
      },
      {
        id: cropDecision,
        kind: "crop",
        roleId: value.heroRoleId,
        description: "Keep human crop.",
      },
      {
        id: brandDecision,
        kind: "brandBinding",
        roleId: value.backgroundRoleId,
        description: "Keep human fill.",
      },
    ];
    const compilation = compileDesignPlan({
      plan: value.plan,
      frame: value.frame,
      brief: value.brief,
      brandKit: value.kit,
      brandResourceMap: { [kitFontId]: nextFontId },
    });
    expect(compilation.protectedDecisionIds.sort()).toEqual(
      [copyDecision, positionDecision, cropDecision, brandDecision].sort(),
    );
    expect(
      compilation.warnings.filter(
        (warning) => warning.code === "PROTECTED_DECISION",
      ),
    ).toHaveLength(4);
    expect(compilation.operations).not.toContainEqual(
      expect.objectContaining({
        kind: "updateNode",
        nodeId: value.text.id,
        propertyGroup: "textContent",
      }),
    );
    expect(compilation.operations).not.toContainEqual(
      expect.objectContaining({
        kind: "updateNode",
        nodeId: value.text.id,
        propertyGroup: "transform",
      }),
    );
    expect(compilation.operations).toContainEqual(
      expect.objectContaining({ kind: "replaceAsset", nodeId: value.image.id }),
    );
    expect(compilation.operations).not.toContainEqual(
      expect.objectContaining({
        kind: "updateNode",
        nodeId: value.image.id,
        propertyGroup: "crop",
      }),
    );
  });

  it("preserves the canvas safe area under a global position decision", () => {
    const value = fixture();
    const decisionId = randomUUID();
    value.plan.protectedDecisions = [
      {
        id: decisionId,
        kind: "position",
        description: "Keep the approved global layout safety.",
      },
    ];
    const compilation = compileDesignPlan({
      plan: value.plan,
      frame: value.frame,
      brief: value.brief,
    });
    expect(compilation.protectedDecisionIds).toContain(decisionId);
    expect(compilation.operations).not.toContainEqual(
      expect.objectContaining({ kind: "setCanvas" }),
    );
    expect(compilation.warnings).toContainEqual(
      expect.objectContaining({
        code: "PROTECTED_DECISION",
        protectedDecisionIds: [decisionId],
      }),
    );
  });

  it("returns warnings instead of operations for stale, locked, and unapproved intent", () => {
    const value = fixture();
    value.plan.approval = { state: "proposed", notes: [] };
    value.plan.semanticRoles[0]!.nodeId = randomUUID();
    value.image.locked = true;
    value.plan.semanticRoles.push({
      id: randomUUID(),
      key: "cta",
      name: "CTA",
      role: "cta",
      required: true,
    });
    value.plan.effectIntentions.push({
      id: randomUUID(),
      roleId: value.backgroundRoleId,
      effectType: "outerShadow",
      enabled: true,
      description: "Use a subtle campaign shadow.",
    });
    const compilation = compileDesignPlan({
      plan: value.plan,
      frame: value.frame,
      brief: value.brief,
    });
    expect(compilation.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "PLAN_NOT_APPROVED",
        "NODE_NOT_FOUND",
        "NODE_LOCKED",
        "ROLE_UNBOUND",
        "BRAND_KIT_UNAVAILABLE",
        "UNSUPPORTED_INTENT",
      ]),
    );
    expect(
      compilation.operations.some(
        (operation) =>
          "nodeId" in operation && operation.nodeId === value.image.id,
      ),
    ).toBe(false);
  });

  it("does not compile against the wrong or unspecified target frame", () => {
    const value = fixture();
    expect(
      compileDesignPlan({
        plan: { ...value.plan, targetFrameId: undefined } as DesignPlan,
        frame: value.frame,
      }),
    ).toMatchObject({
      operations: [],
      warnings: [expect.objectContaining({ code: "TARGET_FRAME_REQUIRED" })],
    });
    expect(
      compileDesignPlan({
        plan: { ...value.plan, targetFrameId: randomUUID() },
        frame: value.frame,
      }),
    ).toMatchObject({
      operations: [],
      warnings: [expect.objectContaining({ code: "TARGET_FRAME_MISMATCH" })],
    });
  });
});
