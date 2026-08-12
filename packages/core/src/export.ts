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
    quality: format === "png" ? parsed.quality : (parsed.quality ?? 90),
    matteColor: parsed.matteColor,
  });
};

export const exportSupportsTransparency = (
  frame: FrameDocument,
  settings: ExportSettings,
): boolean =>
  frame.canvas.background.type === "transparent" &&
  (settings.format === "png" || settings.format === "webp");

export const exportDimensions = (
  frame: FrameDocument,
  settings: ExportSettings,
): { width: number; height: number } => ({
  width: Math.max(1, Math.round(frame.canvas.width * settings.scale)),
  height: Math.max(1, Math.round(frame.canvas.height * settings.scale)),
});
