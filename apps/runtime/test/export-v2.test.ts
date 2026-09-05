import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createFrameDocument, type FontRecord } from "@tva-agentic-design/core";
import { createCmykPdf } from "../src/cmyk-pdf.js";
import { exportHybridSvg, exportVectorSvg } from "../src/svg-export.js";

describe("ADR v2 document exports", () => {
  it("exports a safe vector-only SVG and reports a truthful hybrid fallback", () => {
    const frame = createFrameDocument({
      id: "00000000-0000-4000-8000-000000000201",
      slug: "vector",
      name: "Vector",
      width: 320,
      height: 240,
      now: "2026-08-27T12:00:00.000Z",
    });
    frame.root.children.push({
      id: "00000000-0000-4000-8000-000000000202",
      type: "vectorPath",
      name: "Arc",
      visible: true,
      locked: false,
      transform: {
        x: 20,
        y: 20,
        width: 200,
        height: 120,
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
      fillRule: "evenodd",
      fill: { type: "solid", color: "#315CF5", opacity: 1 },
      commands: [
        { id: "m", kind: "move", to: { x: 0, y: 0.5 } },
        {
          id: "a",
          kind: "arc",
          radius: { x: 0.5, y: 0.5 },
          rotation: 0,
          largeArc: false,
          sweep: true,
          to: { x: 1, y: 0.5 },
        },
        { id: "z", kind: "close" },
      ],
    });
    const vector = exportVectorSvg(frame, [] as FontRecord[]);
    expect(vector.source).toContain("<path");
    expect(vector.source).toContain('fill-rule="evenodd"');
    expect(vector.source).toContain("A 100 60 0 0 1 200 60");
    expect(vector.rasterizedNodeIds).toEqual([]);

    const hybrid = exportHybridSvg(frame, "data:image/png;base64,AA==");
    expect(hybrid.fullyRasterized).toBe(true);
    expect(hybrid.rasterizedNodeIds).toEqual([
      "00000000-0000-4000-8000-000000000202",
    ]);

    frame.root.children.unshift({
      id: "00000000-0000-4000-8000-000000000205",
      type: "rasterImage",
      name: "Raster base",
      visible: true,
      locked: false,
      transform: {
        x: 0,
        y: 0,
        width: 320,
        height: 240,
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
      assetId: "00000000-0000-4000-8000-000000000206",
      fit: "fill",
    });
    const partial = exportHybridSvg(frame, "data:image/png;base64,AA==", 0);
    expect(partial.fullyRasterized).toBe(false);
    expect(partial.source).toContain("<image");
    expect(partial.source).toContain("<path");
  });

  it("creates a flattened ICCBased CMYK PDF with exact page boxes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "adr-cmyk-pdf-"));
    const seed = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 120, g: 60, b: 200, alpha: 1 },
      },
    })
      .withIccProfile("cmyk", { attach: true })
      .toColourspace("cmyk")
      .jpeg()
      .toBuffer();
    const profile = (await sharp(seed).metadata()).icc;
    if (!profile)
      throw new Error("Sharp did not expose its built-in CMYK profile.");
    const profilePath = path.join(directory, "fixture.icc");
    await writeFile(profilePath, profile);
    const png = await sharp({
      create: {
        width: 96,
        height: 96,
        channels: 4,
        background: { r: 240, g: 120, b: 40, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const result = await createCmykPdf({
      png,
      iccProfilePath: profilePath,
      trimWidthPixels: 96,
      trimHeightPixels: 96,
      dpi: 300,
      bleedMm: 3,
      cropMarks: true,
      title: "CMYK fixture",
    });
    const document = await PDFDocument.load(result.bytes);
    expect(document.getPageCount()).toBe(1);
    expect(result.trimBox[0]).toBeGreaterThan(0);
    expect(Buffer.from(result.bytes).toString("latin1")).toContain("/ICCBased");
    expect(await sharp(result.cmykJpeg).metadata()).toMatchObject({
      space: "cmyk",
      channels: 4,
      hasProfile: true,
    });
  });
});
