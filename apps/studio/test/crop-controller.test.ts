import { describe, expect, it } from "vitest";
import {
  beginCropEdit,
  cropEditFitsSessionScope,
  cropEditOperation,
  cropResolution,
  panCropSource,
  resetCropEdit,
  scaleCropSource,
} from "../src/crop-controller";
import type { RasterImageNode } from "@tva-agentic-design/core";

const node = (): RasterImageNode => ({
  id: "11111111-1111-4111-8111-111111111111",
  type: "rasterImage",
  name: "Campaign subject",
  visible: true,
  locked: false,
  transform: {
    x: 20,
    y: 30,
    width: 400,
    height: 300,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    anchorX: 0,
    anchorY: 0,
  },
  opacity: 1,
  blendMode: "normal",
  assetId: "22222222-2222-4222-8222-222222222222",
  fit: "contain",
  crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
});

describe("crop edit controller", () => {
  it("pans and scales the source while keeping the crop inside the asset", () => {
    const session = beginCropEdit({
      projectId: "project",
      frameId: "frame",
      revision: 4,
      node: node(),
    });
    const panned = panCropSource(
      session,
      { x: 100, y: -200 },
      {
        width: 400,
        height: 300,
      },
    );
    expect(panned.crop.x).toBe(0);
    expect(panned.crop.y).toBeCloseTo(0.2);
    expect(panned.crop.width).toBe(0.8);
    expect(panned.crop.height).toBe(0.8);
    const scaled = scaleCropSource(panned, 2);
    expect(scaled.crop.x).toBeCloseTo(0.2);
    expect(scaled.crop.y).toBeCloseTo(0.4);
    expect(scaled.crop.width).toBeCloseTo(0.4);
    expect(scaled.crop.height).toBeCloseTo(0.4);
  });

  it("creates one reversible canonical crop operation and resets explicitly", () => {
    const session = beginCropEdit({
      projectId: "project",
      frameId: "frame",
      revision: 4,
      node: node(),
    });
    expect(cropEditOperation(session)).toMatchObject({
      kind: "updateNode",
      propertyGroup: "crop",
      value: { fit: "cover" },
    });
    expect(cropEditOperation(resetCropEdit(session))).toEqual({
      kind: "updateNode",
      nodeId: node().id,
      propertyGroup: "crop",
      value: { crop: null, fit: "cover" },
    });
  });

  it("preserves scope and reports effective source resolution", () => {
    const session = beginCropEdit({
      projectId: "project",
      frameId: "frame",
      revision: 4,
      node: node(),
    });
    expect(cropEditFitsSessionScope(session, "project", "frame")).toBe(true);
    expect(cropEditFitsSessionScope(session, "project", "other")).toBe(false);
    expect(
      cropResolution({
        node: node(),
        asset: { width: 300, height: 200 },
        crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      }),
    ).toMatchObject({
      sourceWidth: 150,
      sourceHeight: 100,
      displayWidth: 400,
      displayHeight: 300,
      lowResolution: true,
    });
  });
});
