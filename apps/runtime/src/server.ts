import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import {
  ApplyBrandInputSchema,
  ApplyVariableModeInputSchema,
  SwitchBrandComponentVariantInputSchema,
  ApplyProjectTemplateInputSchema,
  AssignSemanticRoleInputSchema,
  assignSemanticRole,
  auditVisualQuality,
  auditBrandFrame,
  BatchExportRequestSchema,
  BrandActorSchema,
  CompileBrandBindingsOptionsSchema,
  BrandMutationEnvelopeSchema,
  BrandPinRequestSchema,
  CreateBrandKitInputSchema,
  BindPaletteTokenInputSchema,
  BindRadiusTokenInputSchema,
  BindSpacingTokenInputSchema,
  BindEffectStyleInputSchema,
  BindTypographyRoleInputSchema,
  UnbindPaletteTokenInputSchema,
  UnbindRadiusTokenInputSchema,
  UnbindSpacingTokenInputSchema,
  UnbindEffectStyleInputSchema,
  UnbindTypographyRoleInputSchema,
  CompileDesignPlanOptionsSchema,
  compileDesignLayout,
  compileDesignVariant,
  compileBrandBindings,
  compileVariableMode,
  compileBrandComponentVariant,
  compileRoleAssetReplacement,
  RuntimeError,
  VisualQaOptionsSchema,
  asRuntimeError,
  estimateTextureMemory,
  fullDocumentHash,
  listNodes,
  instantiateProjectTemplate,
  inspectDesignRoles,
  compileDesignPlan,
  compilePaletteTokenBinding,
  compilePaletteTokenUnbind,
  compileRadiusTokenBinding,
  compileRadiusTokenUnbind,
  compileSpacingTokenBinding,
  compileSpacingTokenUnbind,
  compileEffectStyleBinding,
  compileEffectStyleUnbind,
  compileTypographyRoleBinding,
  compileTypographyRoleUnbind,
  validateFrameBrandBindings,
  normalizeExportSettings,
  ReflowContentOptionsSchema,
  reconstructRevision,
  structuredDiff,
  validateFrame,
  type ApplyBrandInput,
  type CreateBrandKitInput,
  type FrameDocument,
  type ExportSettings,
  type TextNode,
  type TransactionRequest,
} from "@agentic-design/core";
import { ChromiumExportWorker } from "./export-worker.js";
import { UpdateManager } from "./update-manager.js";
import {
  createBrandKitRevision,
  buildBrandFrameOperations,
  listBrandKits,
  loadBrandKits,
  pinBrandKitToProject,
  requireBrandKit,
} from "./brand-library.js";
import { KeyedQueue } from "./queue.js";
import { buildProposalView } from "./proposals.js";
import { resolveInside } from "./fs-safe.js";
import { importAssetBuffer, importFontBuffer } from "./importer.js";
import { RuntimeSecurity } from "./security.js";
import type { TransactionEngine } from "./transaction-engine.js";
import type { ProjectState, WorkspaceState } from "./types.js";
import {
  applyRendererCapabilities,
  requireFrame,
  requireProject,
} from "./workspace.js";
import {
  PRODUCT_VERSION,
  REFERENCE_VERSIONS,
  RUNTIME_API_VERSION,
} from "./version.js";

const parseRevisionField = (value: unknown): number => {
  const raw =
    typeof value === "object" && value && "value" in value
      ? (value as { value: unknown }).value
      : value;
  const revision = Number(raw);
  if (!Number.isInteger(revision) || revision < 0)
    throw new RuntimeError(
      "STALE_REVISION",
      "A non-negative integer baseRevision field is required.",
    );
  return revision;
};

const publicProject = (project: ProjectState) => project.document;

export type RuntimeServer = {
  app: FastifyInstance;
  security: RuntimeSecurity;
  exportWorker: ChromiumExportWorker;
  baseUrl: string;
  bootstrapNonce: string;
  openStudio: () => Promise<{ baseUrl: string }>;
  close: () => Promise<void>;
};

export const startRuntimeServer = async (input: {
  workspace: WorkspaceState;
  engine: TransactionEngine;
  studioDirectory: string;
  openStudio?: (bootstrapUrl: string) => Promise<void>;
  requestShutdown?: () => void;
  updateManager?: UpdateManager;
}): Promise<RuntimeServer> => {
  const { workspace, engine } = input;
  await loadBrandKits(workspace);
  for (const project of workspace.projects.values()) {
    const pin = project.document.brandKitPin;
    const kit = pin
      ? requireBrandKit(workspace, pin.kitId, pin.revision)
      : undefined;
    for (const frame of project.frames.values())
      validateFrameBrandBindings({
        frame,
        ...(pin ? { pin } : {}),
        ...(kit ? { kit } : {}),
      });
  }
  const app = Fastify({
    logger: false,
    trustProxy: false,
    bodyLimit: 2 * 1024 * 1024,
  });
  const security = new RuntimeSecurity(workspace);
  const exportWorker = new ChromiumExportWorker(workspace);
  const brandQueue = new KeyedQueue();
  const updateManager = input.updateManager ?? new UpdateManager();
  engine.setTextMeasurer((projectId, nodes) =>
    exportWorker.measureText(projectId, nodes),
  );
  const host = workspace.config.server.host;
  const port = workspace.config.server.port;
  const baseUrl = `http://${host}:${port}`;
  const validateWithText = async (
    project: ProjectState,
    frame: FrameDocument,
  ) => {
    const report = validateFrame(frame, {
      assets: project.assets.assets,
      fonts: project.fonts.fonts,
      capabilities: workspace.capabilities,
    });
    const textNodes = listNodes(frame).filter(
      (node): node is TextNode =>
        node.type === "text" &&
        node.textBox.mode === "fixed" &&
        !node.textBox.overflowAccepted,
    );
    if (textNodes.length > 0 && report.valid) {
      const measurements = await exportWorker.measureText(
        project.document.id,
        textNodes,
      );
      const byId = new Map(
        measurements.map((measurement) => [measurement.nodeId, measurement]),
      );
      for (const node of textNodes) {
        const measurement = byId.get(node.id);
        if (!measurement) continue;
        const widthOverflow =
          node.textBox.wrapping === "none" &&
          measurement.width > node.transform.width + 0.5;
        const heightOverflow = measurement.height > node.transform.height + 0.5;
        if (widthOverflow || heightOverflow)
          report.warnings.push({
            code: "TEXT_OVERFLOW",
            message: `“${node.name}” overflows its fixed text box.`,
            nodeIds: [node.id],
          });
      }
    }
    return report;
  };
  const requireExportable = async (
    project: ProjectState,
    frame: FrameDocument,
  ) => {
    const report = await validateWithText(project, frame);
    if (!report.valid)
      throw new RuntimeError(
        "EXPORT_BLOCKED",
        report.errors.map((issue) => issue.message).join(" "),
        { report },
        409,
      );
    const blockingOverflow = report.warnings.find(
      (warning) => warning.code === "TEXT_OVERFLOW",
    );
    if (blockingOverflow)
      throw new RuntimeError(
        "EXPORT_BLOCKED",
        blockingOverflow.message,
        { report },
        409,
      );
  };

  await app.register(cookie);
  await app.register(websocket);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: [
          "'self'",
          `ws://${host}:${port}`,
          `ws://localhost:${port}`,
          `ws://127.0.0.1:${port}`,
        ],
        workerSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize:
        workspace.capabilities.effectiveRasterLimits.maxFileSizeMb *
        1024 *
        1024,
      fields: 8,
      parts: 10,
    },
  });

  security.register(app);

  app.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/api/"))
      security.assertRequest(request, {
        runtimeHeaders: request.url !== "/api/runtime",
      });
  });

  app.setErrorHandler(async (error, request, reply) => {
    const zodIssues =
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "ZodError" &&
      "issues" in error
        ? error.issues
        : undefined;
    const runtimeError = zodIssues
      ? new RuntimeError(
          "INVALID_OPERATION",
          "Request validation failed.",
          { issues: zodIssues },
          400,
        )
      : asRuntimeError(error);
    await engine.logger.error("request.failed", {
      requestId: request.id,
      code: runtimeError.code,
      method: request.method,
      route: request.routeOptions.url,
    });
    return security.error(reply, runtimeError, request.id);
  });

  app.get("/api/runtime", async (request) => ({
    schemaVersion: 1,
    compatibility: {
      runtimeApiVersion: RUNTIME_API_VERSION,
      workspaceSchemaVersion: workspace.config.schemaVersion,
    },
    runtimeId: workspace.runtimeId,
    workspaceId: workspace.config.workspaceId,
    workspacePath: workspace.root,
    startedAt: workspace.startedAt,
    status: "ready",
    capabilities: workspace.capabilities,
    versions: {
      runtime: PRODUCT_VERSION,
      node: process.version,
      chromium: `${REFERENCE_VERSIONS.playwright}-pinned`,
      pixi: REFERENCE_VERSIONS.pixi,
    },
    identity: security.identityForRequest(request),
  }));
  app.post<{
    Body: {
      clientType: "studio" | "http" | "mcp";
      label?: string;
    };
  }>("/api/clients/session", async (request) => {
    if (!(["studio", "http", "mcp"] as const).includes(request.body.clientType))
      throw new RuntimeError(
        "INVALID_OPERATION",
        "clientType must be studio, http, or mcp.",
      );
    return security.registerClient(
      request,
      request.body.clientType,
      request.body.label,
    );
  });
  app.post("/api/runtime/capability/rotate", async () => ({
    capabilityToken: await security.rotateCapability(),
    runtimeId: workspace.runtimeId,
    workspaceId: workspace.config.workspaceId,
  }));
  app.post<{ Body: { next?: string } }>(
    "/api/runtime/studio/bootstrap",
    async (request) => {
      security.assertCapabilityRequest(request);
      const nonce = security.issueBootstrapNonce();
      const next =
        request.body?.next?.startsWith("/") &&
        !request.body.next.startsWith("//")
          ? request.body.next
          : "/";
      return {
        bootstrapPath: `/bootstrap?nonce=${encodeURIComponent(nonce)}&next=${encodeURIComponent(next)}`,
      };
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string; instanceId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
      definitionKey: string;
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/brand-components/:instanceId/variant",
    async (request) => {
      const { baseRevision, mode, actor: claimedActor, ...raw } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const variant = SwitchBrandComponentVariantInputSchema.parse({
        instanceId: request.params.instanceId,
        ...raw,
      });
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      const pin = project.document.brandKitPin;
      if (!pin)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Project has no pinned Brand Kit.",
        );
      const kit = requireBrandKit(workspace, pin.kitId, pin.revision);
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: project.document.id,
          frameId: frame.id,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations: compileBrandComponentVariant({ frame, pin, kit, variant }),
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
      nodeId: string;
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/brand-bindings/effects/remove",
    async (request) => {
      const {
        baseRevision,
        mode,
        actor: claimedActor,
        ...rawUnbind
      } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const unbind = UnbindEffectStyleInputSchema.parse(rawUnbind);
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: project.document.id,
          frameId: frame.id,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations: compileEffectStyleUnbind({ frame, unbind }),
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
      bindingId: string;
      nodeId: string;
      styleKey: string;
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/brand-bindings/effects",
    async (request) => {
      const {
        baseRevision,
        mode,
        actor: claimedActor,
        ...rawBinding
      } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const binding = BindEffectStyleInputSchema.parse(rawBinding);
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      const pin = project.document.brandKitPin;
      if (!pin)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Project has no pinned Brand Kit.",
        );
      const kit = requireBrandKit(workspace, pin.kitId, pin.revision);
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: project.document.id,
          frameId: frame.id,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations: compileEffectStyleBinding({ frame, pin, kit, binding }),
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
      nodeId: string;
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/brand-bindings/typography/remove",
    async (request) => {
      const {
        baseRevision,
        mode,
        actor: claimedActor,
        ...rawUnbind
      } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const unbind = UnbindTypographyRoleInputSchema.parse(rawUnbind);
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: project.document.id,
          frameId: frame.id,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations: compileTypographyRoleUnbind({ frame, unbind }),
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
      bindingId: string;
      nodeId: string;
      roleKey: string;
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/brand-bindings/typography",
    async (request) => {
      const {
        baseRevision,
        mode,
        actor: claimedActor,
        ...rawBinding
      } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const binding = BindTypographyRoleInputSchema.parse(rawBinding);
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      const pin = project.document.brandKitPin;
      if (!pin)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Project has no pinned Brand Kit.",
        );
      const kit = requireBrandKit(workspace, pin.kitId, pin.revision);
      const operations = compileTypographyRoleBinding({
        frame,
        pin,
        kit,
        binding,
      });
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: project.document.id,
          frameId: frame.id,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations,
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  const previewDesignLayout = async (input: {
    request: FastifyRequest;
    projectId: string;
    frameId: string;
    planId: string;
    baseRevision: number;
    actor: { source: "studio" | "http" | "mcp"; id: string };
    roleIds?: string[];
    includeSafeArea: boolean;
  }) => {
    const project = requireProject(workspace, input.projectId);
    const frame = requireFrame(project, input.frameId);
    if (input.baseRevision !== frame.revision)
      throw new RuntimeError(
        "STALE_REVISION",
        "Frame revision changed before DesignPlan layout compilation.",
        { expected: frame.revision, received: input.baseRevision },
        409,
      );
    const plan = project.document.designPlans?.find(
      (candidate) => candidate.id === input.planId,
    );
    if (!plan)
      throw new RuntimeError(
        "INVALID_OPERATION",
        `Design plan ${input.planId} was not found.`,
        undefined,
        404,
      );
    const compilation = compileDesignLayout({
      plan,
      frame,
      includeSafeArea: input.includeSafeArea,
      ...(input.roleIds ? { roleIds: input.roleIds } : {}),
    });
    if (compilation.operations.length === 0)
      return { compilation, preview: null };
    const preview = await engine.execute({
      schemaVersion: 1,
      mode: "preview",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: {
        kind: "frame",
        projectId: input.projectId,
        frameId: input.frameId,
      },
      baseRevision: input.baseRevision,
      actor: security.actorForRequest(input.request, input.actor),
      operations: compilation.operations,
      renderPreview: true,
    });
    return { compilation, preview };
  };
  app.post<{
    Params: {
      projectId: string;
      frameId: string;
      planId: string;
      variantRuleId: string;
    };
    Body: {
      baseRevision: number;
      actor: { source: "studio" | "http" | "mcp"; id: string };
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/design-plans/:planId/variants/:variantRuleId/preview",
    async (request) => {
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision: request.body.baseRevision,
        mode: "preview",
        actor: BrandActorSchema.parse(request.body.actor),
      });
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      if (envelope.baseRevision !== frame.revision)
        throw new RuntimeError(
          "STALE_REVISION",
          "Frame revision changed before DesignPlan variant compilation.",
          { expected: frame.revision, received: envelope.baseRevision },
          409,
        );
      const plan = project.document.designPlans?.find(
        (candidate) => candidate.id === request.params.planId,
      );
      if (!plan)
        throw new RuntimeError(
          "INVALID_OPERATION",
          `Design plan ${request.params.planId} was not found.`,
          undefined,
          404,
        );
      const compilation = compileDesignVariant({
        plan,
        frame,
        variantRuleId: request.params.variantRuleId,
      });
      if (compilation.operations.length === 0)
        return { compilation, preview: null };
      const preview = await engine.execute({
        schemaVersion: 1,
        mode: "preview",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: request.params.projectId,
          frameId: request.params.frameId,
        },
        baseRevision: envelope.baseRevision,
        actor: security.actorForRequest(request, envelope.actor),
        operations: compilation.operations,
        renderPreview: true,
      });
      return { compilation, preview };
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string; planId: string };
    Body: {
      baseRevision: number;
      actor: { source: "studio" | "http" | "mcp"; id: string };
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/design-plans/:planId/layout-system/preview",
    async (request) => {
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision: request.body.baseRevision,
        mode: "preview",
        actor: BrandActorSchema.parse(request.body.actor),
      });
      return previewDesignLayout({
        request,
        projectId: request.params.projectId,
        frameId: request.params.frameId,
        planId: request.params.planId,
        baseRevision: envelope.baseRevision,
        actor: envelope.actor,
        includeSafeArea: true,
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string; planId: string };
    Body: {
      baseRevision: number;
      actor: { source: "studio" | "http" | "mcp"; id: string };
      roleIds?: string[];
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/design-plans/:planId/brand-bindings/preview",
    async (request) => {
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision: request.body.baseRevision,
        mode: "preview",
        actor: BrandActorSchema.parse(request.body.actor),
      });
      const options = CompileBrandBindingsOptionsSchema.parse({
        ...(request.body.roleIds ? { roleIds: request.body.roleIds } : {}),
      });
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      if (envelope.baseRevision !== frame.revision)
        throw new RuntimeError(
          "STALE_REVISION",
          "Frame revision changed before Brand-binding compilation.",
          { expected: frame.revision, received: envelope.baseRevision },
          409,
        );
      const plan = project.document.designPlans?.find(
        (candidate) => candidate.id === request.params.planId,
      );
      if (!plan)
        throw new RuntimeError(
          "INVALID_OPERATION",
          `Design plan ${request.params.planId} was not found.`,
          undefined,
          404,
        );
      const pin = project.document.brandKitPin;
      const brandKit = pin
        ? requireBrandKit(workspace, pin.kitId, pin.revision)
        : undefined;
      const compilation = compileBrandBindings({
        plan,
        frame,
        ...(brandKit ? { brandKit } : {}),
        ...(pin ? { brandResourceMap: pin.resourceMap } : {}),
        ...(options.roleIds ? { roleIds: options.roleIds } : {}),
      });
      if (compilation.operations.length === 0)
        return { compilation, preview: null };
      const preview = await engine.execute({
        schemaVersion: 1,
        mode: "preview",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: request.params.projectId,
          frameId: request.params.frameId,
        },
        baseRevision: envelope.baseRevision,
        actor: security.actorForRequest(request, envelope.actor),
        operations: compilation.operations,
        renderPreview: true,
      });
      return { compilation, preview };
    },
  );
  app.post<{
    Params: {
      projectId: string;
      frameId: string;
      planId: string;
      roleId: string;
    };
    Body: {
      baseRevision: number;
      actor: { source: "studio" | "http" | "mcp"; id: string };
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/design-plans/:planId/roles/:roleId/asset/preview",
    async (request) => {
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision: request.body.baseRevision,
        mode: "preview",
        actor: BrandActorSchema.parse(request.body.actor),
      });
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      if (envelope.baseRevision !== frame.revision)
        throw new RuntimeError(
          "STALE_REVISION",
          "Frame revision changed before role asset compilation.",
          { expected: frame.revision, received: envelope.baseRevision },
          409,
        );
      const plan = project.document.designPlans?.find(
        (candidate) => candidate.id === request.params.planId,
      );
      if (!plan)
        throw new RuntimeError(
          "INVALID_OPERATION",
          `Design plan ${request.params.planId} was not found.`,
          undefined,
          404,
        );
      const compilation = compileRoleAssetReplacement({
        plan,
        frame,
        roleId: request.params.roleId,
      });
      if (compilation.operations.length === 0)
        return { compilation, preview: null };
      const preview = await engine.execute({
        schemaVersion: 1,
        mode: "preview",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: request.params.projectId,
          frameId: request.params.frameId,
        },
        baseRevision: envelope.baseRevision,
        actor: security.actorForRequest(request, envelope.actor),
        operations: compilation.operations,
        renderPreview: true,
      });
      return { compilation, preview };
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string; planId: string };
    Body: {
      baseRevision: number;
      actor: { source: "studio" | "http" | "mcp"; id: string };
      roleIds: string[];
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/design-plans/:planId/reflow/preview",
    async (request) => {
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision: request.body.baseRevision,
        mode: "preview",
        actor: BrandActorSchema.parse(request.body.actor),
      });
      const options = ReflowContentOptionsSchema.parse({
        roleIds: request.body.roleIds,
      });
      return previewDesignLayout({
        request,
        projectId: request.params.projectId,
        frameId: request.params.frameId,
        planId: request.params.planId,
        baseRevision: envelope.baseRevision,
        actor: envelope.actor,
        roleIds: options.roleIds,
        includeSafeArea: false,
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string; templateId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
      instanceId: string;
      groupId: string;
      idMap: Record<string, string>;
      parentId?: string;
      index?: number;
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/templates/:templateId/apply",
    async (request) => {
      const {
        baseRevision,
        mode,
        actor: claimedActor,
        ...application
      } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const parsed = ApplyProjectTemplateInputSchema.parse(application);
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      requireFrame(project, request.params.frameId);
      const template = project.document.templates?.find(
        (candidate) => candidate.id === request.params.templateId,
      );
      if (!template)
        throw new RuntimeError(
          "INVALID_OPERATION",
          `Project template ${request.params.templateId} was not found.`,
          undefined,
          404,
        );
      const group = instantiateProjectTemplate({
        template,
        instanceId: parsed.instanceId,
        groupId: parsed.groupId,
        idMap: parsed.idMap,
      });
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: request.params.projectId,
          frameId: request.params.frameId,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations: [
          {
            kind: "createNode",
            parentId: parsed.parentId,
            ...(parsed.index === undefined ? {} : { index: parsed.index }),
            node: group,
          },
        ],
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string; planId: string };
    Body: {
      baseRevision: number;
      actor: { source: "studio" | "http" | "mcp"; id: string };
      roleIds?: string[];
      variantRuleId?: string;
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/design-plans/:planId/preview",
    async (request) => {
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision: request.body.baseRevision,
        mode: "preview",
        actor: BrandActorSchema.parse(request.body.actor),
      });
      const options = CompileDesignPlanOptionsSchema.parse({
        ...(request.body.roleIds ? { roleIds: request.body.roleIds } : {}),
        ...(request.body.variantRuleId
          ? { variantRuleId: request.body.variantRuleId }
          : {}),
      });
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      if (envelope.baseRevision !== frame.revision)
        throw new RuntimeError(
          "STALE_REVISION",
          "Frame revision changed before DesignPlan compilation.",
          { expected: frame.revision, received: envelope.baseRevision },
          409,
        );
      const plan = project.document.designPlans?.find(
        (candidate) => candidate.id === request.params.planId,
      );
      if (!plan)
        throw new RuntimeError(
          "INVALID_OPERATION",
          `Design plan ${request.params.planId} was not found.`,
          undefined,
          404,
        );
      const brief = plan.briefId
        ? project.document.designBriefs?.find(
            (candidate) => candidate.id === plan.briefId,
          )
        : undefined;
      const pin = project.document.brandKitPin;
      const brandKit = pin
        ? requireBrandKit(workspace, pin.kitId, pin.revision)
        : undefined;
      const compilation = compileDesignPlan({
        plan,
        frame,
        ...(brief ? { brief } : {}),
        ...(brandKit ? { brandKit } : {}),
        ...(pin ? { brandResourceMap: pin.resourceMap } : {}),
        ...(options.roleIds ? { roleIds: options.roleIds } : {}),
        ...(options.variantRuleId
          ? { variantRuleId: options.variantRuleId }
          : {}),
      });
      if (compilation.operations.length === 0)
        return { compilation, preview: null };
      const preview = await engine.execute({
        schemaVersion: 1,
        mode: "preview",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: request.params.projectId,
          frameId: request.params.frameId,
        },
        baseRevision: envelope.baseRevision,
        actor: security.actorForRequest(request, envelope.actor),
        operations: compilation.operations,
        renderPreview: true,
      });
      return { compilation, preview };
    },
  );
  app.get<{ Params: { projectId: string; planId: string } }>(
    "/api/projects/:projectId/design-plans/:planId",
    async (request) => {
      const project = requireProject(workspace, request.params.projectId);
      const plan = project.document.designPlans?.find(
        (candidate) => candidate.id === request.params.planId,
      );
      if (!plan)
        throw new RuntimeError(
          "INVALID_OPERATION",
          `Design plan ${request.params.planId} was not found.`,
          undefined,
          404,
        );
      return plan;
    },
  );
  app.get<{ Params: { projectId: string; planId: string } }>(
    "/api/projects/:projectId/design-plans/:planId/roles",
    async (request) => {
      const project = requireProject(workspace, request.params.projectId);
      const plan = project.document.designPlans?.find(
        (candidate) => candidate.id === request.params.planId,
      );
      if (!plan)
        throw new RuntimeError(
          "INVALID_OPERATION",
          `Design plan ${request.params.planId} was not found.`,
          undefined,
          404,
        );
      const frame = plan.targetFrameId
        ? project.frames.get(plan.targetFrameId)
        : undefined;
      return inspectDesignRoles(plan, frame);
    },
  );
  app.post<{
    Params: { projectId: string; planId: string; roleId: string };
    Body: {
      baseRevision: number;
      mode?: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
      nodeId: string | null;
      copyItemId?: string | null;
    };
  }>(
    "/api/projects/:projectId/design-plans/:planId/roles/:roleId/assignment",
    async (request) => {
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision: request.body.baseRevision,
        mode: request.body.mode ?? "preview",
        actor: BrandActorSchema.parse(request.body.actor),
      });
      const assignment = AssignSemanticRoleInputSchema.parse({
        nodeId: request.body.nodeId,
        ...(request.body.copyItemId !== undefined
          ? { copyItemId: request.body.copyItemId }
          : {}),
      });
      const project = requireProject(workspace, request.params.projectId);
      const plan = project.document.designPlans?.find(
        (candidate) => candidate.id === request.params.planId,
      );
      if (!plan)
        throw new RuntimeError(
          "INVALID_OPERATION",
          `Design plan ${request.params.planId} was not found.`,
          undefined,
          404,
        );
      const updatedPlan = assignSemanticRole({
        plan,
        roleId: request.params.roleId,
        assignment,
        now: new Date().toISOString(),
      });
      const transaction = await engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: { kind: "project", projectId: project.document.id },
        baseRevision: envelope.baseRevision,
        actor: security.actorForRequest(request, envelope.actor),
        operations: [{ kind: "setDesignPlan", plan: updatedPlan }],
        renderPreview: false,
      });
      const frame = updatedPlan.targetFrameId
        ? project.frames.get(updatedPlan.targetFrameId)
        : undefined;
      return {
        plan: updatedPlan,
        inspection: inspectDesignRoles(updatedPlan, frame),
        transaction,
      };
    },
  );
  app.post("/api/runtime/stop", async (request) => {
    security.assertCapabilityRequest(request);
    if (!input.requestShutdown)
      throw new RuntimeError(
        "INVALID_OPERATION",
        "This runtime process does not expose lifecycle shutdown.",
        undefined,
        409,
      );
    setImmediate(input.requestShutdown);
    return {
      status: "stopping" as const,
      runtimeId: workspace.runtimeId,
      workspacePath: workspace.root,
    };
  });
  const openStudio = async (): Promise<{ baseUrl: string }> => {
    if (!input.openStudio)
      throw new RuntimeError(
        "INVALID_OPERATION",
        "This runtime was started without a Studio browser launcher.",
        undefined,
        409,
      );
    const nonce = security.issueBootstrapNonce();
    const bootstrapUrl = `${baseUrl}/bootstrap?nonce=${encodeURIComponent(nonce)}&next=${encodeURIComponent("/")}`;
    await input.openStudio(bootstrapUrl);
    return { baseUrl };
  };
  app.post("/api/runtime/studio/open", openStudio);
  app.get("/api/updates/check", async () => updateManager.check());
  app.post("/api/updates/fetch", async () => updateManager.fetch());
  app.post("/api/updates/apply", async () => updateManager.apply());
  app.post("/api/updates/rollback", async () => updateManager.rollback());

  app.get("/api/projects", async () =>
    [...workspace.projects.values()].map(publicProject),
  );
  app.get("/api/brand-kits", async () => ({ kits: listBrandKits(workspace) }));
  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/brand-lint",
    async (request) => {
      const project = requireProject(workspace, request.params.projectId);
      const pin = project.document.brandKitPin;
      if (!pin)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Project has no pinned Brand Kit to audit.",
        );
      const kit = requireBrandKit(workspace, pin.kitId, pin.revision);
      const findings = project.document.frameOrder.flatMap(
        (frameId, index) =>
          auditBrandFrame({
            frame: requireFrame(project, frameId),
            pin,
            kit,
            includeKitOrganization: index === 0,
          }).findings,
      );
      return {
        kitId: kit.id,
        kitRevision: kit.revision,
        deterministic: true as const,
        findings,
        summary: {
          errors: findings.filter((finding) => finding.severity === "error")
            .length,
          warnings: findings.filter((finding) => finding.severity === "warning")
            .length,
          info: findings.filter((finding) => finding.severity === "info")
            .length,
        },
      };
    },
  );
  app.get<{ Params: { kitId: string }; Querystring: { revision?: string } }>(
    "/api/brand-kits/:kitId",
    async (request) => {
      const revision = request.query.revision
        ? Number(request.query.revision)
        : undefined;
      if (
        revision !== undefined &&
        (!Number.isInteger(revision) || revision <= 0)
      )
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Brand Kit revision must be a positive integer.",
        );
      return requireBrandKit(workspace, request.params.kitId, revision);
    },
  );
  app.post<{
    Body: Omit<CreateBrandKitInput, "createdBy"> & {
      actor: { source: "studio" | "http" | "mcp"; id: string };
    };
  }>("/api/brand-kits", async (request) =>
    brandQueue.run("brand-library", async () => {
      const { actor: rawActor, ...rawInput } = request.body;
      const claimedActor = BrandActorSchema.parse(rawActor);
      const actor = security.actorForRequest(request, claimedActor);
      const input = CreateBrandKitInputSchema.parse({
        ...rawInput,
        createdBy: actor.id,
      });
      const kit = await createBrandKitRevision(workspace, input);
      engine.events.emit("brand-kit.created", {
        kitId: kit.id,
        revision: kit.revision,
        actor,
      });
      return kit;
    }),
  );
  app.post<{
    Params: { projectId: string };
    Body: {
      kitId: string;
      revision: number;
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
    };
  }>("/api/projects/:projectId/brand-kit/pin", async (request) => {
    const body = BrandPinRequestSchema.parse(request.body);
    const actor = security.actorForRequest(request, body.actor);
    const project = requireProject(workspace, request.params.projectId);
    const kit = requireBrandKit(workspace, body.kitId, body.revision);
    return pinBrandKitToProject({
      workspace,
      engine,
      project,
      kit,
      baseRevision: body.baseRevision,
      mode: body.mode,
      actor,
    });
  });
  app.post<{
    Params: { projectId: string };
    Body: {
      kitId: string;
      revision: number;
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
    };
  }>("/api/projects/:projectId/brand-kit/migrate", async (request) => {
    const body = BrandPinRequestSchema.parse(request.body);
    const actor = security.actorForRequest(request, body.actor);
    const project = requireProject(workspace, request.params.projectId);
    const kit = requireBrandKit(workspace, body.kitId, body.revision);
    return pinBrandKitToProject({
      workspace,
      engine,
      project,
      kit,
      baseRevision: body.baseRevision,
      mode: body.mode,
      actor,
      migration: true,
    });
  });
  app.post<{
    Params: { projectId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
    };
  }>(
    "/api/projects/:projectId/brand-kit/migration/rollback",
    async (request) => {
      const body = BrandMutationEnvelopeSchema.parse(request.body);
      const actor = security.actorForRequest(request, body.actor);
      const project = requireProject(workspace, request.params.projectId);
      const latest = [...project.history]
        .reverse()
        .find((entry) => entry.scope === "project");
      if (
        latest?.kind !== "mutation" ||
        latest.operations.length !== 1 ||
        latest.operations[0]?.kind !== "migrateBrandKit"
      )
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Explicit Brand migration rollback is available only immediately after a migration commit.",
        );
      return engine.execute({
        schemaVersion: 1,
        mode: body.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: { kind: "project", projectId: request.params.projectId },
        baseRevision: body.baseRevision,
        actor,
        operations: [{ kind: "undo" }],
      });
    },
  );
  app.post<{
    Params: { projectId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
    };
  }>("/api/projects/:projectId/brand-kit/unpin", async (request) => {
    const body = BrandMutationEnvelopeSchema.parse(request.body);
    const actor = security.actorForRequest(request, body.actor);
    return engine.execute({
      schemaVersion: 1,
      mode: body.mode,
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "project", projectId: request.params.projectId },
      baseRevision: body.baseRevision,
      actor,
      operations: [{ kind: "unpinBrandKit" }],
    });
  });
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: ApplyBrandInput & {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/brand/apply",
    async (request) => {
      const {
        baseRevision,
        mode,
        actor: claimedActor,
        ...application
      } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const parsedApplication = ApplyBrandInputSchema.parse(application);
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      const pin = project.document.brandKitPin;
      if (!pin)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Project has no pinned Brand Kit.",
        );
      const kit = requireBrandKit(workspace, pin.kitId, pin.revision);
      const operations = buildBrandFrameOperations(
        project,
        request.params.frameId,
        kit,
        parsedApplication,
      );
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: request.params.projectId,
          frameId: request.params.frameId,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations,
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
      nodeId: string;
      property: "fill" | "stroke" | "textColor";
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/brand-bindings/palette/remove",
    async (request) => {
      const {
        baseRevision,
        mode,
        actor: claimedActor,
        ...rawUnbind
      } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const unbind = UnbindPaletteTokenInputSchema.parse(rawUnbind);
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: project.document.id,
          frameId: frame.id,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations: compilePaletteTokenUnbind({ frame, unbind }),
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
      bindingId: string;
      nodeId: string;
      property: "fill" | "stroke" | "textColor";
      tokenKey: string;
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/brand-bindings/palette",
    async (request) => {
      const {
        baseRevision,
        mode,
        actor: claimedActor,
        ...rawBinding
      } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const binding = BindPaletteTokenInputSchema.parse(rawBinding);
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      const pin = project.document.brandKitPin;
      if (!pin)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Project has no pinned Brand Kit.",
        );
      const kit = requireBrandKit(workspace, pin.kitId, pin.revision);
      const operations = compilePaletteTokenBinding({
        frame,
        pin,
        kit,
        binding,
      });
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: project.document.id,
          frameId: frame.id,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations,
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
      nodeId: string;
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/brand-bindings/radius/remove",
    async (request) => {
      const { baseRevision, mode, actor: claimedActor, ...raw } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const unbind = UnbindRadiusTokenInputSchema.parse(raw);
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: project.document.id,
          frameId: frame.id,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations: compileRadiusTokenUnbind({ frame, unbind }),
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
      bindingId: string;
      nodeId: string;
      tokenKey: string;
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/brand-bindings/radius",
    async (request) => {
      const { baseRevision, mode, actor: claimedActor, ...raw } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const binding = BindRadiusTokenInputSchema.parse(raw);
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      const pin = project.document.brandKitPin;
      if (!pin)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Project has no pinned Brand Kit.",
        );
      const kit = requireBrandKit(workspace, pin.kitId, pin.revision);
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: project.document.id,
          frameId: frame.id,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations: compileRadiusTokenBinding({ frame, pin, kit, binding }),
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
      bindingId: string;
      tokenKey: string;
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/brand-bindings/spacing",
    async (request) => {
      const { baseRevision, mode, actor: claimedActor, ...raw } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const binding = BindSpacingTokenInputSchema.parse(raw);
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      const pin = project.document.brandKitPin;
      if (!pin)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Project has no pinned Brand Kit.",
        );
      const kit = requireBrandKit(workspace, pin.kitId, pin.revision);
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: project.document.id,
          frameId: frame.id,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations: compileSpacingTokenBinding({ frame, pin, kit, binding }),
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/brand-bindings/spacing/remove",
    async (request) => {
      const { baseRevision, mode, actor: claimedActor, ...raw } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const unbind = UnbindSpacingTokenInputSchema.parse(raw);
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: project.document.id,
          frameId: frame.id,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations: compileSpacingTokenUnbind({ frame, unbind }),
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: {
      baseRevision: number;
      mode: "preview" | "commit";
      actor: { source: "studio" | "http" | "mcp"; id: string };
      modeKey: string | null;
    };
  }>(
    "/api/projects/:projectId/frames/:frameId/brand-bindings/variable-mode",
    async (request) => {
      const { baseRevision, mode, actor: claimedActor, ...raw } = request.body;
      const envelope = BrandMutationEnvelopeSchema.parse({
        baseRevision,
        mode,
        actor: claimedActor,
      });
      const variableMode = ApplyVariableModeInputSchema.parse(raw);
      const actor = security.actorForRequest(request, envelope.actor);
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      const pin = project.document.brandKitPin;
      if (!pin)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Project has no pinned Brand Kit.",
        );
      const kit = requireBrandKit(workspace, pin.kitId, pin.revision);
      return engine.execute({
        schemaVersion: 1,
        mode: envelope.mode,
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: {
          kind: "frame",
          projectId: project.document.id,
          frameId: frame.id,
        },
        baseRevision: envelope.baseRevision,
        actor,
        operations: compileVariableMode({
          frame,
          pin,
          kit,
          mode: variableMode,
        }),
        renderPreview: envelope.mode === "preview",
      });
    },
  );
  app.post<{ Body: { id?: string; slug: string; name: string } }>(
    "/api/projects",
    async (request) =>
      engine.execute({
        schemaVersion: 1,
        mode: "commit",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: { kind: "workspace" },
        baseRevision: null,
        actor: security.actorForRequest(request, {
          id: "project-create-route",
        }),
        operations: [
          {
            kind: "createProject",
            projectId: request.body.id ?? randomUUID(),
            slug: request.body.slug,
            name: request.body.name,
          },
        ],
      }),
  );
  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId",
    async (request) =>
      requireProject(workspace, request.params.projectId).document,
  );
  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/frames",
    async (request) => {
      const project = requireProject(workspace, request.params.projectId);
      return project.document.frameOrder
        .map((id) => project.frames.get(id))
        .filter((frame) => frame !== undefined);
    },
  );
  app.get<{ Params: { projectId: string; frameId: string } }>(
    "/api/projects/:projectId/frames/:frameId",
    async (request) => {
      const project = requireProject(workspace, request.params.projectId);
      return requireFrame(project, request.params.frameId);
    },
  );
  app.get<{ Params: { projectId: string; frameId: string } }>(
    "/api/projects/:projectId/frames/:frameId/history",
    async (request) => {
      const project = requireProject(workspace, request.params.projectId);
      requireFrame(project, request.params.frameId);
      return project.history.filter(
        (entry) =>
          entry.scope === "frame" && entry.frameId === request.params.frameId,
      );
    },
  );
  app.get<{ Params: { projectId: string; frameId: string; revision: string } }>(
    "/api/projects/:projectId/frames/:frameId/revisions/:revision",
    async (request) => {
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      const revision = Number(request.params.revision);
      if (
        !Number.isInteger(revision) ||
        revision < 0 ||
        revision > frame.revision
      )
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Revision is outside the available frame history.",
        );
      return reconstructRevision(project.history, frame.id, revision, {
        assets: project.assets.assets,
        fonts: project.fonts.fonts,
        capabilities: workspace.capabilities,
      });
    },
  );
  app.get<{
    Params: { projectId: string; frameId: string };
    Querystring: { left?: string; right?: string };
  }>("/api/projects/:projectId/frames/:frameId/compare", async (request) => {
    const project = requireProject(workspace, request.params.projectId);
    const frame = requireFrame(project, request.params.frameId);
    const left = Number(request.query.left);
    const right = Number(request.query.right);
    if (
      ![left, right].every(
        (revision) =>
          Number.isInteger(revision) &&
          revision >= 0 &&
          revision <= frame.revision,
      )
    )
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Both comparison revisions must be available non-negative integers.",
      );
    const validation = {
      assets: project.assets.assets,
      fonts: project.fonts.fonts,
      capabilities: workspace.capabilities,
    };
    const [leftFrame, rightFrame] = await Promise.all([
      reconstructRevision(project.history, frame.id, left, validation),
      reconstructRevision(project.history, frame.id, right, validation),
    ]);
    return {
      frameId: frame.id,
      leftRevision: left,
      rightRevision: right,
      diff: structuredDiff(leftFrame, rightFrame),
    };
  });
  app.get<{ Params: { projectId: string; frameId: string } }>(
    "/api/projects/:projectId/frames/:frameId/external-conflict",
    async (request) => {
      const project = requireProject(workspace, request.params.projectId);
      requireFrame(project, request.params.frameId);
      return {
        conflict: project.externalConflicts.get(request.params.frameId) ?? null,
      };
    },
  );
  app.post<{ Params: { projectId: string; frameId: string } }>(
    "/api/projects/:projectId/frames/:frameId/external-conflict/revert",
    async (request) => {
      const project = requireProject(workspace, request.params.projectId);
      requireFrame(project, request.params.frameId);
      const conflict = project.externalConflicts.get(request.params.frameId);
      project.externalConflicts.delete(request.params.frameId);
      return { status: "reverted", recoveryPath: conflict?.recoveryPath };
    },
  );
  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/assets",
    async (request) =>
      requireProject(workspace, request.params.projectId).assets,
  );
  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/fonts",
    async (request) =>
      requireProject(workspace, request.params.projectId).fonts,
  );

  app.get<{ Params: { projectId: string; assetId: string } }>(
    "/api/projects/:projectId/assets/:assetId/content",
    async (request, reply) => {
      const project = requireProject(workspace, request.params.projectId);
      const asset = project.assets.assets.find(
        (candidate) => candidate.id === request.params.assetId,
      );
      if (!asset)
        throw new RuntimeError(
          "ASSET_NOT_FOUND",
          "Asset was not found.",
          undefined,
          404,
        );
      const target = await resolveInside(project.directory, asset.path);
      return reply
        .type(asset.mimeType)
        .header("Cache-Control", "private, no-store")
        .send(createReadStream(target));
    },
  );
  app.get<{ Params: { projectId: string; fontId: string } }>(
    "/api/projects/:projectId/fonts/:fontId/content",
    async (request, reply) => {
      const project = requireProject(workspace, request.params.projectId);
      const font = project.fonts.fonts.find(
        (candidate) => candidate.id === request.params.fontId,
      );
      if (!font)
        throw new RuntimeError(
          "FONT_MISSING",
          "Font was not found.",
          undefined,
          404,
        );
      const target = await resolveInside(project.directory, font.path);
      const mime = {
        woff2: "font/woff2",
        woff: "font/woff",
        ttf: "font/ttf",
        otf: "font/otf",
      }[font.format];
      return reply
        .type(mime)
        .header("Cache-Control", "private, no-store")
        .send(createReadStream(target));
    },
  );

  app.post<{ Body: TransactionRequest }>("/api/transactions", async (request) =>
    engine.execute({
      ...request.body,
      actor: security.actorForRequest(request, request.body.actor),
    }),
  );
  app.post<{ Params: { previewId: string } }>(
    "/api/previews/:previewId/commit",
    async (request) => engine.commitPreview(request.params.previewId),
  );
  app.get<{ Params: { previewId: string } }>(
    "/api/proposals/:previewId",
    async (request) =>
      buildProposalView(engine.getPreviewProposal(request.params.previewId)),
  );
  app.get<{ Params: { previewId: string } }>(
    "/api/proposals/:previewId/preview",
    async (request) =>
      buildProposalView(engine.getPreviewProposal(request.params.previewId)),
  );
  app.post<{ Params: { previewId: string } }>(
    "/api/proposals/:previewId/commit",
    async (request) => engine.commitPreview(request.params.previewId),
  );
  app.get<{ Params: { previewId: string } }>(
    "/api/previews/:previewId/render",
    async (request, reply) => {
      const preview = engine.getPreviewFrame(request.params.previewId);
      if (preview.request.scope.kind !== "frame")
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Preview is not frame-scoped.",
        );
      const project = requireProject(
        workspace,
        preview.request.scope.projectId,
      );
      const result = await exportWorker.render(project, preview.frame);
      return reply
        .type("image/png")
        .header("Cache-Control", "private, no-store")
        .header("X-Design-Revision", String(result.revision))
        .header("X-Design-Scene-Hash", result.sceneHash)
        .header("X-Design-Preview-Expires", preview.expiresAt)
        .send(result.bytes);
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/assets/import",
    async (request) => {
      const project = requireProject(workspace, request.params.projectId);
      const upload = await request.file();
      if (!upload)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "A multipart file field is required.",
        );
      const buffer = await upload.toBuffer();
      const baseRevision = parseRevisionField(upload.fields.baseRevision);
      if (baseRevision !== project.document.revision)
        throw new RuntimeError(
          "STALE_REVISION",
          "Project revision changed before import.",
          { expected: project.document.revision, received: baseRevision },
          409,
        );
      const imported = await importAssetBuffer({
        workspace,
        project,
        buffer,
        declaredMime: upload.mimetype,
      });
      try {
        const transaction = await engine.commitVerifiedImport({
          projectId: project.document.id,
          baseRevision,
          actor: security.actorForRequest(request, { id: "asset-import" }),
          operation: { kind: "importAsset", asset: imported.asset },
        });
        engine.events.emit("asset.imported", {
          projectId: project.document.id,
          asset: imported.asset,
          duplicate: imported.duplicate,
          revision: transaction.revision,
        });
        return {
          asset: imported.asset,
          duplicate: imported.duplicate,
          ...(imported.editableVector
            ? { editableVector: imported.editableVector }
            : {}),
          transaction,
        };
      } catch (error) {
        await Promise.all(
          imported.createdPaths.map((target) => rm(target, { force: true })),
        );
        throw error;
      }
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/fonts/import",
    async (request) => {
      const project = requireProject(workspace, request.params.projectId);
      const upload = await request.file();
      if (!upload)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "A multipart file field is required.",
        );
      const buffer = await upload.toBuffer();
      const baseRevision = parseRevisionField(upload.fields.baseRevision);
      const licenseField = upload.fields.licenseNotes;
      const licenseNotes =
        typeof licenseField === "object" &&
        licenseField &&
        "value" in licenseField
          ? String(licenseField.value)
          : undefined;
      if (baseRevision !== project.document.revision)
        throw new RuntimeError(
          "STALE_REVISION",
          "Project revision changed before import.",
          { expected: project.document.revision, received: baseRevision },
          409,
        );
      const imported = await importFontBuffer({
        project,
        buffer,
        filename: upload.filename,
        declaredMime: upload.mimetype,
        ...(licenseNotes ? { licenseNotes } : {}),
      });
      try {
        const transaction = await engine.commitVerifiedImport({
          projectId: project.document.id,
          baseRevision,
          actor: security.actorForRequest(request, { id: "font-import" }),
          operation: { kind: "importFont", font: imported.font },
        });
        engine.events.emit("font.imported", {
          projectId: project.document.id,
          font: imported.font,
          duplicate: imported.duplicate,
          revision: transaction.revision,
        });
        return {
          font: imported.font,
          duplicate: imported.duplicate,
          transaction,
        };
      } catch (error) {
        await Promise.all(
          imported.createdPaths.map((target) => rm(target, { force: true })),
        );
        throw error;
      }
    },
  );

  app.post<{ Params: { projectId: string; frameId: string } }>(
    "/api/projects/:projectId/frames/:frameId/validate",
    async (request) => {
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      return validateWithText(project, frame);
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: { planId?: string };
  }>("/api/projects/:projectId/frames/:frameId/visual-qa", async (request) => {
    const options = VisualQaOptionsSchema.parse(request.body ?? {});
    const project = requireProject(workspace, request.params.projectId);
    const frame = requireFrame(project, request.params.frameId);
    const plan = options.planId
      ? project.document.designPlans?.find(
          (candidate) => candidate.id === options.planId,
        )
      : undefined;
    if (options.planId && !plan)
      throw new RuntimeError(
        "INVALID_OPERATION",
        `Design plan ${options.planId} was not found.`,
        undefined,
        404,
      );
    if (plan?.targetFrameId && plan.targetFrameId !== frame.id)
      throw new RuntimeError(
        "INVALID_OPERATION",
        `Design plan ${plan.id} targets a different frame.`,
        { expected: plan.targetFrameId, received: frame.id },
        409,
      );
    const brief = plan?.briefId
      ? project.document.designBriefs?.find(
          (candidate) => candidate.id === plan.briefId,
        )
      : undefined;
    const pin = project.document.brandKitPin;
    const brandKit = pin
      ? requireBrandKit(workspace, pin.kitId, pin.revision)
      : undefined;
    return auditVisualQuality({
      projectId: project.document.id,
      frame,
      validation: await validateWithText(project, frame),
      ...(plan ? { plan } : {}),
      ...(brief ? { brief } : {}),
      ...(brandKit ? { brandKit } : {}),
    });
  });
  app.post<{ Params: { projectId: string; frameId: string } }>(
    "/api/projects/:projectId/frames/:frameId/render-preview",
    async (request, reply) => {
      const project = requireProject(workspace, request.params.projectId);
      const frame = requireFrame(project, request.params.frameId);
      const result = await exportWorker.render(project, frame);
      return reply
        .type("image/png")
        .header("Cache-Control", "private, no-store")
        .header("X-Design-Revision", String(result.revision))
        .header("X-Design-Scene-Hash", result.sceneHash)
        .send(result.bytes);
    },
  );
  app.post<{
    Params: { projectId: string; frameId: string };
    Body: Partial<ExportSettings> | undefined;
  }>("/api/projects/:projectId/frames/:frameId/export", async (request) => {
    const project = requireProject(workspace, request.params.projectId);
    const frame = requireFrame(project, request.params.frameId);
    const settings = normalizeExportSettings(request.body);
    await requireExportable(project, frame);
    engine.events.emit("export.started", {
      projectId: project.document.id,
      frameId: frame.id,
      revision: frame.revision,
      format: settings.format,
      scale: settings.scale,
    });
    try {
      const result = await exportWorker.export(project, frame, settings);
      await engine.metrics.update({
        lastExportDurationMs: result.durationMs,
      });
      engine.events.emit("export.completed", {
        projectId: project.document.id,
        frameId: frame.id,
        ...result,
      });
      return result;
    } catch (error) {
      engine.events.emit("export.failed", {
        projectId: project.document.id,
        frameId: frame.id,
        code: asRuntimeError(error).code,
      });
      throw error;
    }
  });
  app.post<{
    Params: { projectId: string };
    Body: unknown;
  }>("/api/projects/:projectId/export", async (request) => {
    const project = requireProject(workspace, request.params.projectId);
    const batch = BatchExportRequestSchema.parse(request.body);
    const settings = normalizeExportSettings(batch.settings);
    const frames = batch.frameIds.map((frameId) =>
      requireFrame(project, frameId),
    );
    await Promise.all(frames.map((frame) => requireExportable(project, frame)));
    frames.forEach((frame) =>
      exportWorker.assertExportSupported(frame, settings),
    );
    const started = performance.now();
    const exports = [];
    for (const frame of frames) {
      engine.events.emit("export.started", {
        projectId: project.document.id,
        frameId: frame.id,
        revision: frame.revision,
        format: settings.format,
        scale: settings.scale,
        batch: true,
      });
      try {
        const result = await exportWorker.export(project, frame, settings);
        exports.push({ frameId: frame.id, frameName: frame.name, ...result });
        engine.events.emit("export.completed", {
          projectId: project.document.id,
          frameId: frame.id,
          ...result,
          batch: true,
        });
      } catch (error) {
        engine.events.emit("export.failed", {
          projectId: project.document.id,
          frameId: frame.id,
          code: asRuntimeError(error).code,
          batch: true,
        });
        throw new RuntimeError(
          asRuntimeError(error).code,
          `Batch export stopped at “${frame.name}”: ${asRuntimeError(error).message}`,
          { completed: exports },
          asRuntimeError(error).statusCode,
        );
      }
    }
    const durationMs = performance.now() - started;
    await engine.metrics.update({ lastExportDurationMs: durationMs });
    return {
      projectId: project.document.id,
      format: settings.format,
      scale: settings.scale,
      durationMs,
      exports,
    };
  });

  app.get("/api/diagnostics", async () => ({
    runtime: {
      id: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      startedAt: workspace.startedAt,
    },
    capabilities: workspace.capabilities,
    projects: await Promise.all(
      [...workspace.projects.values()].map(async (project) => ({
        id: project.document.id,
        revision: project.document.revision,
        projectHash: await fullDocumentHash(project.document),
        frames: project.document.frameOrder
          .map((frameId) => project.frames.get(frameId))
          .filter((frame): frame is FrameDocument => frame !== undefined)
          .map((frame) => ({
            id: frame.id,
            revision: frame.revision,
            nodeCount: validateFrame(frame).nodeCount,
            estimatedTextureMemoryBytes: estimateTextureMemory(
              frame,
              project.assets.assets,
            ),
            blocked: project.blockedFrames.get(frame.id),
          })),
      })),
    ),
    metrics: engine.metrics.state,
  }));
  app.get("/api/logs/recent", async () => engine.logger.recentLines());
  app.get("/api/metrics", async () => engine.metrics.state);

  app.get("/api/events", { websocket: true }, (socket, request) => {
    security.assertSocket(request);
    const connection = security.connectionForRequest(request);
    const unsubscribe = engine.events.subscribe((event) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
    });
    socket.on("close", unsubscribe);
    socket.send(
      JSON.stringify(
        engine.events.emit("workspace.loaded", {
          projectCount: workspace.projects.size,
          connection,
        }),
      ),
    );
  });

  const studioExists = await stat(input.studioDirectory)
    .then((entry) => entry.isDirectory())
    .catch(() => false);
  if (studioExists) {
    await app.register(fastifyStatic, {
      root: input.studioDirectory,
      wildcard: false,
    });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/"))
        return reply.sendFile("index.html");
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Route was not found.",
        { route: request.url },
        404,
      );
    });
  } else {
    app.get("/", async (_request, reply) =>
      reply
        .type("text/html")
        .send(
          "<!doctype html><title>Agentic Design Runtime</title><main>Studio assets have not been built.</main>",
        ),
    );
  }

  await app.listen({ host, port });
  try {
    await exportWorker.prepare(baseUrl);
    applyRendererCapabilities(workspace, await exportWorker.capabilities());
  } catch (error) {
    await exportWorker.close();
    await app.close();
    throw error;
  }
  const bootstrapNonce = security.issueBootstrapNonce();
  engine.events.emit("runtime.ready", { baseUrl });
  engine.events.emit("workspace.loaded", {
    projectCount: workspace.projects.size,
  });

  return {
    app,
    security,
    exportWorker,
    baseUrl,
    bootstrapNonce,
    openStudio,
    close: async () => {
      engine.events.emit("runtime.stopping", {});
      await exportWorker.close();
      await app.close();
    },
  };
};
