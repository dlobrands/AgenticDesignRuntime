export const WARNING_CODES = [
  "TEXT_OVERFLOW",
  "LOW_RESOLUTION_ASSET",
  "CONTENT_OUTSIDE_ARTBOARD",
  "CLIP_CONTENT_DEPRECATED",
  "FRAME_COMPLEXITY_WARNING",
  "HIGH_COMPLEXITY_SCORE",
  "SLOW_TRANSACTION",
  "SLOW_RELOAD",
  "SLOW_EXPORT",
  "HIGH_TEXTURE_MEMORY",
  "MISSING_OPTIONAL_PREVIEW",
  "RENDER_ENVIRONMENT_CHANGED",
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];
export type FrameWarning = {
  code: WarningCode;
  message: string;
  nodeIds?: string[];
  details?: Record<string, unknown>;
};
