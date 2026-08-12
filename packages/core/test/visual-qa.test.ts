import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  auditVisualQuality,
  createFrameDocument,
  createTransform,
  type BrandKitRecord,
  type DesignBrief,
  type DesignPlan,
  type FrameValidationReport,
  type TextNode,
} from "../src/index.js";

const now = "2026-08-10T22:00:00.000Z";
const fontId = randomUUID();

const textNode = (
  name: string,
  text: string,
  overrides: Partial<TextNode> = {},
): TextNode => ({
  id: randomUUID(),
  type: "text",
  name,
  visible: true,
  locked: false,
  transform: createTransform({ x: 20, y: 20, width: 240, height: 80 }),
  opacity: 1,
  blendMode: "normal",
  text,
  typography: {
    fontId,
    fontSize: 24,
    fontWeight: 700,
    fontStyle: "normal",
    lineHeight: 1.2,
    letterSpacing: 0,
    alignment: "left",
    verticalAlignment: "top",
    color: "#777777",
    opacity: 1,
  },
  textBox: {
    mode: "fixed",
    width: 240,
    height: 80,
    wrapping: "word",
    overflow: "clip",
  },
  ...overrides,
});

const validation = (
  warnings: FrameValidationReport["warnings"] = [],
): FrameValidationReport => ({
  valid: true,
  nodeCount: 2,
  maximumDepth: 1,
  complexityScore: 2,
  errors: [],
  warnings,
});

const designBrief = (id: string, copyId: string): DesignBrief => ({
  id,
  name: "Campaign brief",
  objective: "Launch the campaign",
  audience: { primary: "Owners", secondary: [] },
  format: { width: 400, height: 300, unit: "px", channel: "promotionalCard" },
  requiredCopy: [{ id: copyId, role: "headline", text: "Exact headline" }],
  optionalCopy: [],
  brandContext: {
    description: "Precise",
    requiredTokenKeys: [],
    prohibitedUses: [],
  },
  assetRequirements: [],
  hierarchyRequirements: [],
  mood: { keywords: [], avoid: [] },
  constraints: [],
  accessibilityRequirements: {
    minimumContrastRatio: 7,
    requirements: [],
    readingOrder: ["headline"],
  },
  exportRequirements: [],
  createdAt: now,
  updatedAt: now,
});

const designPlan = (
  id: string,
  briefId: string,
  frameId: string,
  roleId: string,
  nodeId: string,
  copyId: string,
): DesignPlan => ({
  id,
  name: "Campaign plan",
  briefId,
  targetFrameId: frameId,
  objectiveSummary: "Preserve required intent",
  semanticRoles: [
    {
      id: roleId,
      key: "headline",
      name: "Headline",
      role: "headline",
      required: true,
      nodeId,
      copyItemId: copyId,
    },
  ],
  contentHierarchy: [{ id: randomUUID(), roleId, priority: 1 }],
  layoutRegions: [],
  anchors: [],
  constraints: [],
  safeAreas: [
    {
      id: randomUUID(),
      name: "Platform safe area",
      top: 0.05,
      right: 0.05,
      bottom: 0.05,
      left: 0.05,
    },
  ],
  brandBindings: [
    { id: randomUUID(), roleId, property: "textColor", tokenKey: "primary" },
  ],
  assetAssignments: [],
  effectIntentions: [],
  variantRules: [],
  protectedDecisions: [],
  approval: {
    state: "approved",
    notes: [],
    decidedBy: "human",
    decidedAt: now,
  },
  createdAt: now,
  updatedAt: now,
});

const brandKit = (projectId: string): BrandKitRecord => ({
  schemaVersion: 1,
  id: randomUUID(),
  revision: 1,
  contentHash: `sha256:${"a".repeat(64)}`,
  name: "Campaign brand",
  createdAt: now,
  createdBy: "human",
  sourceProjectId: projectId,
  provenance: "Test fixture",
  licenseNotes: "Test fixture",
  palette: [{ key: "primary", name: "Primary", color: "#111111" }],
  typeRoles: [],
  logos: [],
  definitions: [],
});

describe("deterministic visual QA", () => {
  it("maps canonical warnings and detects exact duplicate, overlap, and provable contrast facts", () => {
    const projectId = randomUUID();
    const frame = createFrameDocument({
      id: randomUUID(),
      slug: "qa",
      name: "QA",
      width: 400,
      height: 300,
      now,
    });
    const first = textNode("First", "Repeated text");
    const second = textNode("Second", "  repeated   text ", {
      transform: createTransform({ x: 30, y: 30, width: 240, height: 80 }),
    });
    frame.root.children.push(first, second);

    const report = auditVisualQuality({
      projectId,
      frame,
      validation: validation([
        {
          code: "TEXT_OVERFLOW",
          message: "First overflows.",
          nodeIds: [first.id],
        },
        {
          code: "LOW_RESOLUTION_ASSET",
          message: "Hero is low resolution.",
          nodeIds: [randomUUID()],
        },
      ]),
    });

    expect(report.classification).toBe("deterministic");
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_TEXT",
        "LOW_CONTRAST",
        "LOW_RESOLUTION_RASTER_USE",
        "OVERLAPPING_TEXT",
        "TEXT_OVERFLOW",
      ]),
    );
    expect(
      report.findings.find((finding) => finding.code === "TEXT_OVERFLOW")
        ?.severity,
    ).toBe("error");
    expect(report.unevaluated.map((item) => item.category)).toEqual([
      "heuristic",
      "modelJudged",
    ]);
  });

  it("uses exact plan, brief, safe-area, visibility, copy, and pinned-token contracts", () => {
    const projectId = randomUUID();
    const frame = createFrameDocument({
      id: randomUUID(),
      slug: "planned-qa",
      name: "Planned QA",
      width: 400,
      height: 300,
      now,
    });
    const headline = textNode("Headline", "Wrong headline", {
      visible: false,
      transform: createTransform({ x: -10, y: 10, width: 260, height: 80 }),
    });
    frame.root.children.push(headline);
    const briefId = randomUUID();
    const copyId = randomUUID();
    const roleId = randomUUID();
    const planId = randomUUID();

    const report = auditVisualQuality({
      projectId,
      frame,
      validation: validation(),
      brief: designBrief(briefId, copyId),
      plan: designPlan(planId, briefId, frame.id, roleId, headline.id, copyId),
      brandKit: brandKit(projectId),
    });

    expect(report.planId).toBe(planId);
    expect(report.briefId).toBe(briefId);
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "BRAND_TOKEN_DIVERGENCE",
        "CLIPPED_IMPORTANT_CONTENT",
        "HIDDEN_IMPORTANT_CONTENT",
        "MISSING_REQUIRED_COPY",
        "UNSAFE_EDGE_PROXIMITY",
      ]),
    );
    expect(
      report.findings.every(
        (finding) => finding.classification === "deterministic",
      ),
    ).toBe(true);
    expect(
      report.findings.find(
        (finding) => finding.code === "UNSAFE_EDGE_PROXIMITY",
      )?.details,
    ).toMatchObject({
      safeBounds: { x: 20, y: 15, width: 360, height: 270 },
    });
  });

  it("reports a required role whose canonical node binding is missing", () => {
    const projectId = randomUUID();
    const frame = createFrameDocument({
      id: randomUUID(),
      slug: "missing-role",
      name: "Missing role",
      width: 400,
      height: 300,
      now,
    });
    const briefId = randomUUID();
    const copyId = randomUUID();
    const roleId = randomUUID();
    const missingNodeId = randomUUID();
    const report = auditVisualQuality({
      projectId,
      frame,
      validation: validation(),
      brief: designBrief(briefId, copyId),
      plan: designPlan(
        randomUUID(),
        briefId,
        frame.id,
        roleId,
        missingNodeId,
        copyId,
      ),
    });
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING_SEMANTIC_ROLE",
          nodeIds: [missingNodeId],
          roleIds: [roleId],
        }),
      ]),
    );
  });
});
