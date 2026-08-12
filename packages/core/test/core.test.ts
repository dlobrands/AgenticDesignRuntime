import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  FrameDocumentSchema,
  TransactionRequestSchema,
  createFrameDocument,
  createTransform,
  semanticFrameHash,
  simulateFrameOperations,
  stableStringify,
  validateFrame,
  type FrameDocument,
  type RasterImageNode,
  type RectangleNode,
  type SemanticOperation,
} from "../src/index.js";

const rectangle = (name = "Rectangle"): RectangleNode => ({
  id: randomUUID(),
  type: "rectangle",
  name,
  visible: true,
  locked: false,
  transform: createTransform({ x: 10, y: 20, width: 200, height: 120 }),
  opacity: 1,
  blendMode: "normal",
  fill: { type: "solid", color: "#3366FF", opacity: 1 },
  cornerRadius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
});

const frame = (): FrameDocument =>
  createFrameDocument({
    id: randomUUID(),
    slug: "launch-post",
    name: "Launch Post",
    width: 1080,
    height: 1350,
    now: "2026-08-05T12:00:00.000Z",
  });

describe("scene operations", () => {
  const expectReversible = async (
    source: FrameDocument,
    operations: SemanticOperation[],
  ) => {
    const before = await semanticFrameHash(source);
    const changed = simulateFrameOperations(source, operations);
    const restored = simulateFrameOperations(
      changed.frame,
      changed.inverseOperations,
    );
    expect(await semanticFrameHash(restored.frame)).toBe(before);
    return changed;
  };

  it("applies an operation and its inverse to recover semantic state", async () => {
    const source = frame();
    const node = rectangle("CTA");
    source.root.children.push(node);
    const before = await semanticFrameHash(source);
    const operation: SemanticOperation = {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "transform",
      value: { x: 400, rotation: 12 },
    };
    const changed = simulateFrameOperations(source, [operation]);
    const restored = simulateFrameOperations(
      changed.frame,
      changed.inverseOperations,
    );
    expect(await semanticFrameHash(restored.frame)).toBe(before);
  });

  it("groups and ungroups siblings without changing their effective placement", async () => {
    const source = frame();
    const first = rectangle("First");
    const second = rectangle("Second");
    second.transform.x = 400;
    source.root.children.push(first, second);
    const groupId = randomUUID();
    const grouped = simulateFrameOperations(source, [
      {
        kind: "groupNodes",
        nodeIds: [first.id, second.id],
        groupId,
        name: "Pair",
      },
    ]);
    expect(grouped.frame.root.children[0]?.type).toBe("group");
    const restored = simulateFrameOperations(
      grouped.frame,
      grouped.inverseOperations,
    );
    expect(await semanticFrameHash(restored.frame)).toBe(
      await semanticFrameHash(source),
    );
  });

  it("rejects duplicate IDs and hard node limits", () => {
    const source = frame();
    const shared = rectangle();
    source.root.children.push(shared, structuredClone(shared));
    expect(validateFrame(source).errors[0]?.code).toBe("DUPLICATE_NODE_ID");

    const large = frame();
    large.root.children = Array.from({ length: 501 }, (_, index) =>
      rectangle(`Node ${index}`),
    );
    expect(
      validateFrame(large).errors.some(
        (issue) => issue.code === "FRAME_LIMIT_EXCEEDED",
      ),
    ).toBe(true);
  });

  it("rejects raster and SVG nodes that reference the wrong asset type", () => {
    const source = frame();
    const svgAssetId = randomUUID();
    const rasterAssetId = randomUUID();
    const rasterNode: RasterImageNode = {
      id: randomUUID(),
      type: "rasterImage",
      name: "Wrong raster",
      visible: true,
      locked: false,
      transform: createTransform({ width: 100, height: 100 }),
      opacity: 1,
      blendMode: "normal",
      assetId: svgAssetId,
      fit: "contain",
    };
    source.root.children.push(rasterNode, {
      id: randomUUID(),
      type: "svg",
      name: "Wrong vector",
      visible: true,
      locked: false,
      transform: createTransform({ width: 100, height: 100 }),
      opacity: 1,
      blendMode: "normal",
      assetId: rasterAssetId,
      intrinsicSize: { width: 100, height: 100 },
    });
    const result = validateFrame(source, {
      assets: [
        {
          id: svgAssetId,
          type: "svg",
          path: `assets/${svgAssetId}.svg`,
          mimeType: "image/svg+xml",
          hash: `sha256:${"a".repeat(64)}`,
          sizeBytes: 100,
          width: 100,
          height: 100,
        },
        {
          id: rasterAssetId,
          type: "raster",
          path: `assets/${rasterAssetId}.png`,
          mimeType: "image/png",
          hash: `sha256:${"b".repeat(64)}`,
          sizeBytes: 100,
          width: 100,
          height: 100,
        },
      ],
    });
    expect(
      result.errors.filter((issue) => issue.code === "ASSET_TYPE_MISMATCH"),
    ).toHaveLength(2);
  });

  it("semantic hashes ignore revision metadata", async () => {
    const first = frame();
    const second = structuredClone(first);
    second.revision = 20;
    second.updatedAt = "2026-08-05T13:00:00.000Z";
    expect(await semanticFrameHash(first)).toBe(
      await semanticFrameHash(second),
    );
  });

  it("reverses create, duplicate, move, reorder, and delete without losing order", async () => {
    const source = frame();
    const first = rectangle("First");
    const second = rectangle("Second");
    second.transform.x = 300;
    source.root.children.push(first, second);

    await expectReversible(source, [
      {
        kind: "duplicateNode",
        nodeId: first.id,
        idMap: { [first.id]: randomUUID() },
        offset: { x: 24, y: 24 },
      },
    ]);
    await expectReversible(source, [
      { kind: "reorderNode", nodeId: first.id, index: 1 },
    ]);
    await expectReversible(source, [{ kind: "deleteNode", nodeId: first.id }]);
    await expectReversible(frame(), [
      { kind: "createNode", parentId: "root", node: first },
    ]);
  });

  it("reverses masks and adjustments with stable targets and sources", async () => {
    const source = frame();
    const content = rectangle("Content");
    source.root.children.push(content);
    const maskSource = rectangle("Mask source");
    maskSource.id = randomUUID();
    const masked = await expectReversible(source, [
      {
        kind: "applyMask",
        maskId: randomUUID(),
        name: "Alpha mask",
        mode: "alpha",
        inverted: false,
        maskSource,
        nodeIds: [content.id],
      },
    ]);
    expect(masked.frame.root.children[0]?.type).toBe("mask");

    const adjustmentId = randomUUID();
    const adjusted = await expectReversible(source, [
      {
        kind: "addAdjustment",
        adjustment: {
          id: adjustmentId,
          type: "adjustment",
          name: "Tone",
          visible: true,
          locked: false,
          transform: createTransform({ width: 1, height: 1 }),
          enabled: true,
          targetId: "root",
          values: {
            brightness: 0.1,
            contrast: 0.2,
            saturation: -0.1,
            hue: 5,
            blur: 0,
          },
        },
      },
      {
        kind: "setAdjustment",
        adjustmentId,
        values: { contrast: 0.5 },
      },
      { kind: "toggleAdjustment", adjustmentId, enabled: false },
    ]);
    expect(adjusted.frame.root.children.at(-1)).toMatchObject({
      id: adjustmentId,
      type: "adjustment",
      enabled: false,
      targetId: "root",
    });
  });

  it("builds masks from the common-parent union and restores moved children", async () => {
    const source = frame();
    const first = rectangle("Left");
    first.transform.x = 180;
    first.transform.y = 260;
    const second = rectangle("Right");
    second.transform.x = 520;
    second.transform.y = 410;
    second.transform.width = 140;
    second.transform.height = 90;
    source.root.children.push(first, second);
    const before = await semanticFrameHash(source);
    const maskSource = rectangle("Mask source");
    maskSource.id = randomUUID();
    const changed = simulateFrameOperations(source, [
      {
        kind: "applyMask",
        maskId: randomUUID(),
        name: "Union mask",
        mode: "alpha",
        inverted: false,
        maskSource,
        nodeIds: [first.id, second.id],
      },
    ]);
    const mask = changed.frame.root.children[0];
    expect(mask).toMatchObject({
      type: "mask",
      transform: { x: 180, y: 260, width: 480, height: 240 },
      maskSource: { transform: { x: 0, y: 0, width: 480, height: 240 } },
    });
    if (mask?.type !== "mask") throw new Error("Expected a mask.");
    expect(
      mask.children.map((node) => [node.transform.x, node.transform.y]),
    ).toEqual([
      [0, 0],
      [340, 150],
    ]);
    const restored = simulateFrameOperations(
      changed.frame,
      changed.inverseOperations,
    );
    expect(await semanticFrameHash(restored.frame)).toBe(before);
  });

  it("rejects adjustments on shape and text nodes", () => {
    const source = frame();
    const shape = rectangle();
    source.root.children.push(shape);
    expect(() =>
      simulateFrameOperations(source, [
        {
          kind: "addAdjustment",
          adjustment: {
            id: randomUUID(),
            type: "adjustment",
            name: "Invalid target",
            visible: true,
            locked: false,
            transform: createTransform({ width: 1, height: 1 }),
            enabled: true,
            targetId: shape.id,
            values: {
              brightness: 0,
              contrast: 0,
              saturation: 0,
              hue: 0,
              blur: 0,
            },
          },
        },
      ]),
    ).toThrow(/image, SVG, group, or mask/);
  });

  it("rejects free-form update payloads and mutations of the root identity", () => {
    const request = {
      schemaVersion: 1,
      mode: "commit",
      runtimeId: randomUUID(),
      workspaceId: randomUUID(),
      scope: {
        kind: "frame",
        projectId: randomUUID(),
        frameId: randomUUID(),
      },
      baseRevision: 0,
      actor: { source: "http", id: "schema-test" },
      operations: [
        {
          kind: "updateNode",
          nodeId: randomUUID(),
          propertyGroup: "transform",
          value: { x: 1, arbitraryRendererCommand: "execute" },
        },
      ],
    };
    expect(TransactionRequestSchema.safeParse(request).success).toBe(false);
    expect(() =>
      simulateFrameOperations(frame(), [
        {
          kind: "updateNode",
          nodeId: "root",
          propertyGroup: "visibility",
          value: { visible: false },
        } as unknown as SemanticOperation,
      ]),
    ).toThrowError();
  });

  it("makes the deprecated clipContent false contract explicit", () => {
    const clipped = frame();
    const partial = rectangle("Partially outside");
    partial.transform.x = -40;
    clipped.root.children.push(partial);
    const clippedReport = validateFrame(clipped);
    expect(clippedReport.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONTENT_OUTSIDE_ARTBOARD",
          message: expect.stringContaining(
            "clipped in Studio preview and export",
          ),
          nodeIds: [partial.id],
        }),
      ]),
    );

    const legacy = structuredClone(clipped);
    legacy.canvas.clipContent = false;
    const legacyReport = validateFrame(legacy);
    expect(legacyReport.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CLIP_CONTENT_DEPRECATED" }),
        expect.objectContaining({
          code: "CONTENT_OUTSIDE_ARTBOARD",
          message: expect.stringContaining(
            "deprecated clipContent: false value does not preserve it",
          ),
        }),
      ]),
    );
  });
});

describe("document invariants", () => {
  it("serializes and parses semantically identical valid documents", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 4096 }),
        (width, height) => {
          const source = createFrameDocument({
            id: randomUUID(),
            slug: "generated-frame",
            name: "Generated Frame",
            width,
            height,
            now: "2026-08-05T12:00:00.000Z",
          });
          const parsed = FrameDocumentSchema.parse(
            JSON.parse(stableStringify(source)),
          );
          expect(parsed).toEqual(source);
        },
      ),
    );
  });
});
