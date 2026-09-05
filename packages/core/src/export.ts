import type { ExportSettings, FrameDocument } from "./model.js";
import { ExportSettingsInputSchema, ExportSettingsSchema } from "./schema.js";

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: "png",
  scale: 1,
};

export const normalizeExportSettings = (
  input?: Partial<ExportSettings>,
): ExportSettings => {
  const parsed = ExportSettingsInputSchema.parse(input ?? {});
  const format = parsed.format ?? DEFAULT_EXPORT_SETTINGS.format;
  return ExportSettingsSchema.parse({
    format,
    scale: parsed.scale ?? DEFAULT_EXPORT_SETTINGS.scale,
    quality:
      format === "jpeg" || format === "webp"
        ? (parsed.quality ?? 90)
        : parsed.quality,
    matteColor: parsed.matteColor,
    ...(format === "svg" ? { svgMode: parsed.svgMode ?? "vectorOnly" } : {}),
    ...(format === "pdf"
      ? {
          dpi: parsed.dpi ?? 300,
          outputIccProfileId: parsed.outputIccProfileId,
          bleedMm: parsed.bleedMm ?? 0,
          cropMarks: parsed.cropMarks ?? false,
        }
      : {}),
  });
};

export const exportSupportsTransparency = (
  frame: FrameDocument,
  settings: ExportSettings,
): boolean =>
  frame.canvas.background.type === "transparent" &&
  (settings.format === "png" ||
    settings.format === "webp" ||
    settings.format === "svg");

export const exportDimensions = (
  frame: FrameDocument,
  settings: ExportSettings,
): { width: number; height: number } => ({
  width: Math.max(
    1,
    Math.round(
      frame.canvas.width *
        (settings.format === "pdf"
          ? (settings.dpi ?? 300) / 96
          : settings.scale),
    ),
  ),
  height: Math.max(
    1,
    Math.round(
      frame.canvas.height *
        (settings.format === "pdf"
          ? (settings.dpi ?? 300) / 96
          : settings.scale),
    ),
  ),
});
