import type {
  Asset,
  AssetManifest,
  BrandKitRecord,
  BrandLintReport,
  BrandPaletteToken,
  BrandReusableDefinition,
  DesignBrief,
  DesignPlan,
  DesignPlanCompilation,
  DesignRoleInspectionReport,
  FontRecord,
  FontManifest,
  ExportSettings,
  FrameDocument,
  FrameValidationReport,
  HistoryEntry,
  ProjectDocument,
  ProjectTemplateDefinition,
  RuntimeErrorCode,
  TransactionCommitResult,
  TransactionPreviewResult,
  TransactionProposalView,
  TransactionRequest,
  VisualQaReport,
  VectorPathCommand,
  ShapeFill,
  Stroke,
} from "@agentic-design/core";

export type ExportArtifact = {
  path: string;
  width: number;
  height: number;
  revision: number;
  sceneHash: string;
  durationMs: number;
  warnings: Array<{ code: string; message: string; nodeIds?: string[] }>;
  resourceStats: {
    activeRenderers: number;
    completedRenders: number;
    maxActiveRenderers: number;
  };
  versions: { runtime: string; chromium: string; pixi: string };
  format: ExportSettings["format"];
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  scale: number;
  quality?: number;
  transparent: boolean;
  sizeBytes: number;
};

export type BatchExportResult = {
  projectId: string;
  format: ExportSettings["format"];
  scale: number;
  durationMs: number;
  exports: Array<ExportArtifact & { frameId: string; frameName: string }>;
};

export type DesignPlanPreviewResult = {
  compilation: DesignPlanCompilation;
  preview: TransactionPreviewResult | null;
};

export type SemanticRoleAssignmentResult = {
  plan: DesignPlan;
  inspection: DesignRoleInspectionReport;
  transaction: TransactionCommitResult | TransactionPreviewResult;
};

export type ImportFileResult =
  | {
      kind: "asset";
      asset: Asset;
      duplicate: boolean;
      editableVector?: {
        commands: VectorPathCommand[];
        fill?: ShapeFill;
        stroke?: Stroke;
      };
      transaction: TransactionCommitResult;
    }
  | {
      kind: "font";
      font: FontRecord;
      duplicate: boolean;
      transaction: TransactionCommitResult;
    };

export type RuntimeStatus = {
  schemaVersion: 1;
  compatibility: {
    runtimeApiVersion: 1;
    workspaceSchemaVersion: 1;
  };
  runtimeId: string;
  workspaceId: string;
  workspacePath: string;
  startedAt: string;
  status: "ready" | "recovering" | "stopping";
  capabilities: {
    maxTextureSize: number;
    maxRenderbufferSize: number;
    maxCanvasDimension: number;
    effectiveRasterLimits: Record<string, unknown>;
  };
  versions: { runtime: string; node: string; chromium?: string; pixi: string };
  identity: RuntimeClientIdentity;
};

export type RuntimeClientIdentity = {
  clientId: string;
  sessionId: string;
  source: "studio" | "http" | "mcp";
  label: string;
};

export type RuntimeEvent = {
  event: string;
  eventId: string;
  runtimeId: string;
  workspaceId: string;
  timestamp: string;
  payload: unknown;
};

export type ClientTransactionRequest = TransactionRequest extends infer Request
  ? Request extends TransactionRequest
    ? Omit<Request, "runtimeId" | "workspaceId">
    : never
  : never;

export class DesignRuntimeApiError extends Error {
  readonly code: RuntimeErrorCode;
  readonly status: number;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;

  constructor(input: {
    code: RuntimeErrorCode;
    message: string;
    status: number;
    requestId?: string;
    details?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "DesignRuntimeApiError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId;
    this.details = input.details;
  }
}

type ClientOptions = {
  baseUrl?: string;
  runtimeId?: string;
  workspaceId?: string;
  capabilityToken?: string;
  fetch?: typeof globalThis.fetch;
  clientType?: RuntimeClientIdentity["source"];
  clientLabel?: string;
};

export class DesignRuntimeClient {
  readonly baseUrl: string;
  runtimeId?: string;
  workspaceId?: string;
  identity?: RuntimeClientIdentity;
  #token?: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #clientType: RuntimeClientIdentity["source"];
  readonly #clientLabel?: string;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      globalThis.location?.origin ??
      "http://127.0.0.1:4100"
    ).replace(/\/$/, "");
    this.runtimeId = options.runtimeId;
    this.workspaceId = options.workspaceId;
    this.#token = options.capabilityToken;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#clientType =
      options.clientType ??
      (options.capabilityToken
        ? "http"
        : typeof globalThis.location === "object"
          ? "studio"
          : "http");
    this.#clientLabel = options.clientLabel;
  }

  async getRuntime(): Promise<RuntimeStatus> {
    const status = await this.#request<RuntimeStatus>("/api/runtime");
    this.runtimeId = status.runtimeId;
    this.workspaceId = status.workspaceId;
    if (!this.identity) {
      this.identity = await this.#request<RuntimeClientIdentity>(
        "/api/clients/session",
        {
          method: "POST",
          body: JSON.stringify({
            clientType: this.#clientType,
            ...(this.#clientLabel ? { label: this.#clientLabel } : {}),
          }),
        },
      );
    }
    return { ...status, identity: this.identity };
  }

  listProjects(): Promise<ProjectDocument[]> {
    return this.#request("/api/projects");
  }
  getProject(projectId: string): Promise<ProjectDocument> {
    return this.#request(`/api/projects/${projectId}`);
  }
  listFrames(projectId: string): Promise<FrameDocument[]> {
    return this.#request(`/api/projects/${projectId}/frames`);
  }
  getFrame(projectId: string, frameId: string): Promise<FrameDocument> {
    return this.#request(`/api/projects/${projectId}/frames/${frameId}`);
  }
  getHistory(projectId: string, frameId: string): Promise<HistoryEntry[]> {
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/history`,
    );
  }
  getRevision(
    projectId: string,
    frameId: string,
    revision: number,
  ): Promise<FrameDocument> {
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/revisions/${revision}`,
    );
  }
  compareRevisions(
    projectId: string,
    frameId: string,
    left: number,
    right: number,
  ): Promise<{
    frameId: string;
    leftRevision: number;
    rightRevision: number;
    diff: unknown[];
  }> {
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/compare?left=${left}&right=${right}`,
    );
  }
  getExternalConflict(
    projectId: string,
    frameId: string,
  ): Promise<{
    conflict: {
      code: string;
      message: string;
      recoveryPath: string;
      diff: unknown[];
      timestamp: string;
    } | null;
  }> {
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/external-conflict`,
    );
  }
  revertExternalConflict(
    projectId: string,
    frameId: string,
  ): Promise<{ status: "reverted"; recoveryPath?: string }> {
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/external-conflict/revert`,
      { method: "POST" },
    );
  }
  getAssets(projectId: string): Promise<AssetManifest> {
    return this.#request(`/api/projects/${projectId}/assets`);
  }
  getFonts(projectId: string): Promise<FontManifest> {
    return this.#request(`/api/projects/${projectId}/fonts`);
  }
  listBrandKits(): Promise<{ kits: BrandKitRecord[] }> {
    return this.#request("/api/brand-kits");
  }

  auditBrand(projectId: string): Promise<BrandLintReport> {
    return this.#request(`/api/projects/${projectId}/brand-lint`);
  }
  getBrandKit(kitId: string, revision?: number): Promise<BrandKitRecord> {
    return this.#request(
      `/api/brand-kits/${kitId}${revision ? `?revision=${revision}` : ""}`,
    );
  }
  createBrandKit(input: {
    kitId?: string;
    name: string;
    description?: string;
    sourceProjectId: string;
    provenance: string;
    licenseNotes: string;
    palette: BrandPaletteToken[];
    typeRoles: Array<{
      key: string;
      name: string;
      fontId: string;
      fontSize: number;
      lineHeight: number;
      letterSpacing: number;
      colorToken?: string;
    }>;
    effectStyles?: BrandKitRecord["effectStyles"];
    radiusTokens?: BrandKitRecord["radiusTokens"];
    spacingTokens?: BrandKitRecord["spacingTokens"];
    variableModes?: BrandKitRecord["variableModes"];
    logos: Array<{
      key: string;
      name: string;
      assetId: string;
      licenseNotes: string;
      provenance: string;
    }>;
    definitions: BrandReusableDefinition[];
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<BrandKitRecord> {
    return this.#request("/api/brand-kits", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  pinBrandKit(input: {
    projectId: string;
    kitId: string;
    revision: number;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, ...body } = input;
    return this.#request(`/api/projects/${projectId}/brand-kit/pin`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  migrateBrandKit(input: {
    projectId: string;
    kitId: string;
    revision: number;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, ...body } = input;
    return this.#request(`/api/projects/${projectId}/brand-kit/migrate`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  rollbackBrandMigration(input: {
    projectId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/brand-kit/migration/rollback`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }
  unpinBrandKit(input: {
    projectId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, ...body } = input;
    return this.#request(`/api/projects/${projectId}/brand-kit/unpin`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  applyBrand(input: {
    projectId: string;
    frameId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
    palette?: Array<{
      nodeId: string;
      token: string;
      property: "fill" | "textColor";
    }>;
    typeRoles?: Array<{ nodeId: string; role: string }>;
    logo?: {
      key: string;
      nodeId: string;
      parentId: string;
      index?: number;
      x: number;
      y: number;
      width?: number;
      height?: number;
    };
    definition?: {
      key: string;
      parentId: string;
      index?: number;
      idMap: Record<string, string>;
      instanceId?: string;
    };
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/brand/apply`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  bindPaletteToken(input: {
    projectId: string;
    frameId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
    bindingId: string;
    nodeId: string;
    property: "fill" | "stroke" | "textColor";
    tokenKey: string;
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/brand-bindings/palette`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  unbindPaletteToken(input: {
    projectId: string;
    frameId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
    nodeId: string;
    property: "fill" | "stroke" | "textColor";
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/brand-bindings/palette/remove`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  bindTypographyRole(input: {
    projectId: string;
    frameId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
    bindingId: string;
    nodeId: string;
    roleKey: string;
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/brand-bindings/typography`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  unbindTypographyRole(input: {
    projectId: string;
    frameId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
    nodeId: string;
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/brand-bindings/typography/remove`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  bindEffectStyle(input: {
    projectId: string;
    frameId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
    bindingId: string;
    nodeId: string;
    styleKey: string;
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/brand-bindings/effects`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  unbindEffectStyle(input: {
    projectId: string;
    frameId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
    nodeId: string;
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/brand-bindings/effects/remove`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  bindRadiusToken(input: {
    projectId: string;
    frameId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
    bindingId: string;
    nodeId: string;
    tokenKey: string;
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/brand-bindings/radius`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  unbindRadiusToken(input: {
    projectId: string;
    frameId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
    nodeId: string;
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/brand-bindings/radius/remove`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  bindSpacingToken(input: {
    projectId: string;
    frameId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
    bindingId: string;
    tokenKey: string;
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/brand-bindings/spacing`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  unbindSpacingToken(input: {
    projectId: string;
    frameId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/brand-bindings/spacing/remove`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  applyVariableMode(input: {
    projectId: string;
    frameId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
    modeKey: string | null;
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/brand-bindings/variable-mode`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  switchBrandComponentVariant(input: {
    projectId: string;
    frameId: string;
    instanceId: string;
    definitionKey: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, instanceId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/brand-components/${instanceId}/variant`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  listProjectTemplates(
    projectId: string,
  ): Promise<ProjectTemplateDefinition[]> {
    return this.getProject(projectId).then(
      (project) => project.templates ?? [],
    );
  }

  applyProjectTemplate(input: {
    projectId: string;
    frameId: string;
    templateId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
    instanceId: string;
    groupId: string;
    idMap: Record<string, string>;
    parentId?: string;
    index?: number;
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    const { projectId, frameId, templateId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/templates/${templateId}/apply`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  listDesignBriefs(projectId: string): Promise<DesignBrief[]> {
    return this.getProject(projectId).then(
      (project) => project.designBriefs ?? [],
    );
  }

  setDesignBrief(input: {
    projectId: string;
    brief: DesignBrief;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    return this.transact({
      schemaVersion: 1,
      mode: input.mode,
      scope: { kind: "project", projectId: input.projectId },
      baseRevision: input.baseRevision,
      actor: input.actor,
      operations: [{ kind: "setDesignBrief", brief: input.brief }],
    });
  }

  removeDesignBrief(input: {
    projectId: string;
    briefId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    return this.transact({
      schemaVersion: 1,
      mode: input.mode,
      scope: { kind: "project", projectId: input.projectId },
      baseRevision: input.baseRevision,
      actor: input.actor,
      operations: [{ kind: "removeDesignBrief", briefId: input.briefId }],
    });
  }

  listDesignPlans(projectId: string): Promise<DesignPlan[]> {
    return this.getProject(projectId).then(
      (project) => project.designPlans ?? [],
    );
  }

  inspectDesignPlan(projectId: string, planId: string): Promise<DesignPlan> {
    return this.#request(`/api/projects/${projectId}/design-plans/${planId}`);
  }

  inspectDesignRoles(
    projectId: string,
    planId: string,
  ): Promise<DesignRoleInspectionReport> {
    return this.#request(
      `/api/projects/${projectId}/design-plans/${planId}/roles`,
    );
  }

  assignSemanticRole(input: {
    projectId: string;
    planId: string;
    roleId: string;
    baseRevision: number;
    mode?: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
    nodeId: string | null;
    copyItemId?: string | null;
  }): Promise<SemanticRoleAssignmentResult> {
    const { projectId, planId, roleId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/design-plans/${planId}/roles/${roleId}/assignment`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  setDesignPlan(input: {
    projectId: string;
    plan: DesignPlan;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    return this.transact({
      schemaVersion: 1,
      mode: input.mode,
      scope: { kind: "project", projectId: input.projectId },
      baseRevision: input.baseRevision,
      actor: input.actor,
      operations: [{ kind: "setDesignPlan", plan: input.plan }],
    });
  }

  removeDesignPlan(input: {
    projectId: string;
    planId: string;
    baseRevision: number;
    mode: "preview" | "commit";
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<TransactionCommitResult | TransactionPreviewResult> {
    return this.transact({
      schemaVersion: 1,
      mode: input.mode,
      scope: { kind: "project", projectId: input.projectId },
      baseRevision: input.baseRevision,
      actor: input.actor,
      operations: [{ kind: "removeDesignPlan", planId: input.planId }],
    });
  }

  previewDesignPlan(input: {
    projectId: string;
    frameId: string;
    planId: string;
    baseRevision: number;
    actor: { source: "studio" | "http" | "mcp"; id: string };
    roleIds?: string[];
    variantRuleId?: string;
  }): Promise<DesignPlanPreviewResult> {
    const { projectId, frameId, planId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/design-plans/${planId}/preview`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  applyLayoutSystem(input: {
    projectId: string;
    frameId: string;
    planId: string;
    baseRevision: number;
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<DesignPlanPreviewResult> {
    const { projectId, frameId, planId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/design-plans/${planId}/layout-system/preview`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  reflowContent(input: {
    projectId: string;
    frameId: string;
    planId: string;
    baseRevision: number;
    roleIds: string[];
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<DesignPlanPreviewResult> {
    const { projectId, frameId, planId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/design-plans/${planId}/reflow/preview`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  replaceRoleAsset(input: {
    projectId: string;
    frameId: string;
    planId: string;
    roleId: string;
    baseRevision: number;
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<DesignPlanPreviewResult> {
    const { projectId, frameId, planId, roleId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/design-plans/${planId}/roles/${roleId}/asset/preview`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  bindBrandTokens(input: {
    projectId: string;
    frameId: string;
    planId: string;
    baseRevision: number;
    actor: { source: "studio" | "http" | "mcp"; id: string };
    roleIds?: string[];
  }): Promise<DesignPlanPreviewResult> {
    const { projectId, frameId, planId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/design-plans/${planId}/brand-bindings/preview`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  createDesignVariant(input: {
    projectId: string;
    frameId: string;
    planId: string;
    variantRuleId: string;
    baseRevision: number;
    actor: { source: "studio" | "http" | "mcp"; id: string };
  }): Promise<DesignPlanPreviewResult> {
    const { projectId, frameId, planId, variantRuleId, ...body } = input;
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/design-plans/${planId}/variants/${variantRuleId}/preview`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  getDiagnostics(): Promise<unknown> {
    return this.#request("/api/diagnostics");
  }

  checkForUpdate(): Promise<Record<string, unknown>> {
    return this.#request("/api/updates/check");
  }

  fetchUpdate(): Promise<Record<string, unknown>> {
    return this.#request("/api/updates/fetch", { method: "POST" });
  }

  applyUpdate(): Promise<Record<string, unknown>> {
    return this.#request("/api/updates/apply", { method: "POST" });
  }

  rollbackUpdate(): Promise<Record<string, unknown>> {
    return this.#request("/api/updates/rollback", { method: "POST" });
  }

  async rotateCapability(): Promise<{
    capabilityToken: string;
    runtimeId: string;
    workspaceId: string;
  }> {
    const result = await this.#request<{
      capabilityToken: string;
      runtimeId: string;
      workspaceId: string;
    }>("/api/runtime/capability/rotate", { method: "POST" });
    this.#token = result.capabilityToken;
    return result;
  }

  openStudio(): Promise<{ baseUrl: string }> {
    return this.#request("/api/runtime/studio/open", { method: "POST" });
  }

  stopRuntime(): Promise<{
    status: "stopping";
    runtimeId: string;
    workspacePath: string;
  }> {
    return this.#request("/api/runtime/stop", { method: "POST" });
  }

  transact(
    request: ClientTransactionRequest,
  ): Promise<TransactionCommitResult | TransactionPreviewResult> {
    if (!this.runtimeId || !this.workspaceId)
      throw new Error("Call getRuntime before submitting transactions.");
    return this.#request("/api/transactions", {
      method: "POST",
      body: JSON.stringify({
        ...request,
        runtimeId: this.runtimeId,
        workspaceId: this.workspaceId,
      }),
    });
  }

  commitPreview(previewId: string): Promise<TransactionCommitResult> {
    return this.#request(`/api/previews/${previewId}/commit`, {
      method: "POST",
    });
  }

  explainProposedChanges(previewId: string): Promise<TransactionProposalView> {
    return this.#request(`/api/proposals/${previewId}`);
  }

  previewProposal(previewId: string): Promise<TransactionProposalView> {
    return this.#request(`/api/proposals/${previewId}/preview`);
  }

  commitProposal(previewId: string): Promise<TransactionCommitResult> {
    return this.#request(`/api/proposals/${previewId}/commit`, {
      method: "POST",
    });
  }

  validateFrame(
    projectId: string,
    frameId: string,
  ): Promise<FrameValidationReport> {
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/validate`,
      { method: "POST" },
    );
  }

  auditVisualQuality(
    projectId: string,
    frameId: string,
    planId?: string,
  ): Promise<VisualQaReport> {
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/visual-qa`,
      {
        method: "POST",
        body: JSON.stringify(planId ? { planId } : {}),
      },
    );
  }

  renderPreview(projectId: string, frameId: string): Promise<Blob> {
    return this.#requestBlob(
      `/api/projects/${projectId}/frames/${frameId}/render-preview`,
      { method: "POST" },
    );
  }

  exportFrame(
    projectId: string,
    frameId: string,
    settings?: Partial<ExportSettings>,
  ): Promise<ExportArtifact> {
    return this.#request(
      `/api/projects/${projectId}/frames/${frameId}/export`,
      {
        method: "POST",
        body: settings ? JSON.stringify(settings) : undefined,
      },
    );
  }

  exportProject(
    projectId: string,
    frameIds: string[],
    settings?: Partial<ExportSettings>,
  ): Promise<BatchExportResult> {
    return this.#request(`/api/projects/${projectId}/export`, {
      method: "POST",
      body: JSON.stringify({ frameIds, settings }),
    });
  }

  async importFile(
    projectId: string,
    type: "asset" | "font",
    file: File,
    baseRevision: number,
  ): Promise<ImportFileResult> {
    const form = new FormData();
    form.set("file", file);
    form.set("baseRevision", String(baseRevision));
    if (type === "asset") {
      const result = await this.#request<{
        asset: Asset;
        duplicate: boolean;
        editableVector?: {
          commands: VectorPathCommand[];
          fill?: ShapeFill;
          stroke?: Stroke;
        };
        transaction: TransactionCommitResult;
      }>(`/api/projects/${projectId}/assets/import`, {
        method: "POST",
        body: form,
      });
      return { kind: "asset", ...result };
    }
    const result = await this.#request<{
      font: FontRecord;
      duplicate: boolean;
      transaction: TransactionCommitResult;
    }>(`/api/projects/${projectId}/fonts/import`, {
      method: "POST",
      body: form,
    });
    return { kind: "font", ...result };
  }

  subscribe(
    onEvent: (event: RuntimeEvent) => void,
    onStatus?: (status: "open" | "closed" | "error") => void,
  ): () => void {
    const url = new URL("/api/events", this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => onStatus?.("open"));
    socket.addEventListener("close", () => onStatus?.("closed"));
    socket.addEventListener("error", () => onStatus?.("error"));
    socket.addEventListener("message", (event) => {
      try {
        onEvent(JSON.parse(String(event.data)) as RuntimeEvent);
      } catch {
        /* ignore malformed noncanonical events */
      }
    });
    return () => socket.close(1000, "Client closed");
  }

  assetUrl(projectId: string, assetId: string): string {
    return `${this.baseUrl}/api/projects/${projectId}/assets/${assetId}/content`;
  }
  fontUrl(projectId: string, fontId: string): string {
    return `${this.baseUrl}/api/projects/${projectId}/fonts/${fontId}/content`;
  }

  async #request<T>(route: string, init: RequestInit = {}): Promise<T> {
    const response = await this.#fetch(`${this.baseUrl}${route}`, {
      ...init,
      credentials: "include",
      headers: this.#headers(init.headers, init.body),
    });
    if (!response.ok) await this.#throw(response);
    return response.json() as Promise<T>;
  }

  async #requestBlob(route: string, init: RequestInit = {}): Promise<Blob> {
    const response = await this.#fetch(`${this.baseUrl}${route}`, {
      ...init,
      credentials: "include",
      headers: this.#headers(init.headers, init.body),
    });
    if (!response.ok) await this.#throw(response);
    return response.blob();
  }

  #headers(
    existing: HeadersInit | undefined,
    body: BodyInit | null | undefined,
  ): Headers {
    const headers = new Headers(existing);
    if (typeof body === "string")
      headers.set("content-type", "application/json");
    if (this.#token) headers.set("authorization", `Bearer ${this.#token}`);
    if (this.runtimeId) headers.set("x-design-runtime-id", this.runtimeId);
    if (this.workspaceId)
      headers.set("x-design-workspace-id", this.workspaceId);
    if (this.identity)
      headers.set("x-design-session-id", this.identity.sessionId);
    return headers;
  }

  async #throw(response: Response): Promise<never> {
    const body = (await response.json().catch(() => ({
      error: { code: "INVALID_OPERATION", message: response.statusText },
    }))) as {
      error: {
        code: RuntimeErrorCode;
        message: string;
        requestId?: string;
        details?: Record<string, unknown>;
      };
    };
    throw new DesignRuntimeApiError({ ...body.error, status: response.status });
  }
}
