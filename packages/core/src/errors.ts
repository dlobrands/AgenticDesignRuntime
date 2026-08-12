export const ERROR_CODES = [
  "WORKSPACE_NOT_FOUND",
  "WORKSPACE_NOT_INITIALIZED",
  "WORKSPACE_IN_USE",
  "WORKSPACE_MISMATCH",
  "PATH_OUTSIDE_WORKSPACE",
  "PATH_TRAVERSAL_REJECTED",
  "SCHEMA_VERSION_UNSUPPORTED",
  "PROJECT_FILE_INVALID",
  "FRAME_FILE_INVALID",
  "NODE_NOT_FOUND",
  "DUPLICATE_NODE_ID",
  "INVALID_PARENT",
  "NODE_LOCKED",
  "MASK_CYCLE",
  "ADJUSTMENT_CYCLE",
  "INVALID_OPERATION",
  "INVALID_PROPERTY_GROUP",
  "INVALID_GRADIENT",
  "INVALID_DASH_PATTERN",
  "DASH_PATTERN_TOO_LONG",
  "INVALID_DASH_VALUE",
  "INVALID_DASH_CAP",
  "ASSET_NOT_FOUND",
  "ASSET_TYPE_MISMATCH",
  "ASSET_HASH_MISMATCH",
  "FONT_MISSING",
  "FONT_HASH_MISMATCH",
  "FONT_IN_USE",
  "UNSAFE_SVG",
  "SVG_TEXT_UNSUPPORTED",
  "RASTER_LIMIT_EXCEEDED",
  "RENDER_CAPABILITY_EXCEEDED",
  "FRAME_LIMIT_EXCEEDED",
  "FRAME_VALIDATION_FAILED",
  "STALE_REVISION",
  "SEMANTIC_CONFLICT",
  "STALE_PREVIEW",
  "STALE_EXTERNAL_EDIT",
  "EXTERNAL_EDIT_NOT_REPRESENTABLE",
  "FRAME_WRITE_FAILED",
  "HISTORY_APPEND_FAILED",
  "HISTORY_HASH_MISMATCH",
  "HISTORY_RECOVERY_REQUIRED",
  "EXPORT_BLOCKED",
  "EXPORT_FAILED",
  "RENDERER_CONTEXT_LOST",
  "INVALID_ORIGIN",
  "INVALID_HOST",
  "INVALID_RUNTIME_CAPABILITY",
  "UPDATE_NOT_CONFIGURED",
  "UPDATE_ORIGIN_REJECTED",
  "UPDATE_MANIFEST_INVALID",
  "UPDATE_SIGNATURE_INVALID",
  "UPDATE_ARTIFACT_INVALID",
  "UPDATE_INCOMPATIBLE",
  "UPDATE_REPLAY_REJECTED",
  "UPDATE_RUNNING",
  "UPDATE_HEALTH_FAILED",
  "UPDATE_ROLLBACK_UNAVAILABLE",
  "UPDATE_MIGRATION_REQUIRED",
] as const;

export type RuntimeErrorCode = (typeof ERROR_CODES)[number];

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly details?: Record<string, unknown>;
  readonly statusCode: number;

  constructor(
    code: RuntimeErrorCode,
    message: string,
    details?: Record<string, unknown>,
    statusCode = 400,
  ) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

export type RuntimeErrorEnvelope = {
  error: {
    code: RuntimeErrorCode;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
};

export const asRuntimeError = (error: unknown): RuntimeError => {
  if (error instanceof RuntimeError) return error;
  if (error instanceof Error) {
    return new RuntimeError("INVALID_OPERATION", error.message, undefined, 500);
  }
  return new RuntimeError(
    "INVALID_OPERATION",
    "An unknown runtime error occurred.",
    undefined,
    500,
  );
};
