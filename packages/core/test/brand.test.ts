import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BrandKitRecordSchema,
  createFrameDocument,
  compileBrandComponentVariant,
  createTransform,
  detachBrandComponentOperations,
  instantiateBrandDefinition,
  simulateFrameOperations,
  validateBrandKitReferences,
  validateFrameBrandBindings,
  type BrandKitRecord,
  type RectangleNode,
  type FrameDocument,
} from "../src/index.js";

const rectangle = (id = randomUUID()): RectangleNode => ({
  id,
  type: "rectangle",
  name: "Brand block",
  visible: true,
  locked: false,
  transform: createTransform({ width: 120, height: 80 }),
  opacity: 1,
  blendMode: "normal",
  fill: { type: "solid", color: "#315BFF", opacity: 1 },
  cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
});

const frameWith = (node: RectangleNode): FrameDocument => ({
  ...createFrameDocument({
    id: randomUUID(),
    slug: "brand-component",
    name: "Frame",
    width: 1080,
    height: 1080,
    now: "2026-08-11T00:00:00.000Z",
  }),
  root: {
    id: "root",
    type: "group",
    name: "Root",
    visible: true,
    locked: false,
    children: [node],
  },
});

const kit = (): BrandKitRecord => ({
  schemaVersion: 1,
  id: randomUUID(),
  revision: 1,
  contentHash: `sha256:${"a".repeat(64)}`,
  name: "Signal System",
  createdAt: "2026-08-08T12:00:00.000Z",
  createdBy: "test",
  sourceProjectId: randomUUID(),
  provenance: "Created from verified project records.",
  licenseNotes: "Internal test fixture.",
  palette: [{ key: "signal", name: "Signal", color: "#315BFF" }],
  typeRoles: [],
  logos: [],
  definitions: [],
});

describe("Brand Kit invariants", () => {
  it("rejects reusable component cycles", () => {
    const record = kit();
    record.definitions = [
      { key: "a", kind: "component", name: "A", nodes: [], includes: ["b"] },
      { key: "b", kind: "component", name: "B", nodes: [], includes: ["a"] },
    ];
    expect(() => BrandKitRecordSchema.parse(record)).toThrow(/cycle/);
  });

  it("rejects caller-forged asset references inside definitions", () => {
    const record = kit();
    record.definitions = [
      {
        key: "logo-lockup",
        kind: "component",
        name: "Logo lockup",
        includes: [],
        nodes: [
          {
            id: randomUUID(),
            type: "rasterImage",
            name: "Unowned",
            visible: true,
            locked: false,
            transform: createTransform(),
            opacity: 1,
            blendMode: "normal",
            assetId: randomUUID(),
            fit: "contain",
          },
        ],
      },
    ];
    expect(() => validateBrandKitReferences(record)).toThrow(/unowned asset/);
  });

  it("instantiates component definitions with stable exact-pin identity", () => {
    const record = kit();
    const source = rectangle();
    const instanceId = randomUUID();
    record.definitions = [
      {
        key: "tile",
        kind: "component",
        name: "Tile",
        nodes: [source],
        includes: [],
        allowedOverrides: [
          { sourceNodeId: source.id, properties: ["fill", "transform"] },
        ],
      },
    ];
    const replacement = randomUUID();
    const nodes = instantiateBrandDefinition({
      kit: BrandKitRecordSchema.parse(record),
      definitionKey: "tile",
      idMap: { [source.id]: replacement },
      resourceMap: {},
      instanceId,
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: replacement,
      type: "rectangle",
      brandComponent: {
        instanceId,
        kitId: record.id,
        kitRevision: 1,
        kitContentHash: record.contentHash,
        definitionKey: "tile",
        sourceNodeId: source.id,
        allowedOverrides: ["fill", "transform"],
        overrides: [],
      },
    });
    expect(source.id).not.toBe(replacement);
  });

  it("keeps reusable templates detached from component identity", () => {
    const record = kit();
    const source = rectangle();
    record.definitions = [
      {
        key: "hero",
        kind: "template",
        name: "Hero",
        nodes: [source],
        includes: [],
      },
    ];
    const nodes = instantiateBrandDefinition({
      kit: BrandKitRecordSchema.parse(record),
      definitionKey: "hero",
      idMap: { [source.id]: randomUUID() },
      resourceMap: {},
    });
    expect(nodes[0]?.brandComponent).toBeUndefined();
  });

  it("rejects invalid component override policies", () => {
    const record = kit();
    const source = rectangle();
    record.definitions = [
      {
        key: "hero",
        kind: "template",
        name: "Hero",
        nodes: [source],
        includes: [],
        allowedOverrides: [
          { sourceNodeId: randomUUID(), properties: ["fill", "fill"] },
        ],
      },
    ];
    expect(() => BrandKitRecordSchema.parse(record)).toThrow(
      /cannot declare component overrides|missing source node|repeats an override property/,
    );
  });

  it("records declared overrides and restores metadata through the inverse", () => {
    const source = rectangle();
    const instanceId = randomUUID();
    source.brandComponent = {
      instanceId,
      kitId: randomUUID(),
      kitRevision: 1,
      kitContentHash: `sha256:${"a".repeat(64)}`,
      definitionKey: "tile",
      sourceNodeId: randomUUID(),
      allowedOverrides: ["fill"],
      overrides: [],
    };
    const original = frameWith(source);
    const changed = simulateFrameOperations(original, [
      {
        kind: "updateNode",
        nodeId: source.id,
        propertyGroup: "fill",
        value: {
          fill: { type: "solid", color: "#FF0000", opacity: 1 },
        },
      },
    ]);
    expect(changed.frame.root.children[0]?.brandComponent?.overrides).toEqual([
      "fill",
    ]);
    const restored = simulateFrameOperations(
      changed.frame,
      changed.inverseOperations,
    );
    expect(restored.frame.root.children).toEqual(original.root.children);
  });

  it("rejects undeclared visual overrides until the component is detached", () => {
    const source = rectangle();
    const instanceId = randomUUID();
    source.brandComponent = {
      instanceId,
      kitId: randomUUID(),
      kitRevision: 1,
      kitContentHash: `sha256:${"a".repeat(64)}`,
      definitionKey: "tile",
      sourceNodeId: randomUUID(),
      allowedOverrides: [],
      overrides: [],
    };
    const original = frameWith(source);
    expect(() =>
      simulateFrameOperations(original, [
        {
          kind: "updateNode",
          nodeId: source.id,
          propertyGroup: "transform",
          value: { x: 20 },
        },
      ]),
    ).toThrow(/not declared as an override/);

    const detached = simulateFrameOperations(
      original,
      detachBrandComponentOperations(original, instanceId),
    );
    expect(detached.frame.root.children[0]?.brandComponent).toBeUndefined();
    expect(detached.frame.root.children[0]).toMatchObject({
      id: source.id,
      fill: source.fill,
      transform: source.transform,
    });
  });

  it("protects component hierarchy until explicit appearance-preserving detach", () => {
    const source = rectangle();
    source.brandComponent = {
      instanceId: randomUUID(),
      kitId: randomUUID(),
      kitRevision: 1,
      kitContentHash: `sha256:${"a".repeat(64)}`,
      definitionKey: "tile",
      sourceNodeId: randomUUID(),
      allowedOverrides: ["transform"],
      overrides: [],
    };
    const original = frameWith(source);
    expect(() =>
      simulateFrameOperations(original, [
        { kind: "deleteNode", nodeId: source.id },
      ]),
    ).toThrow(/Component structure is controlled/);
    expect(() =>
      simulateFrameOperations(original, [
        {
          kind: "duplicateNode",
          nodeId: source.id,
          idMap: { [source.id]: randomUUID() },
        },
      ]),
    ).toThrow(/Component structure is controlled/);
  });

  it("switches compatible variants while preserving stable IDs and active overrides", () => {
    const record = kit();
    const source = rectangle();
    const compact = { ...structuredClone(source), name: "Compact" };
    const expanded = {
      ...structuredClone(source),
      name: "Expanded",
      transform: createTransform({ x: 40, width: 320, height: 180 }),
      fill: { type: "solid" as const, color: "#FF6B35", opacity: 1 },
    };
    record.definitions = [
      {
        key: "tile-compact",
        kind: "component",
        name: "Tile compact",
        nodes: [compact],
        includes: [],
        variant: { groupKey: "tile", key: "compact", name: "Compact" },
        allowedOverrides: [
          { sourceNodeId: source.id, properties: ["transform", "fill"] },
        ],
      },
      {
        key: "tile-expanded",
        kind: "component",
        name: "Tile expanded",
        nodes: [expanded],
        includes: [],
        variant: { groupKey: "tile", key: "expanded", name: "Expanded" },
        allowedOverrides: [
          { sourceNodeId: source.id, properties: ["transform", "fill"] },
        ],
      },
    ];
    const parsed = BrandKitRecordSchema.parse(record);
    const instanceId = randomUUID();
    const nodeId = randomUUID();
    const [instantiated] = instantiateBrandDefinition({
      kit: parsed,
      definitionKey: "tile-compact",
      idMap: { [source.id]: nodeId },
      resourceMap: {},
      instanceId,
    });
    const original = frameWith(instantiated as RectangleNode);
    const customized = simulateFrameOperations(original, [
      {
        kind: "updateNode",
        nodeId,
        propertyGroup: "transform",
        value: { x: 88 },
      },
    ]).frame;
    const operations = compileBrandComponentVariant({
      frame: customized,
      pin: {
        kitId: parsed.id,
        revision: parsed.revision,
        contentHash: parsed.contentHash,
        resourceMap: {},
      },
      kit: parsed,
      variant: { instanceId, definitionKey: "tile-expanded" },
    });
    const switched = simulateFrameOperations(customized, operations);
    expect(switched.frame.root.children[0]).toMatchObject({
      id: nodeId,
      name: "Expanded",
      transform: { x: 88 },
      fill: { color: "#FF6B35" },
      brandComponent: {
        definitionKey: "tile-expanded",
        variantGroupKey: "tile",
        variantKey: "expanded",
        overrides: ["transform"],
      },
    });
    const restored = simulateFrameOperations(
      switched.frame,
      switched.inverseOperations,
    );
    expect(restored.frame.root.children).toEqual(customized.root.children);
  });

  it("rejects structurally incompatible component variants", () => {
    const record = kit();
    const first = rectangle();
    const second = rectangle(randomUUID());
    record.definitions = [
      {
        key: "tile-a",
        kind: "component",
        name: "A",
        nodes: [first],
        includes: [],
        variant: { groupKey: "tile", key: "a", name: "A" },
      },
      {
        key: "tile-b",
        kind: "component",
        name: "B",
        nodes: [second],
        includes: [],
        variant: { groupKey: "tile", key: "b", name: "B" },
      },
    ];
    expect(() => BrandKitRecordSchema.parse(record)).toThrow(
      /must preserve source IDs/,
    );
  });

  it("rejects exact-pin component value forgery", () => {
    const record = kit();
    const source = rectangle();
    record.definitions = [
      {
        key: "tile",
        kind: "component",
        name: "Tile",
        nodes: [source],
        includes: [],
        allowedOverrides: [{ sourceNodeId: source.id, properties: ["fill"] }],
      },
    ];
    const parsed = BrandKitRecordSchema.parse(record);
    const [node] = instantiateBrandDefinition({
      kit: parsed,
      definitionKey: "tile",
      idMap: { [source.id]: randomUUID() },
      resourceMap: {},
      instanceId: randomUUID(),
    });
    const forged = frameWith(node as RectangleNode);
    (forged.root.children[0] as RectangleNode).fill = {
      type: "solid",
      color: "#000000",
      opacity: 1,
    };
    expect(() =>
      validateFrameBrandBindings({
        frame: forged,
        pin: {
          kitId: parsed.id,
          revision: parsed.revision,
          contentHash: parsed.contentHash,
          resourceMap: {},
        },
        kit: parsed,
      }),
    ).toThrow(/diverges without a declared active override/);
  });
});
