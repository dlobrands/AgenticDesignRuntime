import { describe, expect, it } from "vitest";
import {
  ExportPresetSchema,
  createFrameDocument,
  exportDimensions,
  exportSupportsTransparency,
  normalizeExportSettings,
} from "../src/index.js";

const frame = createFrameDocument({
  id: "00000000-0000-4000-8000-000000000001",
  slug: "social",
  name: "Social",
  width: 1080,
  height: 1350,
  now: "2026-08-10T12:00:00.000Z",
});

describe("export contracts", () => {
  it("normalizes backward-compatible PNG settings", () => {
    expect(normalizeExportSettings()).toEqual({ format: "png", scale: 1 });
  });

  it("defaults lossy quality and calculates scaled dimensions", () => {
    const settings = normalizeExportSettings({ format: "webp", scale: 2 });
    expect(settings).toEqual({ format: "webp", scale: 2, quality: 90 });
    expect(exportDimensions(frame, settings)).toEqual({
      width: 2160,
      height: 2700,
    });
  });

  it("rejects lossy quality on PNG presets", () => {
    expect(
      ExportPresetSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000002",
        name: "Invalid PNG",
        format: "png",
        scale: 1,
        quality: 90,
      }).success,
    ).toBe(false);
    expect(() =>
      normalizeExportSettings({ format: "png", scale: 1, quality: 90 }),
    ).toThrow(/PNG export does not accept/);
    expect(() =>
      normalizeExportSettings({
        format: "webp",
        scale: 1,
        matteColor: "#FFFFFF",
      }),
    ).toThrow(/Only JPEG export accepts/);
  });

  it("reports alpha eligibility from canonical canvas and format", () => {
    frame.canvas.background = { type: "transparent" };
    expect(exportSupportsTransparency(frame, { format: "png", scale: 1 })).toBe(
      true,
    );
    expect(
      exportSupportsTransparency(frame, {
        format: "jpeg",
        scale: 1,
        quality: 90,
      }),
    ).toBe(false);
  });
});
