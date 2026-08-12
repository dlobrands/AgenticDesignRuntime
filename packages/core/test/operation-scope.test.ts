import { describe, expect, it } from "vitest";
import {
  FRAME_OPERATION_KINDS,
  FrameOperationSchema,
  PROJECT_OPERATION_KINDS,
  ProjectOperationSchema,
  SemanticOperationSchema,
  TransactionRequestSchema,
  WORKSPACE_OPERATION_KINDS,
  WorkspaceOperationSchema,
  createDesignBrief,
  createDesignPlan,
  createTransform,
  type RectangleNode,
  type SemanticOperation,
} from "../src/index.js";

const runtimeId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
const projectId = "00000000-0000-4000-8000-000000000003";
const frameId = "00000000-0000-4000-8000-000000000004";
const nodeId = "00000000-0000-4000-8000-000000000005";
const secondNodeId = "00000000-0000-4000-8000-000000000006";
const assetId = "00000000-0000-4000-8000-000000000007";
const fontId = "00000000-0000-4000-8000-000000000008";
const maskId = "00000000-0000-4000-8000-000000000009";
const adjustmentId = "00000000-0000-4000-8000-000000000010";
const kitId = "00000000-0000-4000-8000-000000000011";
const briefId = "00000000-0000-4000-8000-000000000015";
const planId = "00000000-0000-4000-8000-000000000017";

const rectangle = (id = nodeId): RectangleNode => ({
  id,
  type: "rectangle",
  name: "Scope fixture",
  visible: true,
  locked: false,
  transform: createTransform({ width: 100, height: 100 }),
  opacity: 1,
  blendMode: "normal",
  fill: { type: "solid", color: "#3366FF", opacity: 1 },
  cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
});

const brief = createDesignBrief({
  id: briefId,
  now: "2026-08-10T12:00:00.000Z",
  name: "Campaign brief",
  objective: "Launch the canonical collaboration workflow.",
  audience: { primary: "Design leaders", secondary: [] },
  format: { width: 1080, height: 1350, unit: "px", channel: "socialPost" },
  requiredCopy: [],
  optionalCopy: [],
  brandContext: {
    description: "Use the approved project identity.",
    requiredTokenKeys: [],
    prohibitedUses: [],
  },
  assetRequirements: [],
  hierarchyRequirements: [],
  mood: { keywords: ["precise"], avoid: [] },
  constraints: [],
  accessibilityRequirements: {
    minimumContrastRatio: 4.5,
    requirements: [],
    readingOrder: [],
  },
  exportRequirements: [
    {
      id: "00000000-0000-4000-8000-000000000016",
      name: "Social PNG",
      format: "png",
      scale: 1,
      transparentBackground: "allowed",
    },
  ],
});

const plan = createDesignPlan({
  id: planId,
  now: "2026-08-10T12:00:00.000Z",
  name: "Campaign plan",
  objectiveSummary: "Translate approved campaign intent into a reviewed plan.",
  semanticRoles: [
    {
      id: "00000000-0000-4000-8000-000000000018",
      key: "headline",
      name: "Headline",
      role: "headline",
      required: true,
    },
  ],
  contentHierarchy: [],
  layoutRegions: [],
  anchors: [],
  constraints: [],
  safeAreas: [],
  brandBindings: [],
  assetAssignments: [],
  effectIntentions: [],
  variantRules: [],
  protectedDecisions: [],
  approval: { state: "draft", notes: [] },
});

const operations = {
  createProject: {
    kind: "createProject",
    projectId,
    slug: "scope-fixture",
    name: "Scope fixture",
  },
  renameProject: { kind: "renameProject", name: "Renamed" },
  setExportPreset: {
    kind: "setExportPreset",
    preset: {
      id: "00000000-0000-4000-8000-000000000012",
      name: "Social PNG",
      format: "png",
      scale: 1,
    },
  },
  removeExportPreset: {
    kind: "removeExportPreset",
    presetId: "00000000-0000-4000-8000-000000000012",
  },
  setProjectTemplate: {
    kind: "setProjectTemplate",
    template: {
      id: "00000000-0000-4000-8000-000000000013",
      name: "Campaign template",
      createdAt: "2026-08-10T12:00:00.000Z",
      updatedAt: "2026-08-10T12:00:00.000Z",
      nodes: [rectangle()],
      slots: [
        {
          slotId: "00000000-0000-4000-8000-000000000014",
          key: "background",
          name: "Background",
          role: "background",
          nodeId,
        },
      ],
    },
  },
  removeProjectTemplate: {
    kind: "removeProjectTemplate",
    templateId: "00000000-0000-4000-8000-000000000013",
  },
  setDesignBrief: { kind: "setDesignBrief", brief },
  removeDesignBrief: { kind: "removeDesignBrief", briefId },
  setDesignPlan: { kind: "setDesignPlan", plan },
  removeDesignPlan: { kind: "removeDesignPlan", planId },
  createFrame: {
    kind: "createFrame",
    frameId,
    slug: "frame",
    name: "Frame",
    width: 1080,
    height: 1350,
  },
  duplicateFrame: {
    kind: "duplicateFrame",
    frameId,
    newFrameId: secondNodeId,
    slug: "frame-copy",
    name: "Frame copy",
  },
  renameFrame: { kind: "renameFrame", frameId, name: "Renamed frame" },
  reorderFrame: { kind: "reorderFrame", frameOrder: [frameId] },
  deleteFrame: { kind: "deleteFrame", frameId },
  importAsset: {
    kind: "importAsset",
    asset: {
      id: assetId,
      type: "raster",
      path: `assets/${assetId}.png`,
      mimeType: "image/png",
      hash: `sha256:${"a".repeat(64)}`,
      sizeBytes: 1,
      width: 1,
      height: 1,
    },
  },
  importFont: {
    kind: "importFont",
    font: {
      id: fontId,
      family: "Fixture Sans",
      style: "normal",
      weight: 400,
      format: "woff2",
      source: "project",
      path: `fonts/${fontId}.woff2`,
      hash: `sha256:${"b".repeat(64)}`,
      licenseNotes: "Test fixture",
    },
  },
  removeFont: { kind: "removeFont", fontId },
  pinBrandKit: {
    kind: "pinBrandKit",
    pin: {
      kitId,
      revision: 1,
      contentHash: `sha256:${"c".repeat(64)}`,
      resourceMap: {},
    },
  },
  migrateBrandKit: {
    kind: "migrateBrandKit",
    pin: {
      kitId,
      revision: 2,
      contentHash: `sha256:${"d".repeat(64)}`,
      resourceMap: {},
    },
  },
  unpinBrandKit: { kind: "unpinBrandKit" },
  setCanvas: { kind: "setCanvas", value: { clipContent: true } },
  setFrameBrandMode: { kind: "setFrameBrandMode", mode: null },
  createNode: { kind: "createNode", parentId: "root", node: rectangle() },
  updateNode: {
    kind: "updateNode",
    nodeId,
    propertyGroup: "transform",
    value: { x: 10 },
  },
  deleteNode: { kind: "deleteNode", nodeId },
  duplicateNode: {
    kind: "duplicateNode",
    nodeId,
    idMap: { [nodeId]: secondNodeId },
  },
  moveNode: { kind: "moveNode", nodeId, parentId: "root", index: 0 },
  reorderNode: { kind: "reorderNode", nodeId, index: 0 },
  groupNodes: {
    kind: "groupNodes",
    nodeIds: [nodeId],
    groupId: secondNodeId,
    name: "Group",
  },
  ungroupNodes: { kind: "ungroupNodes", groupId: nodeId },
  replaceAsset: { kind: "replaceAsset", nodeId, assetId, fit: "cover" },
  applyMask: {
    kind: "applyMask",
    maskId,
    name: "Mask",
    mode: "alpha",
    inverted: false,
    maskSource: rectangle(secondNodeId),
    nodeIds: [nodeId],
  },
  updateMask: {
    kind: "updateMask",
    maskId,
    value: { inverted: true },
  },
  removeMask: { kind: "removeMask", maskId },
  addAdjustment: {
    kind: "addAdjustment",
    adjustment: {
      id: adjustmentId,
      type: "adjustment",
      name: "Adjustment",
      visible: true,
      locked: false,
      transform: createTransform({ width: 1, height: 1 }),
      enabled: true,
      targetId: "root",
      values: {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        hue: 0,
        blur: 0,
      },
    },
  },
  setAdjustment: {
    kind: "setAdjustment",
    adjustmentId,
    values: { contrast: 10 },
  },
  toggleAdjustment: {
    kind: "toggleAdjustment",
    adjustmentId,
    enabled: false,
  },
  removeAdjustment: { kind: "removeAdjustment", adjustmentId },
  undo: { kind: "undo" },
  redo: { kind: "redo" },
  restoreRevision: { kind: "restoreRevision", revision: 0 },
} satisfies Record<SemanticOperation["kind"], SemanticOperation>;

const scopeSchemas = {
  workspace: WorkspaceOperationSchema,
  project: ProjectOperationSchema,
  frame: FrameOperationSchema,
} as const;

const allowedScopes = {
  workspace: new Set<string>(WORKSPACE_OPERATION_KINDS),
  project: new Set<string>(PROJECT_OPERATION_KINDS),
  frame: new Set<string>(FRAME_OPERATION_KINDS),
};

const requestFor = (
  scope: keyof typeof scopeSchemas,
  operation: SemanticOperation,
) => ({
  schemaVersion: 1,
  mode: "commit",
  runtimeId,
  workspaceId,
  scope:
    scope === "workspace"
      ? { kind: "workspace" }
      : scope === "project"
        ? { kind: "project", projectId }
        : { kind: "frame", projectId, frameId },
  baseRevision: scope === "workspace" ? null : 0,
  actor: { source: "http", id: "scope-matrix" },
  operations: [operation],
});

describe("scope-specific transaction contracts", () => {
  it("keeps the operation-kind registries exhaustive and schema-backed", () => {
    expect(Object.keys(operations).sort()).toEqual(
      [
        ...new Set([
          ...WORKSPACE_OPERATION_KINDS,
          ...PROJECT_OPERATION_KINDS,
          ...FRAME_OPERATION_KINDS,
        ]),
      ].sort(),
    );
    for (const operation of Object.values(operations))
      expect(SemanticOperationSchema.safeParse(operation).success).toBe(true);
  });

  for (const [kind, operation] of Object.entries(operations)) {
    for (const [scope, schema] of Object.entries(scopeSchemas)) {
      const expected =
        allowedScopes[scope as keyof typeof allowedScopes].has(kind);
      it(`${expected ? "allows" : "rejects"} ${kind} at ${scope} scope`, () => {
        expect(schema.safeParse(operation).success).toBe(expected);
        expect(
          TransactionRequestSchema.safeParse(
            requestFor(scope as keyof typeof scopeSchemas, operation),
          ).success,
        ).toBe(expected);
      });
    }
  }

  it("requires exactly one workspace operation and scope-correct revisions", () => {
    expect(
      TransactionRequestSchema.safeParse({
        ...requestFor("workspace", operations.createProject),
        operations: [operations.createProject, operations.createProject],
      }).success,
    ).toBe(false);
    expect(
      TransactionRequestSchema.safeParse({
        ...requestFor("workspace", operations.createProject),
        baseRevision: 0,
      }).success,
    ).toBe(false);
    expect(
      TransactionRequestSchema.safeParse({
        ...requestFor("frame", operations.setCanvas),
        baseRevision: null,
      }).success,
    ).toBe(false);
  });
});
