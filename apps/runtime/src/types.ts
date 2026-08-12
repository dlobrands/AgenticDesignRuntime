import type {
  AssetManifest,
  DesignConfig,
  FontManifest,
  FrameDocument,
  HistoryEntry,
  ProjectDocument,
  RuntimeCapabilities,
  BrandKitRecord,
} from "@tva-agentic-design/core";

export type ProjectState = {
  directory: string;
  document: ProjectDocument;
  frames: Map<string, FrameDocument>;
  assets: AssetManifest;
  fonts: FontManifest;
  history: HistoryEntry[];
  blockedFrames: Map<
    string,
    {
      code: "FRAME_VALIDATION_FAILED" | "HISTORY_RECOVERY_REQUIRED";
      message: string;
      recoveryPath?: string;
    }
  >;
  externalConflicts: Map<
    string,
    {
      projectId: string;
      frameId: string;
      code: string;
      message: string;
      recoveryPath: string;
      diff: unknown[];
      timestamp: string;
    }
  >;
};

export type RuntimeDescriptor = {
  schemaVersion: 1;
  runtimeId: string;
  workspaceId: string;
  workspacePath: string;
  baseUrl: string;
  pid: number;
  startedAt: string;
  capabilityToken: string;
};

export type WorkspaceState = {
  root: string;
  runtimeId: string;
  capabilityToken: string;
  config: DesignConfig;
  capabilities: RuntimeCapabilities;
  projects: Map<string, ProjectState>;
  brandKits: Map<string, BrandKitRecord[]>;
  descriptorPath: string;
  lockPath: string;
  startedAt: string;
};

export type RuntimeEventName =
  | "runtime.ready"
  | "runtime.stopping"
  | "workspace.loaded"
  | "transaction.committed"
  | "transaction.rejected"
  | "operation.previewed"
  | "operation.rebased"
  | "operation.preview.expired"
  | "frame.validation.changed"
  | "frame.external-edit.rejected"
  | "save.failed"
  | "save.recovered"
  | "asset.imported"
  | "font.imported"
  | "brand-kit.created"
  | "export.started"
  | "export.completed"
  | "export.failed"
  | "diagnostics.warning";

export type RuntimeEvent<T = unknown> = {
  event: RuntimeEventName;
  eventId: string;
  runtimeId: string;
  workspaceId: string;
  timestamp: string;
  payload: T;
};

export type RuntimeMetricState = {
  startedAt: string;
  previewCount: number;
  commitCount: number;
  rejectionCount: number;
  validationFailures: number;
  revisionConflicts: number;
  saveFailures: number;
  recoveryJournalActivations: number;
  lastTransactionDurationMs?: number;
  lastPersistenceDurationMs?: number;
  lastHistoryAppendDurationMs?: number;
  lastExternalReloadDurationMs?: number;
  lastExportDurationMs?: number;
  renderedNodeCount?: number;
  estimatedTextureMemoryBytes?: number;
};
