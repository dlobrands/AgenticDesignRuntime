import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FrameDocumentSchema,
  compilePaletteTokenBinding,
  compilePaletteTokenUnbind,
  compileEffectStyleBinding,
  compileEffectStyleUnbind,
  compileRadiusTokenBinding,
  compileRadiusTokenUnbind,
  compileSpacingTokenBinding,
  compileSpacingTokenUnbind,
  compileTypographyRoleBinding,
  compileTypographyRoleUnbind,
  compileVariableMode,
  createFrameDocument,
  createTransform,
  findNode,
  simulateFrameOperations,
  validateFrameBrandBindings,
  type BrandKitRecord,
  type RectangleNode,
  type TextNode,
} from "../src/index.js";

const now = "2026-08-11T00:20:00.000Z";

const fixture = () => {
  const frame = createFrameDocument({
    id: randomUUID(),
    slug: "live-brand",
    name: "Live Brand",
    width: 800,
    height: 600,
    now,
  });
  const node: RectangleNode = {
    id: randomUUID(),
    type: "rectangle",
    name: "Bound panel",
    visible: true,
    locked: false,
    transform: createTransform({ width: 400, height: 300 }),
    opacity: 1,
    blendMode: "normal",
    fill: { type: "solid", color: "#FFFFFF", opacity: 0.8 },
    stroke: {
      enabled: true,
      width: 2,
      alignment: "inside",
      opacity: 0.6,
      paint: { type: "solid", color: "#111111", opacity: 0.7 },
    },
    cornerRadius: {
      topLeft: 0,
      topRight: 0,
      bottomRight: 0,
      bottomLeft: 0,
    },
  };
  frame.root.children.push(node);
  const sourceFontId = randomUUID();
  const projectFontId = randomUUID();
  const textNode: TextNode = {
    id: randomUUID(),
    type: "text",
    name: "Bound headline",
    visible: true,
    locked: false,
    transform: createTransform({ width: 500, height: 100 }),
    opacity: 1,
    blendMode: "normal",
    text: "Live type",
    typography: {
      fontId: randomUUID(),
      fontSize: 24,
      fontWeight: 400,
      fontStyle: "normal",
      lineHeight: 30,
      letterSpacing: 0,
      alignment: "left",
      verticalAlignment: "top",
      color: "#111111",
      opacity: 1,
    },
    spans: [
      {
        id: "emphasis",
        start: 0,
        end: 9,
        style: { fontSize: 28, color: "#FFFFFF" },
      },
    ],
    textBox: {
      mode: "fixed",
      width: 500,
      height: 100,
      wrapping: "word",
      overflow: "clip",
    },
  };
  frame.root.children.push(textNode);
  const kit: BrandKitRecord = {
    schemaVersion: 1,
    id: randomUUID(),
    revision: 1,
    contentHash: `sha256:${"a".repeat(64)}`,
    name: "Exact Brand",
    createdAt: now,
    createdBy: "test",
    sourceProjectId: randomUUID(),
    provenance: "Verified fixture.",
    licenseNotes: "Internal fixture.",
    palette: [
      { key: "primary", name: "Primary", color: "#315CF5" },
      { key: "accent", name: "Accent", color: "#F0A24A" },
    ],
    typeRoles: [
      {
        key: "display",
        name: "Display",
        font: {
          id: sourceFontId,
          family: "Exact Display",
          style: "italic",
          weight: 700,
          format: "woff2",
          source: "project",
          path: `fonts/${sourceFontId}.woff2`,
          hash: `sha256:${"b".repeat(64)}`,
          licenseNotes: "Internal fixture.",
        },
        fontSize: 64,
        lineHeight: 70,
        letterSpacing: -1,
        colorToken: "primary",
      },
    ],
    effectStyles: [
      {
        key: "lifted",
        name: "Lifted",
        effects: {
          items: [
            {
              id: "brand-shadow",
              type: "outerShadow",
              enabled: true,
              offsetX: 0,
              offsetY: 12,
              blur: 24,
              spread: 0,
              color: "#000000",
              opacity: 0.4,
            },
          ],
        },
      },
    ],
    radiusTokens: [
      { key: "card", name: "Card", value: 24 },
      { key: "pill", name: "Pill", value: 999 },
    ],
    spacingTokens: [
      { key: "safe", name: "Safe", value: 48 },
      { key: "oversized", name: "Oversized", value: 400 },
    ],
    variableModes: [
      {
        key: "dark",
        name: "Dark",
        palette: [
          { tokenKey: "primary", color: "#90A8FF" },
          { tokenKey: "accent", color: "#FFD080" },
        ],
      },
    ],
    logos: [],
    definitions: [],
  };
  const pin = {
    kitId: kit.id,
    revision: kit.revision,
    contentHash: kit.contentHash,
    resourceMap: { [sourceFontId]: projectFontId },
  };
  return { frame, node, textNode, kit, pin, sourceFontId, projectFontId };
};

describe("live palette bindings", () => {
  it("materializes the exact pinned token and retains stable binding metadata", () => {
    const { frame, node, kit, pin } = fixture();
    const bindingId = randomUUID();
    const operations = compilePaletteTokenBinding({
      frame,
      kit,
      pin,
      binding: {
        bindingId,
        nodeId: node.id,
        property: "fill",
        tokenKey: "primary",
      },
    });
    expect(operations).toHaveLength(2);
    const simulation = simulateFrameOperations(frame, operations);
    const bound = findNode(simulation.frame, node.id);
    expect(bound).toMatchObject({
      id: node.id,
      fill: { type: "solid", color: "#315CF5", opacity: 0.8 },
      brandBindings: [
        {
          id: bindingId,
          property: "fill",
          kitId: kit.id,
          kitRevision: 1,
          kitContentHash: kit.contentHash,
          tokenKey: "primary",
        },
      ],
    });
    expect(() =>
      validateFrameBrandBindings({ frame: simulation.frame, pin, kit }),
    ).not.toThrow();

    const detached = simulateFrameOperations(
      simulation.frame,
      compilePaletteTokenUnbind({
        frame: simulation.frame,
        unbind: { nodeId: node.id, property: "fill" },
      }),
    );
    expect(findNode(detached.frame, node.id)).toMatchObject({
      fill: { type: "solid", color: "#315CF5", opacity: 0.8 },
    });
    expect(findNode(detached.frame, node.id)?.brandBindings).toBeUndefined();
    const rebound = simulateFrameOperations(
      detached.frame,
      detached.inverseOperations,
    ).frame;
    expect(findNode(rebound, node.id)?.brandBindings).toEqual([
      expect.objectContaining({ id: bindingId, property: "fill" }),
    ]);

    const undone = simulateFrameOperations(
      simulation.frame,
      simulation.inverseOperations,
    ).frame;
    expect(findNode(undone, node.id)).toMatchObject({
      fill: { type: "solid", color: "#FFFFFF", opacity: 0.8 },
    });
    expect(findNode(undone, node.id)?.brandBindings).toBeUndefined();
  });

  it("detaches only the directly edited bound property and restores it on undo", () => {
    const { frame, node, kit, pin } = fixture();
    const fillBindingId = randomUUID();
    const strokeBindingId = randomUUID();
    const fillBound = simulateFrameOperations(
      frame,
      compilePaletteTokenBinding({
        frame,
        kit,
        pin,
        binding: {
          bindingId: fillBindingId,
          nodeId: node.id,
          property: "fill",
          tokenKey: "primary",
        },
      }),
    ).frame;
    const fullyBound = simulateFrameOperations(
      fillBound,
      compilePaletteTokenBinding({
        frame: fillBound,
        kit,
        pin,
        binding: {
          bindingId: strokeBindingId,
          nodeId: node.id,
          property: "stroke",
          tokenKey: "accent",
        },
      }),
    ).frame;
    const direct = simulateFrameOperations(fullyBound, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "fill",
        value: {
          fill: { type: "solid", color: "#121212", opacity: 0.8 },
        },
      },
    ]);
    expect(findNode(direct.frame, node.id)?.brandBindings).toEqual([
      expect.objectContaining({ id: strokeBindingId, property: "stroke" }),
    ]);
    expect(() =>
      validateFrameBrandBindings({ frame: direct.frame, pin, kit }),
    ).not.toThrow();

    const undone = simulateFrameOperations(
      direct.frame,
      direct.inverseOperations,
    ).frame;
    expect(findNode(undone, node.id)?.brandBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fillBindingId, property: "fill" }),
        expect.objectContaining({ id: strokeBindingId, property: "stroke" }),
      ]),
    );
    expect(() =>
      validateFrameBrandBindings({ frame: undone, pin, kit }),
    ).not.toThrow();
  });

  it("rejects divergent values, pin changes, and duplicate property bindings", () => {
    const { frame, node, kit, pin } = fixture();
    const operations = compilePaletteTokenBinding({
      frame,
      kit,
      pin,
      binding: {
        bindingId: randomUUID(),
        nodeId: node.id,
        property: "fill",
        tokenKey: "primary",
      },
    });
    const bound = simulateFrameOperations(frame, operations).frame;
    const divergent = structuredClone(bound);
    const divergentNode = findNode(divergent, node.id);
    if (divergentNode?.type === "rectangle")
      divergentNode.fill = { type: "solid", color: "#000000", opacity: 0.8 };
    expect(() =>
      validateFrameBrandBindings({ frame: divergent, pin, kit }),
    ).toThrow(/diverges/);
    expect(() =>
      validateFrameBrandBindings({
        frame: bound,
        pin: { ...pin, revision: 2 },
        kit,
      }),
    ).toThrow(/exact immutable/);

    const duplicate = structuredClone(bound);
    findNode(duplicate, node.id)?.brandBindings?.push({
      ...findNode(duplicate, node.id)!.brandBindings![0]!,
      id: randomUUID(),
    });
    expect(() => FrameDocumentSchema.parse(duplicate)).toThrow(
      /only one Brand binding/,
    );
  });
});

describe("live typography bindings", () => {
  it("materializes the exact pinned type role without changing rich spans and detaches appearance-preservingly", () => {
    const { frame, textNode, kit, pin, projectFontId } = fixture();
    const bindingId = randomUUID();
    const simulation = simulateFrameOperations(
      frame,
      compileTypographyRoleBinding({
        frame,
        kit,
        pin,
        binding: {
          bindingId,
          nodeId: textNode.id,
          roleKey: "display",
        },
      }),
    );
    expect(findNode(simulation.frame, textNode.id)).toMatchObject({
      typography: {
        fontId: projectFontId,
        fontSize: 64,
        fontWeight: 700,
        fontStyle: "italic",
        lineHeight: 70,
        letterSpacing: -1,
        color: "#315CF5",
        alignment: "left",
        verticalAlignment: "top",
        opacity: 1,
      },
      spans: textNode.spans,
      brandBindings: [
        {
          id: bindingId,
          property: "typography",
          kitId: kit.id,
          kitRevision: kit.revision,
          kitContentHash: kit.contentHash,
          tokenKey: "display",
        },
      ],
    });
    expect(() =>
      validateFrameBrandBindings({ frame: simulation.frame, pin, kit }),
    ).not.toThrow();

    const detached = simulateFrameOperations(
      simulation.frame,
      compileTypographyRoleUnbind({
        frame: simulation.frame,
        unbind: { nodeId: textNode.id },
      }),
    );
    expect(findNode(detached.frame, textNode.id)).toMatchObject({
      typography: { fontId: projectFontId, fontSize: 64, color: "#315CF5" },
      spans: textNode.spans,
    });
    expect(
      findNode(detached.frame, textNode.id)?.brandBindings,
    ).toBeUndefined();
    const rebound = simulateFrameOperations(
      detached.frame,
      detached.inverseOperations,
    ).frame;
    expect(findNode(rebound, textNode.id)?.brandBindings).toEqual([
      expect.objectContaining({ id: bindingId, property: "typography" }),
    ]);

    const undone = simulateFrameOperations(
      simulation.frame,
      simulation.inverseOperations,
    ).frame;
    expect(findNode(undone, textNode.id)).toEqual(textNode);
  });

  it("detaches the typography role on a direct paragraph edit and restores it exactly on undo", () => {
    const { frame, textNode, kit, pin } = fixture();
    const bindingId = randomUUID();
    const bound = simulateFrameOperations(
      frame,
      compileTypographyRoleBinding({
        frame,
        kit,
        pin,
        binding: { bindingId, nodeId: textNode.id, roleKey: "display" },
      }),
    ).frame;
    const direct = simulateFrameOperations(bound, [
      {
        kind: "updateNode",
        nodeId: textNode.id,
        propertyGroup: "typography",
        value: { fontSize: 72 },
      },
    ]);
    expect(findNode(direct.frame, textNode.id)).toMatchObject({
      typography: { fontSize: 72 },
    });
    expect(findNode(direct.frame, textNode.id)?.brandBindings).toBeUndefined();
    expect(() =>
      validateFrameBrandBindings({ frame: direct.frame, pin, kit }),
    ).not.toThrow();

    const undone = simulateFrameOperations(
      direct.frame,
      direct.inverseOperations,
    ).frame;
    expect(findNode(undone, textNode.id)).toMatchObject({
      typography: { fontSize: 64 },
      brandBindings: [
        expect.objectContaining({ id: bindingId, property: "typography" }),
      ],
    });
    expect(() =>
      validateFrameBrandBindings({ frame: undone, pin, kit }),
    ).not.toThrow();
  });

  it("rejects missing font mappings, divergent role values, and incompatible targets", () => {
    const { frame, node, textNode, kit, pin } = fixture();
    expect(() =>
      compileTypographyRoleBinding({
        frame,
        kit,
        pin: { ...pin, resourceMap: {} },
        binding: {
          bindingId: randomUUID(),
          nodeId: textNode.id,
          roleKey: "display",
        },
      }),
    ).toThrow(/exact pinned resource map/);
    expect(() =>
      compileTypographyRoleBinding({
        frame,
        kit,
        pin,
        binding: {
          bindingId: randomUUID(),
          nodeId: node.id,
          roleKey: "display",
        },
      }),
    ).toThrow(/text nodes/);

    const bound = simulateFrameOperations(
      frame,
      compileTypographyRoleBinding({
        frame,
        kit,
        pin,
        binding: {
          bindingId: randomUUID(),
          nodeId: textNode.id,
          roleKey: "display",
        },
      }),
    ).frame;
    const divergent = structuredClone(bound);
    const divergentNode = findNode(divergent, textNode.id);
    if (divergentNode?.type === "text")
      divergentNode.typography.lineHeight = 80;
    expect(() =>
      validateFrameBrandBindings({ frame: divergent, pin, kit }),
    ).toThrow(/diverges from its exact type role/);
    expect(() => FrameDocumentSchema.parse(bound)).not.toThrow();
  });
});

describe("live effect-style bindings", () => {
  it("materializes an exact ordered effect style and detaches without changing appearance", () => {
    const { frame, node, kit, pin } = fixture();
    const bindingId = randomUUID();
    const simulation = simulateFrameOperations(
      frame,
      compileEffectStyleBinding({
        frame,
        kit,
        pin,
        binding: { bindingId, nodeId: node.id, styleKey: "lifted" },
      }),
    );
    expect(findNode(simulation.frame, node.id)).toMatchObject({
      effects: kit.effectStyles?.[0]?.effects,
      brandBindings: [
        {
          id: bindingId,
          property: "effects",
          tokenKey: "lifted",
          kitRevision: 1,
        },
      ],
    });
    expect(() =>
      validateFrameBrandBindings({ frame: simulation.frame, pin, kit }),
    ).not.toThrow();
    const detached = simulateFrameOperations(
      simulation.frame,
      compileEffectStyleUnbind({
        frame: simulation.frame,
        unbind: { nodeId: node.id },
      }),
    );
    expect(findNode(detached.frame, node.id)).toMatchObject({
      effects: kit.effectStyles?.[0]?.effects,
    });
    expect(findNode(detached.frame, node.id)?.brandBindings).toBeUndefined();
    expect(
      findNode(
        simulateFrameOperations(detached.frame, detached.inverseOperations)
          .frame,
        node.id,
      )?.brandBindings,
    ).toEqual([
      expect.objectContaining({ id: bindingId, property: "effects" }),
    ]);
  });

  it("detaches on a direct effect edit, restores on undo, and rejects divergence", () => {
    const { frame, node, kit, pin } = fixture();
    const bindingId = randomUUID();
    const bound = simulateFrameOperations(
      frame,
      compileEffectStyleBinding({
        frame,
        kit,
        pin,
        binding: { bindingId, nodeId: node.id, styleKey: "lifted" },
      }),
    ).frame;
    const direct = simulateFrameOperations(bound, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "effects",
        value: { effects: null },
      },
    ]);
    expect(findNode(direct.frame, node.id)?.brandBindings).toBeUndefined();
    const undone = simulateFrameOperations(
      direct.frame,
      direct.inverseOperations,
    ).frame;
    expect(findNode(undone, node.id)).toMatchObject({
      effects: kit.effectStyles?.[0]?.effects,
      brandBindings: [
        expect.objectContaining({ id: bindingId, property: "effects" }),
      ],
    });
    expect(() =>
      validateFrameBrandBindings({ frame: undone, pin, kit }),
    ).not.toThrow();
    const divergent = structuredClone(bound);
    const divergentNode = findNode(divergent, node.id);
    if (divergentNode && "effects" in divergentNode)
      divergentNode.effects = { items: [] };
    expect(() =>
      validateFrameBrandBindings({ frame: divergent, pin, kit }),
    ).toThrow(/diverge from its exact effect style/);
  });
});

describe("live radius-token bindings", () => {
  it("materializes one exact token across all corners and detaches appearance-preservingly", () => {
    const { frame, node, kit, pin } = fixture();
    const bindingId = randomUUID();
    const simulation = simulateFrameOperations(
      frame,
      compileRadiusTokenBinding({
        frame,
        kit,
        pin,
        binding: { bindingId, nodeId: node.id, tokenKey: "card" },
      }),
    );
    expect(findNode(simulation.frame, node.id)).toMatchObject({
      cornerRadius: {
        topLeft: 24,
        topRight: 24,
        bottomRight: 24,
        bottomLeft: 24,
      },
      brandBindings: [
        {
          id: bindingId,
          property: "radius",
          tokenKey: "card",
          kitRevision: 1,
        },
      ],
    });
    expect(() =>
      validateFrameBrandBindings({ frame: simulation.frame, pin, kit }),
    ).not.toThrow();
    const detached = simulateFrameOperations(
      simulation.frame,
      compileRadiusTokenUnbind({
        frame: simulation.frame,
        unbind: { nodeId: node.id },
      }),
    );
    expect(findNode(detached.frame, node.id)).toMatchObject({
      cornerRadius: { topLeft: 24, topRight: 24 },
    });
    expect(findNode(detached.frame, node.id)?.brandBindings).toBeUndefined();
    expect(
      findNode(
        simulateFrameOperations(detached.frame, detached.inverseOperations)
          .frame,
        node.id,
      )?.brandBindings,
    ).toEqual([expect.objectContaining({ id: bindingId, property: "radius" })]);
  });

  it("detaches on direct corner edits, restores on undo, and rejects divergence", () => {
    const { frame, node, kit, pin, textNode } = fixture();
    expect(() =>
      compileRadiusTokenBinding({
        frame,
        kit,
        pin,
        binding: {
          bindingId: randomUUID(),
          nodeId: textNode.id,
          tokenKey: "card",
        },
      }),
    ).toThrow(/rectangle corner radii/);
    const bound = simulateFrameOperations(
      frame,
      compileRadiusTokenBinding({
        frame,
        kit,
        pin,
        binding: {
          bindingId: randomUUID(),
          nodeId: node.id,
          tokenKey: "card",
        },
      }),
    ).frame;
    const direct = simulateFrameOperations(bound, [
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "shape",
        value: {
          cornerRadius: {
            topLeft: 8,
            topRight: 12,
            bottomRight: 16,
            bottomLeft: 20,
          },
        },
      },
    ]);
    expect(findNode(direct.frame, node.id)?.brandBindings).toBeUndefined();
    const undone = simulateFrameOperations(
      direct.frame,
      direct.inverseOperations,
    ).frame;
    expect(findNode(undone, node.id)).toMatchObject({
      cornerRadius: { topLeft: 24, bottomLeft: 24 },
      brandBindings: [expect.objectContaining({ property: "radius" })],
    });
    expect(() =>
      validateFrameBrandBindings({ frame: undone, pin, kit }),
    ).not.toThrow();
    const divergent = structuredClone(bound);
    const divergentNode = findNode(divergent, node.id);
    if (divergentNode?.type === "rectangle")
      divergentNode.cornerRadius.topLeft = 25;
    expect(() =>
      validateFrameBrandBindings({ frame: divergent, pin, kit }),
    ).toThrow(/diverge from its exact radius token/);
  });
});

describe("live spacing-token bindings", () => {
  it("materializes one exact token as the uniform canvas safe area and detaches appearance-preservingly", () => {
    const { frame, kit, pin } = fixture();
    const bindingId = randomUUID();
    const simulation = simulateFrameOperations(
      frame,
      compileSpacingTokenBinding({
        frame,
        kit,
        pin,
        binding: { bindingId, tokenKey: "safe" },
      }),
    );
    expect(simulation.frame.canvas).toMatchObject({
      safeArea: { top: 48, right: 48, bottom: 48, left: 48 },
      spacingBinding: {
        id: bindingId,
        property: "safeArea",
        tokenKey: "safe",
        kitRevision: 1,
      },
    });
    expect(() =>
      validateFrameBrandBindings({ frame: simulation.frame, pin, kit }),
    ).not.toThrow();
    const detached = simulateFrameOperations(
      simulation.frame,
      compileSpacingTokenUnbind({ frame: simulation.frame, unbind: {} }),
    );
    expect(detached.frame.canvas.safeArea).toEqual({
      top: 48,
      right: 48,
      bottom: 48,
      left: 48,
    });
    expect(detached.frame.canvas.spacingBinding).toBeUndefined();
    expect(
      simulateFrameOperations(detached.frame, detached.inverseOperations).frame
        .canvas.spacingBinding,
    ).toEqual(expect.objectContaining({ id: bindingId, tokenKey: "safe" }));
  });

  it("detaches on direct inset edits, restores on undo, and rejects invalid or divergent values", () => {
    const { frame, node, kit, pin } = fixture();
    expect(() =>
      compileSpacingTokenBinding({
        frame,
        kit,
        pin,
        binding: { bindingId: randomUUID(), tokenKey: "oversized" },
      }),
    ).toThrow(/positive canvas safe-area interior/);
    const bindingId = randomUUID();
    const bound = simulateFrameOperations(
      frame,
      compileSpacingTokenBinding({
        frame,
        kit,
        pin,
        binding: { bindingId, tokenKey: "safe" },
      }),
    ).frame;
    const direct = simulateFrameOperations(bound, [
      {
        kind: "setCanvas",
        value: {
          safeArea: { top: 32, right: 48, bottom: 48, left: 48 },
        },
      },
    ]);
    expect(direct.frame.canvas.spacingBinding).toBeUndefined();
    const undone = simulateFrameOperations(
      direct.frame,
      direct.inverseOperations,
    ).frame;
    expect(undone.canvas).toMatchObject({
      safeArea: { top: 48, right: 48, bottom: 48, left: 48 },
      spacingBinding: { id: bindingId, tokenKey: "safe" },
    });
    expect(() =>
      validateFrameBrandBindings({ frame: undone, pin, kit }),
    ).not.toThrow();

    const divergent = structuredClone(bound);
    divergent.canvas.safeArea!.left = 47;
    expect(() =>
      validateFrameBrandBindings({ frame: divergent, pin, kit }),
    ).toThrow(/diverges from its exact spacing token/);

    const duplicateId = structuredClone(bound);
    const duplicateNode = findNode(duplicateId, node.id);
    if (duplicateNode)
      duplicateNode.brandBindings = [
        {
          id: bindingId,
          property: "fill",
          kitId: kit.id,
          kitRevision: 1,
          kitContentHash: kit.contentHash,
          tokenKey: "primary",
        },
      ];
    expect(() => FrameDocumentSchema.parse(duplicateId)).toThrow(
      /Brand binding IDs must be unique/,
    );
  });
});

describe("live palette variable modes", () => {
  it("materializes one exact frame mode across bound palette values and restores base values", () => {
    const { frame, node, kit, pin } = fixture();
    const bindingId = randomUUID();
    const bound = simulateFrameOperations(
      frame,
      compilePaletteTokenBinding({
        frame,
        kit,
        pin,
        binding: {
          bindingId,
          nodeId: node.id,
          property: "fill",
          tokenKey: "primary",
        },
      }),
    ).frame;
    const dark = simulateFrameOperations(
      bound,
      compileVariableMode({
        frame: bound,
        kit,
        pin,
        mode: { modeKey: "dark" },
      }),
    );
    expect(dark.frame.brandMode).toMatchObject({
      modeKey: "dark",
      kitRevision: 1,
    });
    expect(findNode(dark.frame, node.id)).toMatchObject({
      fill: { color: "#90A8FF" },
      brandBindings: [{ id: bindingId, tokenKey: "primary" }],
    });
    expect(() =>
      validateFrameBrandBindings({ frame: dark.frame, pin, kit }),
    ).not.toThrow();

    const base = simulateFrameOperations(
      dark.frame,
      compileVariableMode({
        frame: dark.frame,
        kit,
        pin,
        mode: { modeKey: null },
      }),
    ).frame;
    expect(base.brandMode).toBeUndefined();
    expect(findNode(base, node.id)).toMatchObject({
      fill: { color: "#315CF5" },
      brandBindings: [{ id: bindingId, tokenKey: "primary" }],
    });
  });

  it("rejects unknown modes and divergent materialized mode values", () => {
    const { frame, node, kit, pin } = fixture();
    expect(() =>
      compileVariableMode({
        frame,
        kit,
        pin,
        mode: { modeKey: "missing" },
      }),
    ).toThrow(/not found/);
    const bound = simulateFrameOperations(
      frame,
      compilePaletteTokenBinding({
        frame,
        kit,
        pin,
        binding: {
          bindingId: randomUUID(),
          nodeId: node.id,
          property: "fill",
          tokenKey: "primary",
        },
      }),
    ).frame;
    const dark = simulateFrameOperations(
      bound,
      compileVariableMode({
        frame: bound,
        kit,
        pin,
        mode: { modeKey: "dark" },
      }),
    ).frame;
    const divergent = structuredClone(dark);
    const divergentNode = findNode(divergent, node.id);
    if (divergentNode?.type === "rectangle")
      divergentNode.fill = { type: "solid", color: "#000000", opacity: 0.8 };
    expect(() =>
      validateFrameBrandBindings({ frame: divergent, pin, kit }),
    ).toThrow(/diverges/);
  });
});
