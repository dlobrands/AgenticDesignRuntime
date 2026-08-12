import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  auditBrandFrame,
  createFrameDocument,
  createTransform,
  type BrandKitRecord,
  type RectangleNode,
} from "../src/index.js";

const kit = (): BrandKitRecord => ({
  schemaVersion: 1,
  id: randomUUID(),
  revision: 1,
  contentHash: `sha256:${"a".repeat(64)}`,
  name: "Signal",
  createdAt: "2026-08-11T00:00:00.000Z",
  createdBy: "test",
  sourceProjectId: randomUUID(),
  provenance: "Verified fixture",
  licenseNotes: "Internal",
  palette: [{ key: "signal", name: "Color 1", color: "#315BFF" }],
  typeRoles: [],
  logos: [],
  definitions: [],
});

describe("deterministic Brand lint", () => {
  it("separates generic organization and unbound-token findings", () => {
    const brand = kit();
    const frame = createFrameDocument({
      id: randomUUID(),
      slug: "lint",
      name: "Lint",
      width: 1080,
      height: 1080,
      now: "2026-08-11T00:00:00.000Z",
    });
    const node: RectangleNode = {
      id: randomUUID(),
      type: "rectangle",
      name: "Card",
      visible: true,
      locked: false,
      transform: createTransform(),
      opacity: 1,
      blendMode: "normal",
      fill: { type: "solid", color: "#315bff", opacity: 1 },
      cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    };
    frame.root.children.push(node);
    const report = auditBrandFrame({
      frame,
      pin: {
        kitId: brand.id,
        revision: brand.revision,
        contentHash: brand.contentHash,
        resourceMap: {},
      },
      kit: brand,
    });
    expect(report.deterministic).toBe(true);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "GENERIC_TOKEN_NAME" }),
        expect.objectContaining({
          code: "UNBOUND_TOKEN_VALUE",
          nodeId: node.id,
          property: "fill",
        }),
      ]),
    );
    expect(report.summary).toMatchObject({ errors: 0, warnings: 1, info: 1 });
  });

  it("does not report a live-bound matching value as unbound", () => {
    const brand = kit();
    brand.palette[0]!.name = "Primary signal";
    const frame = createFrameDocument({
      id: randomUUID(),
      slug: "bound",
      name: "Bound",
      width: 1080,
      height: 1080,
      now: "2026-08-11T00:00:00.000Z",
    });
    frame.root.children.push({
      id: randomUUID(),
      type: "rectangle",
      name: "Card",
      visible: true,
      locked: false,
      transform: createTransform(),
      opacity: 1,
      blendMode: "normal",
      fill: { type: "solid", color: "#315BFF", opacity: 1 },
      cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
      brandBindings: [
        {
          id: randomUUID(),
          kitId: brand.id,
          kitRevision: brand.revision,
          kitContentHash: brand.contentHash,
          property: "fill",
          tokenKey: "signal",
        },
      ],
    });
    const report = auditBrandFrame({
      frame,
      pin: {
        kitId: brand.id,
        revision: brand.revision,
        contentHash: brand.contentHash,
        resourceMap: {},
      },
      kit: brand,
    });
    expect(report.findings).toEqual([]);
  });
});
