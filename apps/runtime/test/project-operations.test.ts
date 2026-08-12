import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createFrameDocument,
  createDesignBrief,
  createDesignPlan,
  createProjectTemplateDefinition,
  createProjectDocument,
  createTransform,
  type FontRecord,
  type BrandKitRecord,
  type HistoryEntry,
  type RectangleNode,
} from "@agentic-design/core";
import { simulateProjectOperations } from "../src/project-operations.js";
import type { ProjectState } from "../src/types.js";

const now = "2026-08-08T12:00:00.000Z";
const font = (): FontRecord => ({
  id: randomUUID(),
  family: "Test Sans",
  style: "normal",
  weight: 400,
  format: "ttf",
  source: "project",
  path: "fonts/test.ttf",
  hash: `sha256:${"a".repeat(64)}`,
  licenseNotes: "Test fixture",
});

const project = (
  record: FontRecord,
  history: HistoryEntry[],
): ProjectState => ({
  directory: "/tmp/project",
  document: createProjectDocument({
    id: randomUUID(),
    slug: "font-removal",
    name: "Font removal",
    now,
  }),
  frames: new Map(),
  assets: { schemaVersion: 1, assets: [] },
  fonts: { schemaVersion: 1, fonts: [record] },
  history,
  blockedFrames: new Map(),
  externalConflicts: new Map(),
});

const historyEntry = (
  projectId: string,
  operations: HistoryEntry["operations"],
): HistoryEntry => ({
  id: randomUUID(),
  transactionId: randomUUID(),
  timestamp: now,
  scope: "project",
  projectId,
  previousRevision: 0,
  revision: 1,
  actor: { source: "http", id: "test" },
  kind: "mutation",
  label: "Test",
  operations,
  inverseOperations: [],
  beforeHash: `sha256:${"b".repeat(64)}`,
  afterHash: `sha256:${"c".repeat(64)}`,
});

describe("project font removal", () => {
  it("does not treat the font's own import history as artwork usage", async () => {
    const record = font();
    const state = project(record, []);
    state.history.push(
      historyEntry(state.document.id, [{ kind: "importFont", font: record }]),
    );
    const result = await simulateProjectOperations({
      project: state,
      operations: [{ kind: "removeFont", fontId: record.id }],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(result.fonts.fonts).toEqual([]);
  });

  it("retains protection for genuine historical typography references", async () => {
    const record = font();
    const state = project(record, []);
    state.history.push(
      historyEntry(state.document.id, [
        {
          kind: "updateNode",
          nodeId: randomUUID(),
          propertyGroup: "typography",
          value: { fontId: record.id },
        },
      ]),
    );
    await expect(
      simulateProjectOperations({
        project: state,
        operations: [{ kind: "removeFont", fontId: record.id }],
        now,
        historyEntryIds: () => ({
          id: randomUUID(),
          transactionId: randomUUID(),
        }),
      }),
    ).rejects.toMatchObject({ code: "FONT_IN_USE" });
  });
});

describe("project Brand Kit pins", () => {
  it("pins and detaches exact immutable revisions with reversible project history", async () => {
    const record = font();
    const state = project(record, []);
    state.fonts.fonts = [];
    const kit: BrandKitRecord = {
      schemaVersion: 1,
      id: randomUUID(),
      revision: 2,
      contentHash: `sha256:${"d".repeat(64)}`,
      previousRevisionHash: `sha256:${"e".repeat(64)}`,
      name: "Signal System",
      createdAt: now,
      createdBy: "test",
      sourceProjectId: state.document.id,
      provenance: "Verified project source",
      licenseNotes: "Internal fixture",
      palette: [{ key: "signal", name: "Signal", color: "#315BFF" }],
      typeRoles: [],
      logos: [],
      definitions: [],
    };
    const pinned = await simulateProjectOperations({
      project: state,
      operations: [
        {
          kind: "pinBrandKit",
          pin: {
            kitId: kit.id,
            revision: kit.revision,
            contentHash: kit.contentHash,
            resourceMap: {},
          },
        },
      ],
      brandKits: [kit],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(pinned.document.brandKitPin).toMatchObject({
      kitId: kit.id,
      revision: 2,
    });
    const detached = await simulateProjectOperations({
      project: { ...state, document: pinned.document },
      operations: pinned.inverseOperations,
      brandKits: [kit],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(detached.document.brandKitPin).toBeUndefined();
  });

  it("rejects a forged Brand Kit hash", async () => {
    const state = project(font(), []);
    state.fonts.fonts = [];
    await expect(
      simulateProjectOperations({
        project: state,
        operations: [
          {
            kind: "pinBrandKit",
            pin: {
              kitId: randomUUID(),
              revision: 1,
              contentHash: `sha256:${"f".repeat(64)}`,
              resourceMap: {},
            },
          },
        ],
        brandKits: [],
        now,
        historyEntryIds: () => ({
          id: randomUUID(),
          transactionId: randomUUID(),
        }),
      }),
    ).rejects.toThrow(/unavailable/);
  });

  it("migrates exact live values atomically and produces an exact rollback", async () => {
    const state = project(font(), []);
    state.fonts.fonts = [];
    const kitId = randomUUID();
    const oldKit: BrandKitRecord = {
      schemaVersion: 1,
      id: kitId,
      revision: 1,
      contentHash: `sha256:${"1".repeat(64)}`,
      name: "Signal System",
      createdAt: now,
      createdBy: "test",
      sourceProjectId: state.document.id,
      provenance: "Verified fixture",
      licenseNotes: "Internal",
      palette: [{ key: "signal", name: "Signal", color: "#315BFF" }],
      typeRoles: [],
      logos: [],
      definitions: [],
    };
    const nextKit: BrandKitRecord = {
      ...structuredClone(oldKit),
      revision: 2,
      contentHash: `sha256:${"2".repeat(64)}`,
      previousRevisionHash: oldKit.contentHash,
      palette: [{ key: "signal", name: "Signal", color: "#FF6B35" }],
    };
    const frame = createFrameDocument({
      id: randomUUID(),
      slug: "campaign",
      name: "Campaign",
      width: 1080,
      height: 1350,
      now,
    });
    const bindingId = randomUUID();
    const node: RectangleNode = {
      id: randomUUID(),
      type: "rectangle",
      name: "Bound card",
      visible: true,
      locked: false,
      transform: createTransform({ width: 200, height: 120 }),
      opacity: 1,
      blendMode: "normal",
      fill: { type: "solid", color: "#315BFF", opacity: 1 },
      cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
      brandBindings: [
        {
          id: bindingId,
          property: "fill",
          kitId,
          kitRevision: 1,
          kitContentHash: oldKit.contentHash,
          tokenKey: "signal",
        },
      ],
    };
    frame.root.children.push(node);
    state.frames.set(frame.id, frame);
    state.document.frames.push({
      id: frame.id,
      slug: frame.slug,
      name: frame.name,
      path: `frames/${frame.slug}.json`,
    });
    state.document.frameOrder.push(frame.id);
    state.document.brandKitPin = {
      kitId,
      revision: 1,
      contentHash: oldKit.contentHash,
      resourceMap: {},
    };
    const incompatibleKit: BrandKitRecord = {
      ...structuredClone(nextKit),
      revision: 3,
      contentHash: `sha256:${"3".repeat(64)}`,
      previousRevisionHash: nextKit.contentHash,
      palette: [{ key: "replacement", name: "Replacement", color: "#111111" }],
    };
    await expect(
      simulateProjectOperations({
        project: state,
        operations: [
          {
            kind: "migrateBrandKit",
            pin: {
              kitId,
              revision: 3,
              contentHash: incompatibleKit.contentHash,
              resourceMap: {},
            },
          },
        ],
        brandKits: [oldKit, nextKit, incompatibleKit],
        now,
        historyEntryIds: () => ({
          id: randomUUID(),
          transactionId: randomUUID(),
        }),
      }),
    ).rejects.toThrow(/palette token was not found/);
    expect(state.document.brandKitPin.revision).toBe(1);
    expect(state.frames.get(frame.id)?.root.children[0]).toMatchObject({
      fill: { color: "#315BFF" },
    });
    const migrated = await simulateProjectOperations({
      project: state,
      operations: [
        {
          kind: "migrateBrandKit",
          pin: {
            kitId,
            revision: 2,
            contentHash: nextKit.contentHash,
            resourceMap: {},
          },
        },
      ],
      brandKits: [oldKit, nextKit],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(migrated.document.brandKitPin?.revision).toBe(2);
    expect(migrated.changedFrameIds).toEqual(new Set([frame.id]));
    expect(migrated.frames.get(frame.id)).toMatchObject({
      revision: 1,
      root: {
        children: [
          {
            id: node.id,
            fill: { color: "#FF6B35" },
            brandBindings: [
              {
                id: bindingId,
                kitRevision: 2,
                kitContentHash: nextKit.contentHash,
                tokenKey: "signal",
              },
            ],
          },
        ],
      },
    });
    const rolledBack = await simulateProjectOperations({
      project: {
        ...state,
        document: migrated.document,
        frames: migrated.frames,
      },
      operations: migrated.inverseOperations,
      brandKits: [oldKit, nextKit],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(rolledBack.document.brandKitPin?.revision).toBe(1);
    expect(rolledBack.frames.get(frame.id)?.root.children[0]).toMatchObject({
      id: node.id,
      fill: { color: "#315BFF" },
      brandBindings: [
        {
          id: bindingId,
          kitRevision: 1,
          kitContentHash: oldKit.contentHash,
        },
      ],
    });
  });
});

describe("project frame duplication", () => {
  it("duplicates and resizes from canonical constraints in one project operation", async () => {
    const state = project(font(), []);
    state.fonts.fonts = [];
    const source = createFrameDocument({
      id: randomUUID(),
      slug: "portrait-master",
      name: "Portrait master",
      width: 1000,
      height: 1000,
      now,
    });
    const card: RectangleNode = {
      id: randomUUID(),
      type: "rectangle",
      name: "Pinned card",
      visible: true,
      locked: false,
      transform: createTransform({ x: 700, y: 400, width: 200, height: 100 }),
      resizeConstraints: { horizontal: "right", vertical: "middle" },
      opacity: 1,
      blendMode: "normal",
      fill: { type: "solid", color: "#315CF5", opacity: 1 },
      cornerRadius: {
        topLeft: 0,
        topRight: 0,
        bottomRight: 0,
        bottomLeft: 0,
      },
    };
    source.root.children.push(card);
    state.document.frames.push({
      id: source.id,
      slug: source.slug,
      name: source.name,
      path: `frames/${source.slug}.json`,
    });
    state.document.frameOrder.push(source.id);
    state.frames.set(source.id, source);
    const newFrameId = randomUUID();
    const result = await simulateProjectOperations({
      project: state,
      operations: [
        {
          kind: "duplicateFrame",
          frameId: source.id,
          newFrameId,
          slug: "landscape-variation",
          name: "Landscape variation",
          resize: { width: 600, height: 800, strategy: "constraints" },
        },
      ],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    const duplicate = result.frames.get(newFrameId)!;
    expect(duplicate.canvas).toMatchObject({ width: 600, height: 800 });
    expect(duplicate.root.children[0]).toMatchObject({
      id: card.id,
      resizeConstraints: { horizontal: "right", vertical: "middle" },
      transform: { x: 300, y: 300, width: 200, height: 100 },
    });
    expect(source.canvas).toMatchObject({ width: 1000, height: 1000 });
    expect(result.baselineEntries).toHaveLength(1);
  });
});

describe("project export presets", () => {
  it("creates, updates, and removes named canonical presets reversibly", async () => {
    const state = project(font(), []);
    state.fonts.fonts = [];
    const presetId = randomUUID();
    const created = await simulateProjectOperations({
      project: state,
      operations: [
        {
          kind: "setExportPreset",
          preset: {
            id: presetId,
            name: "Campaign WebP",
            format: "webp",
            scale: 2,
            quality: 86,
          },
        },
      ],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(created.document.exportPresets).toEqual([
      expect.objectContaining({ id: presetId, format: "webp", scale: 2 }),
    ]);

    const updated = await simulateProjectOperations({
      project: { ...state, document: created.document },
      operations: [
        {
          kind: "setExportPreset",
          preset: {
            id: presetId,
            name: "Campaign JPEG",
            format: "jpeg",
            scale: 1,
            quality: 92,
            matteColor: "#FFFFFF",
          },
        },
      ],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(updated.document.exportPresets).toEqual([
      expect.objectContaining({ name: "Campaign JPEG", format: "jpeg" }),
    ]);

    const removed = await simulateProjectOperations({
      project: { ...state, document: updated.document },
      operations: [{ kind: "removeExportPreset", presetId }],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(removed.document.exportPresets).toEqual([]);
    expect(removed.inverseOperations).toEqual([
      expect.objectContaining({ kind: "setExportPreset" }),
    ]);
  });

  it("rejects duplicate human-readable preset names", async () => {
    const state = project(font(), []);
    state.fonts.fonts = [];
    state.document.exportPresets = [
      {
        id: randomUUID(),
        name: "Social PNG",
        format: "png",
        scale: 1,
      },
    ];
    await expect(
      simulateProjectOperations({
        project: state,
        operations: [
          {
            kind: "setExportPreset",
            preset: {
              id: randomUUID(),
              name: "social png",
              format: "png",
              scale: 2,
            },
          },
        ],
        now,
        historyEntryIds: () => ({
          id: randomUUID(),
          transactionId: randomUUID(),
        }),
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe("project templates", () => {
  it("creates, updates, and removes immutable template definitions reversibly", async () => {
    const state = project(font(), []);
    state.fonts.fonts = [];
    const node: RectangleNode = {
      id: randomUUID(),
      type: "rectangle",
      name: "Headline panel",
      visible: true,
      locked: false,
      transform: createTransform({ width: 640, height: 180 }),
      opacity: 1,
      blendMode: "normal",
      fill: { type: "solid", color: "#315CF5", opacity: 1 },
      cornerRadius: {
        topLeft: 12,
        topRight: 12,
        bottomRight: 12,
        bottomLeft: 12,
      },
    };
    const template = createProjectTemplateDefinition({
      id: randomUUID(),
      name: "Campaign system",
      nodes: [node],
      slots: [
        {
          slotId: randomUUID(),
          key: "headline",
          name: "Headline",
          role: "headline",
          nodeId: node.id,
        },
      ],
      now,
    });
    const created = await simulateProjectOperations({
      project: state,
      operations: [{ kind: "setProjectTemplate", template }],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(created.document.templates).toEqual([template]);
    expect(created.inverseOperations).toEqual([
      { kind: "removeProjectTemplate", templateId: template.id },
    ]);

    const revised = {
      ...template,
      name: "Campaign system approved",
      updatedAt: "2026-08-08T13:00:00.000Z",
    };
    const updated = await simulateProjectOperations({
      project: { ...state, document: created.document },
      operations: [{ kind: "setProjectTemplate", template: revised }],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(updated.document.templates).toEqual([revised]);
    expect(updated.inverseOperations).toEqual([
      { kind: "setProjectTemplate", template },
    ]);

    const removed = await simulateProjectOperations({
      project: { ...state, document: updated.document },
      operations: [{ kind: "removeProjectTemplate", templateId: template.id }],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(removed.document.templates).toEqual([]);
    expect(removed.inverseOperations).toEqual([
      { kind: "setProjectTemplate", template: revised },
    ]);
  });

  it("rejects unavailable template assets and duplicate names", async () => {
    const state = project(font(), []);
    state.fonts.fonts = [];
    const missingAssetTemplate = createProjectTemplateDefinition({
      id: randomUUID(),
      name: "Missing asset",
      nodes: [
        {
          id: randomUUID(),
          type: "rasterImage",
          name: "Hero",
          visible: true,
          locked: false,
          transform: createTransform({ width: 640, height: 480 }),
          opacity: 1,
          blendMode: "normal",
          assetId: randomUUID(),
          fit: "cover",
        },
      ],
      slots: [],
      now,
    });
    await expect(
      simulateProjectOperations({
        project: state,
        operations: [
          { kind: "setProjectTemplate", template: missingAssetTemplate },
        ],
        now,
        historyEntryIds: () => ({
          id: randomUUID(),
          transactionId: randomUUID(),
        }),
      }),
    ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });

    const plain = createProjectTemplateDefinition({
      id: randomUUID(),
      name: "Social card",
      nodes: [
        {
          id: randomUUID(),
          type: "rectangle",
          name: "Background",
          visible: true,
          locked: false,
          transform: createTransform({ width: 100, height: 100 }),
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#FFFFFF", opacity: 1 },
          cornerRadius: {
            topLeft: 0,
            topRight: 0,
            bottomRight: 0,
            bottomLeft: 0,
          },
        },
      ],
      slots: [],
      now,
    });
    state.document.templates = [plain];
    await expect(
      simulateProjectOperations({
        project: state,
        operations: [
          {
            kind: "setProjectTemplate",
            template: { ...plain, id: randomUUID(), name: "social card" },
          },
        ],
        now,
        historyEntryIds: () => ({
          id: randomUUID(),
          transactionId: randomUUID(),
        }),
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe("project DesignBriefs", () => {
  const designBrief = (assetId?: string) =>
    createDesignBrief({
      id: randomUUID(),
      now,
      name: "Launch brief",
      objective: "Create a clear campaign launch graphic.",
      audience: { primary: "Design leaders", secondary: [] },
      format: {
        width: 1080,
        height: 1350,
        unit: "px",
        channel: "socialPost",
      },
      requiredCopy: [],
      optionalCopy: [],
      brandContext: {
        description: "Use the approved project identity.",
        requiredTokenKeys: [],
        prohibitedUses: [],
      },
      assetRequirements: assetId
        ? [
            {
              id: randomUUID(),
              role: "heroSubject",
              description: "Use the approved hero asset.",
              required: true,
              assetId,
            },
          ]
        : [],
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
          id: randomUUID(),
          name: "Campaign PNG",
          format: "png",
          scale: 1,
          transparentBackground: "allowed",
        },
      ],
    });

  it("creates, updates, and removes briefs with exact project inverses", async () => {
    const state = project(font(), []);
    state.fonts.fonts = [];
    const brief = designBrief();
    const created = await simulateProjectOperations({
      project: state,
      operations: [{ kind: "setDesignBrief", brief }],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(created.document.designBriefs).toEqual([brief]);
    expect(created.inverseOperations).toEqual([
      { kind: "removeDesignBrief", briefId: brief.id },
    ]);
    const revised = {
      ...brief,
      objective: "Create two clear campaign launch graphics.",
      updatedAt: "2026-08-08T13:00:00.000Z",
    };
    const updated = await simulateProjectOperations({
      project: { ...state, document: created.document },
      operations: [{ kind: "setDesignBrief", brief: revised }],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(updated.document.designBriefs).toEqual([revised]);
    expect(updated.inverseOperations).toEqual([
      { kind: "setDesignBrief", brief },
    ]);
    const removed = await simulateProjectOperations({
      project: { ...state, document: updated.document },
      operations: [{ kind: "removeDesignBrief", briefId: brief.id }],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(removed.document.designBriefs).toEqual([]);
    expect(removed.inverseOperations).toEqual([
      { kind: "setDesignBrief", brief: revised },
    ]);
  });

  it("rejects unavailable asset and Brand Kit references", async () => {
    const state = project(font(), []);
    state.fonts.fonts = [];
    await expect(
      simulateProjectOperations({
        project: state,
        operations: [
          { kind: "setDesignBrief", brief: designBrief(randomUUID()) },
        ],
        now,
        historyEntryIds: () => ({
          id: randomUUID(),
          transactionId: randomUUID(),
        }),
      }),
    ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    const unavailableKitBrief = designBrief();
    unavailableKitBrief.brandContext.brandKit = {
      kitId: randomUUID(),
      revision: 1,
    };
    await expect(
      simulateProjectOperations({
        project: state,
        operations: [{ kind: "setDesignBrief", brief: unavailableKitBrief }],
        brandKits: [],
        now,
        historyEntryIds: () => ({
          id: randomUUID(),
          transactionId: randomUUID(),
        }),
      }),
    ).rejects.toThrow(/unavailable Brand Kit/);
  });
});

describe("project DesignPlans", () => {
  const prepareState = () => {
    const state = project(font(), []);
    state.fonts.fonts = [];
    const frame = createFrameDocument({
      id: randomUUID(),
      slug: "planned-frame",
      name: "Planned frame",
      width: 1080,
      height: 1350,
      now,
    });
    const node: RectangleNode = {
      id: randomUUID(),
      type: "rectangle",
      name: "Headline panel",
      visible: true,
      locked: false,
      transform: createTransform({ width: 800, height: 180 }),
      opacity: 1,
      blendMode: "normal",
      fill: { type: "solid", color: "#315CF5", opacity: 1 },
      cornerRadius: {
        topLeft: 16,
        topRight: 16,
        bottomRight: 16,
        bottomLeft: 16,
      },
    };
    frame.root.children.push(node);
    state.frames.set(frame.id, frame);
    state.document.frames.push({
      id: frame.id,
      slug: frame.slug,
      name: frame.name,
      path: `frames/${frame.slug}.json`,
    });
    state.document.frameOrder.push(frame.id);
    const assetId = randomUUID();
    state.assets.assets.push({
      id: assetId,
      type: "raster",
      path: `assets/${assetId}.png`,
      mimeType: "image/png",
      hash: `sha256:${"a".repeat(64)}`,
      sizeBytes: 100,
      width: 100,
      height: 100,
    });
    return { state, frame, node, assetId };
  };

  const designPlan = (input: {
    frameId?: string;
    nodeId?: string;
    assetId?: string;
    briefId?: string;
    copyItemId?: string;
  }) => {
    const roleId = randomUUID();
    return createDesignPlan({
      id: randomUUID(),
      now,
      name: "Launch plan",
      ...(input.briefId ? { briefId: input.briefId } : {}),
      ...(input.frameId ? { targetFrameId: input.frameId } : {}),
      objectiveSummary: "Preserve approved intent in a structured layout.",
      semanticRoles: [
        {
          id: roleId,
          key: "headline",
          name: "Headline",
          role: "headline",
          required: true,
          ...(input.nodeId ? { nodeId: input.nodeId } : {}),
          ...(input.copyItemId ? { copyItemId: input.copyItemId } : {}),
        },
      ],
      contentHierarchy: [{ id: randomUUID(), roleId, priority: 1 }],
      layoutRegions: [],
      anchors: [],
      constraints: [],
      safeAreas: [],
      brandBindings: [],
      assetAssignments: input.assetId
        ? [
            {
              id: randomUUID(),
              roleId,
              assetId: input.assetId,
              fit: "cover",
              preserveCrop: true,
            },
          ]
        : [],
      effectIntentions: [],
      variantRules: [],
      protectedDecisions: [],
      approval: { state: "draft", notes: [] },
    });
  };

  it("creates, updates, and removes plans with exact project inverses", async () => {
    const { state, frame, node, assetId } = prepareState();
    const plan = designPlan({
      frameId: frame.id,
      nodeId: node.id,
      assetId,
    });
    const created = await simulateProjectOperations({
      project: state,
      operations: [{ kind: "setDesignPlan", plan }],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(created.document.designPlans).toEqual([plan]);
    expect(created.inverseOperations).toEqual([
      { kind: "removeDesignPlan", planId: plan.id },
    ]);
    const revised = {
      ...plan,
      objectiveSummary: "Preserve approved intent across two variants.",
      updatedAt: "2026-08-08T13:00:00.000Z",
    };
    const updated = await simulateProjectOperations({
      project: { ...state, document: created.document },
      operations: [{ kind: "setDesignPlan", plan: revised }],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(updated.document.designPlans).toEqual([revised]);
    expect(updated.inverseOperations).toEqual([
      { kind: "setDesignPlan", plan },
    ]);
    const removed = await simulateProjectOperations({
      project: { ...state, document: updated.document },
      operations: [{ kind: "removeDesignPlan", planId: plan.id }],
      now,
      historyEntryIds: () => ({
        id: randomUUID(),
        transactionId: randomUUID(),
      }),
    });
    expect(removed.document.designPlans).toEqual([]);
    expect(removed.inverseOperations).toEqual([
      { kind: "setDesignPlan", plan: revised },
    ]);
  });

  it("rejects unavailable brief copy, frame node, and asset references", async () => {
    const { state, frame, node } = prepareState();
    const copyId = randomUUID();
    const brief = createDesignBrief({
      id: randomUUID(),
      now,
      name: "Plan brief",
      objective: "Supply approved copy.",
      audience: { primary: "Design leaders", secondary: [] },
      format: {
        width: 1080,
        height: 1350,
        unit: "px",
        channel: "socialPost",
      },
      requiredCopy: [{ id: copyId, role: "headline", text: "Keep intent" }],
      optionalCopy: [],
      brandContext: {
        description: "Use the approved system.",
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
        readingOrder: ["headline"],
      },
      exportRequirements: [
        {
          id: randomUUID(),
          name: "PNG",
          format: "png",
          scale: 1,
          transparentBackground: "allowed",
        },
      ],
    });
    state.document.designBriefs = [brief];
    const simulate = (plan: ReturnType<typeof designPlan>) =>
      simulateProjectOperations({
        project: state,
        operations: [{ kind: "setDesignPlan", plan }],
        now,
        historyEntryIds: () => ({
          id: randomUUID(),
          transactionId: randomUUID(),
        }),
      });
    await expect(
      simulate(
        designPlan({
          frameId: frame.id,
          nodeId: node.id,
          briefId: brief.id,
          copyItemId: randomUUID(),
        }),
      ),
    ).rejects.toThrow(/unavailable brief copy/);
    await expect(
      simulate(designPlan({ frameId: frame.id, nodeId: randomUUID() })),
    ).rejects.toThrow(/unavailable target-frame node/);
    await expect(
      simulate(
        designPlan({
          frameId: frame.id,
          nodeId: node.id,
          assetId: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    state.document.designPlans = [
      designPlan({ briefId: brief.id, copyItemId: copyId }),
    ];
    await expect(
      simulateProjectOperations({
        project: state,
        operations: [
          {
            kind: "setDesignBrief",
            brief: { ...brief, requiredCopy: [], updatedAt: now },
          },
        ],
        now,
        historyEntryIds: () => ({
          id: randomUUID(),
          transactionId: randomUUID(),
        }),
      }),
    ).rejects.toThrow(/cannot remove copy/);
    await expect(
      simulateProjectOperations({
        project: state,
        operations: [{ kind: "removeDesignBrief", briefId: brief.id }],
        now,
        historyEntryIds: () => ({
          id: randomUUID(),
          transactionId: randomUUID(),
        }),
      }),
    ).rejects.toThrow(/referenced by design plan/);
  });
});
