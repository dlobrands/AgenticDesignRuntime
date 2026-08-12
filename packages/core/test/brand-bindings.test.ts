import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compileBrandBindings,
  compileDesignPlan,
  createDesignPlan,
  createFrameDocument,
  createTransform,
  simulateFrameOperations,
  type BrandKitRecord,
  type RectangleNode,
  type TextNode,
} from "../src/index.js";

const now = "2026-08-10T23:20:00.000Z";

const fixture = () => {
  const frame = createFrameDocument({
    id: randomUUID(),
    slug: "brand-bindings",
    name: "Brand bindings",
    width: 1_080,
    height: 1_350,
    now,
  });
  const currentFontId = randomUUID();
  const kitFontId = randomUUID();
  const pinnedFontId = randomUUID();
  const headline: TextNode = {
    id: randomUUID(),
    type: "text",
    name: "Headline",
    visible: true,
    locked: false,
    transform: createTransform({ x: 80, y: 100, width: 800, height: 160 }),
    opacity: 1,
    blendMode: "normal",
    text: "Campaign headline",
    typography: {
      fontId: currentFontId,
      fontSize: 32,
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
      width: 800,
      height: 160,
      wrapping: "word",
      overflow: "clip",
    },
  };
  const panel: RectangleNode = {
    id: randomUUID(),
    type: "rectangle",
    name: "Panel",
    visible: true,
    locked: false,
    transform: createTransform({ width: 1_080, height: 1_350 }),
    opacity: 1,
    blendMode: "normal",
    fill: { type: "solid", color: "#FFFFFF", opacity: 1 },
    stroke: {
      enabled: true,
      width: 4,
      alignment: "inside",
      opacity: 0.5,
      paint: { type: "solid", color: "#000000", opacity: 0.5 },
    },
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
    transform: createTransform({ x: 20, y: 30, width: 40, height: 50 }),
  };
  frame.root.children.push(panel, headline, unrelated);
  const headlineRoleId = randomUUID();
  const panelRoleId = randomUUID();
  const plan = createDesignPlan({
    id: randomUUID(),
    now,
    name: "Brand binding plan",
    targetFrameId: frame.id,
    objectiveSummary: "Apply only exact pinned Brand intent.",
    semanticRoles: [
      {
        id: headlineRoleId,
        key: "headline",
        name: "Headline",
        role: "headline",
        required: true,
        nodeId: headline.id,
      },
      {
        id: panelRoleId,
        key: "background",
        name: "Background",
        role: "background",
        required: true,
        nodeId: panel.id,
      },
    ],
    contentHierarchy: [],
    layoutRegions: [],
    anchors: [],
    constraints: [],
    safeAreas: [],
    brandBindings: [
      {
        id: randomUUID(),
        roleId: headlineRoleId,
        property: "typography",
        tokenKey: "display",
      },
      {
        id: randomUUID(),
        roleId: panelRoleId,
        property: "fill",
        tokenKey: "accent",
      },
      {
        id: randomUUID(),
        roleId: panelRoleId,
        property: "stroke",
        tokenKey: "accent",
      },
    ],
    assetAssignments: [],
    effectIntentions: [],
    variantRules: [],
    protectedDecisions: [],
    approval: {
      state: "approved",
      notes: ["Approved Brand intent."],
      decidedBy: "human",
      decidedAt: now,
    },
  });
  const kit: BrandKitRecord = {
    schemaVersion: 1,
    id: randomUUID(),
    revision: 3,
    contentHash: `sha256:${"a".repeat(64)}`,
    name: "Campaign system",
    createdAt: now,
    createdBy: "test",
    sourceProjectId: randomUUID(),
    provenance: "Verified test fixture.",
    licenseNotes: "Internal test fixture.",
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
          licenseNotes: "Internal test fixture.",
        },
        fontSize: 56,
        lineHeight: 1.05,
        letterSpacing: -0.75,
        colorToken: "accent",
      },
    ],
    logos: [],
    definitions: [],
  };
  return {
    frame,
    plan,
    kit,
    headline,
    panel,
    unrelated,
    headlineRoleId,
    panelRoleId,
    kitFontId,
    pinnedFontId,
  };
};

describe("DesignPlan Brand-binding compiler", () => {
  it("matches general Brand intent and preserves exact unrelated state and inverses", () => {
    const value = fixture();
    const input = {
      plan: value.plan,
      frame: value.frame,
      brandKit: value.kit,
      brandResourceMap: { [value.kitFontId]: value.pinnedFontId },
    };
    const compilation = compileBrandBindings(input);
    const general = compileDesignPlan(input);
    const generalBrandOperations = general.changes
      .filter((change) => change.intent === "brand")
      .map((change) => general.operations[change.operationIndex]);

    expect(compilation.operations).toEqual(generalBrandOperations);
    expect(
      compilation.changes.every((change) => change.intent === "brand"),
    ).toBe(true);
    const next = simulateFrameOperations(value.frame, compilation.operations);
    expect(
      next.frame.root.children.find((node) => node.id === value.headline.id),
    ).toMatchObject({
      id: value.headline.id,
      typography: {
        fontId: value.pinnedFontId,
        fontSize: 56,
        lineHeight: 1.05,
        letterSpacing: -0.75,
        color: "#315CF5",
      },
    });
    expect(
      next.frame.root.children.find((node) => node.id === value.panel.id),
    ).toMatchObject({
      id: value.panel.id,
      fill: { type: "solid", color: "#315CF5", opacity: 1 },
      stroke: {
        width: 4,
        paint: { type: "solid", color: "#315CF5", opacity: 1 },
      },
    });
    expect(
      next.frame.root.children.find((node) => node.id === value.unrelated.id),
    ).toEqual(value.unrelated);
    expect(
      simulateFrameOperations(next.frame, next.inverseOperations).frame.root
        .children,
    ).toEqual(value.frame.root.children);
  });

  it("supports selected roles and reports missing mappings or unsupported token classes", () => {
    const value = fixture();
    const selected = compileBrandBindings({
      plan: value.plan,
      frame: value.frame,
      brandKit: value.kit,
      brandResourceMap: { [value.kitFontId]: value.pinnedFontId },
      roleIds: [value.panelRoleId],
    });
    expect(selected.selectedRoleIds).toEqual([value.panelRoleId]);
    expect(
      selected.operations.every(
        (operation) =>
          operation.kind === "updateNode" &&
          operation.nodeId === value.panel.id,
      ),
    ).toBe(true);

    value.plan.brandBindings.push({
      id: randomUUID(),
      roleId: value.panelRoleId,
      property: "spacing",
      tokenKey: "campaign-gap",
    });
    const warnings = compileBrandBindings({
      plan: value.plan,
      frame: value.frame,
      brandKit: value.kit,
      roleIds: [value.headlineRoleId, value.panelRoleId],
    }).warnings;
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "BRAND_TOKEN_UNAVAILABLE" }),
        expect.objectContaining({ code: "UNSUPPORTED_INTENT" }),
      ]),
    );
  });

  it("requires the exact pinned kit and enforces Brand/node/role protections", () => {
    const unavailable = fixture();
    expect(
      compileBrandBindings({
        plan: unavailable.plan,
        frame: unavailable.frame,
      }).warnings,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "BRAND_KIT_UNAVAILABLE" }),
      ]),
    );

    const value = fixture();
    const protectionId = randomUUID();
    value.plan.protectedDecisions.push({
      id: protectionId,
      kind: "brandBinding",
      roleId: value.headlineRoleId,
      nodeId: value.headline.id,
      description: "Preserve approved headline styling.",
    });
    const compilation = compileBrandBindings({
      plan: value.plan,
      frame: value.frame,
      brandKit: value.kit,
      brandResourceMap: { [value.kitFontId]: value.pinnedFontId },
      roleIds: [value.headlineRoleId],
    });
    expect(compilation.operations).toEqual([]);
    expect(compilation.protectedDecisionIds).toEqual([protectionId]);
    expect(compilation.warnings).toEqual([
      expect.objectContaining({ code: "PROTECTED_DECISION" }),
    ]);
  });
});
