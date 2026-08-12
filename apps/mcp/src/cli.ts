#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DesignRuntimeApiError,
  DesignRuntimeClient,
} from "@agentic-design/client";
import {
  CreateBrandKitInputSchema,
  DesignBriefInputSchema,
  DesignPlanInputSchema,
  FrameOperationSchema,
  ProjectOperationSchema,
  WorkspaceOperationSchema,
  createDesignBrief,
  createDesignPlan,
  detachTemplateInstanceOperations,
  detachBrandComponentOperations,
  findNode,
  searchNodes,
  templateSourceNodeIds,
} from "@agentic-design/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { PRODUCT_VERSION } from "./version.js";

type Descriptor = {
  schemaVersion: 1;
  runtimeId: string;
  workspaceId: string;
  workspacePath: string;
  baseUrl: string;
  pid: number;
  startedAt: string;
  capabilityToken: string;
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const loadDescriptor = async (arguments_: string[]): Promise<Descriptor> => {
  const runtimeIndex = arguments_.indexOf("--runtime");
  const descriptorIndex = arguments_.indexOf("--descriptor");
  const workspaceIndex = arguments_.indexOf("--workspace");
  const runtimeDirectory = path.join(homedir(), ".design-runtime", "runtimes");
  const explicitPath =
    descriptorIndex >= 0 && arguments_[descriptorIndex + 1]
      ? path.resolve(arguments_[descriptorIndex + 1]!)
      : runtimeIndex >= 0 && arguments_[runtimeIndex + 1]
        ? path.join(runtimeDirectory, `${arguments_[runtimeIndex + 1]}.json`)
        : undefined;
  const candidates = explicitPath
    ? [explicitPath]
    : (await readdir(runtimeDirectory, { withFileTypes: true }).catch(() => []))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => path.join(runtimeDirectory, entry.name));
  const descriptors: Descriptor[] = [];
  for (const candidate of candidates) {
    const info = await stat(candidate).catch(() => undefined);
    if (!info?.isFile() || (info.mode & 0o077) !== 0) continue;
    const descriptor = await readFile(candidate, "utf8")
      .then((value) => JSON.parse(value) as Descriptor)
      .catch(() => undefined);
    if (
      !descriptor ||
      descriptor.schemaVersion !== 1 ||
      !processExists(descriptor.pid)
    )
      continue;
    if (workspaceIndex >= 0 && arguments_[workspaceIndex + 1]) {
      const requested = await realpath(arguments_[workspaceIndex + 1]!).catch(
        () => path.resolve(arguments_[workspaceIndex + 1]!),
      );
      if (descriptor.workspacePath !== requested) continue;
    }
    descriptors.push(descriptor);
  }
  descriptors.sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
  const descriptor = descriptors[0];
  if (!descriptor)
    throw new Error(
      "No active owner-only Agentic Design Runtime descriptor matched. Start design-runtime dev first.",
    );
  return descriptor;
};

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  structuredContent:
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { result: value },
});

const toolError = (error: unknown) => {
  if (error instanceof DesignRuntimeApiError)
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: {
                code: error.code,
                message: error.message,
                requestId: error.requestId,
                details: error.details,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
  };
};

const safe =
  <T extends Record<string, unknown>>(
    handler: (arguments_: T) => Promise<unknown>,
  ) =>
  async (arguments_: T) => {
    try {
      return textResult(await handler(arguments_));
    } catch (error) {
      return toolError(error);
    }
  };

export const runMcp = async (
  arguments_ = process.argv.slice(2),
): Promise<void> => {
  if (arguments_.includes("--version")) {
    process.stdout.write(`${PRODUCT_VERSION}\n`);
    return;
  }
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    process.stdout.write(
      "Usage: design-runtime-mcp [--runtime <id> | --workspace <path> | --descriptor <path>]\n",
    );
    return;
  }
  const descriptor = await loadDescriptor(arguments_);
  const client = new DesignRuntimeClient({
    baseUrl: descriptor.baseUrl,
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    capabilityToken: descriptor.capabilityToken,
    clientType: "mcp",
    clientLabel: "Direct MCP",
  });
  await client.getRuntime();
  const server = new McpServer({
    name: "agentic-design-runtime",
    version: PRODUCT_VERSION,
  });

  server.registerTool(
    "runtime_status",
    {
      title: "Runtime status",
      description:
        "Inspect the active local runtime, workspace, versions, and render capabilities.",
    },
    safe(async () => client.getRuntime()),
  );
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List all editable projects in the active workspace.",
    },
    safe(async () => ({ projects: await client.listProjects() })),
  );
  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description:
        "Inspect one project manifest and its current project revision.",
      inputSchema: { projectId: z.string().uuid() },
    },
    safe(async ({ projectId }) => client.getProject(String(projectId))),
  );
  server.registerTool(
    "list_frames",
    {
      title: "List frames",
      description: "List the canonical frames and revisions in a project.",
      inputSchema: { projectId: z.string().uuid() },
    },
    safe(async ({ projectId }) => ({
      frames: await client.listFrames(String(projectId)),
    })),
  );
  server.registerTool(
    "get_frame",
    {
      title: "Get frame",
      description:
        "Inspect the complete canonical layered scene for one frame.",
      inputSchema: { projectId: z.string().uuid(), frameId: z.string().uuid() },
    },
    safe(async ({ projectId, frameId }) =>
      client.getFrame(String(projectId), String(frameId)),
    ),
  );
  server.registerTool(
    "get_node",
    {
      title: "Get node",
      description: "Inspect one stable-ID scene node.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        nodeId: z.string().uuid(),
      },
    },
    safe(async ({ projectId, frameId, nodeId }) => {
      const frame = await client.getFrame(String(projectId), String(frameId));
      const node = findNode(frame, String(nodeId));
      if (!node) throw new Error(`NODE_NOT_FOUND: ${String(nodeId)}`);
      return node;
    }),
  );
  server.registerTool(
    "search_nodes",
    {
      title: "Search nodes",
      description:
        "Search a frame by layer name, type, visibility, or lock state before editing.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        text: z.string().optional(),
        types: z
          .array(
            z.enum([
              "group",
              "rasterImage",
              "text",
              "rectangle",
              "ellipse",
              "vectorPath",
              "svg",
              "mask",
              "adjustment",
            ]),
          )
          .optional(),
        visible: z.boolean().optional(),
        locked: z.boolean().optional(),
      },
    },
    safe(async ({ projectId, frameId, text, types, visible, locked }) => {
      const frame = await client.getFrame(String(projectId), String(frameId));
      return {
        nodes: searchNodes(frame, {
          ...(text ? { text: String(text) } : {}),
          ...(types ? { types: types as never } : {}),
          ...(visible !== undefined ? { visible: Boolean(visible) } : {}),
          ...(locked !== undefined ? { locked: Boolean(locked) } : {}),
        }),
      };
    }),
  );
  server.registerTool(
    "list_assets",
    {
      title: "List assets",
      description:
        "Inspect stable raster and SVG asset IDs, hashes, dimensions, and local project paths.",
      inputSchema: { projectId: z.string().uuid() },
    },
    safe(async ({ projectId }) => client.getAssets(String(projectId))),
  );
  server.registerTool(
    "list_fonts",
    {
      title: "List fonts",
      description:
        "Inspect project font IDs, hashes, styles, weights, and license notes.",
      inputSchema: { projectId: z.string().uuid() },
    },
    safe(async ({ projectId }) => client.getFonts(String(projectId))),
  );
  for (const action of ["check", "fetch", "apply", "rollback"] as const) {
    server.registerTool(
      `update_${action}`,
      {
        title: `ADR update ${action}`,
        description:
          action === "check"
            ? "Read the trusted official update manifest without changing local state."
            : action === "fetch"
              ? "Stage and verify an official runtime update without activating it."
              : action === "apply"
                ? "Request explicit activation. A running runtime will refuse and require a stopped-runtime/new-task handoff."
                : "Request explicit rollback to the retained known-good runtime. A running runtime will refuse.",
      },
      safe(async () =>
        action === "check"
          ? client.checkForUpdate()
          : action === "fetch"
            ? client.fetchUpdate()
            : action === "apply"
              ? client.applyUpdate()
              : client.rollbackUpdate(),
      ),
    );
  }
  server.registerTool(
    "list_brand_kits",
    {
      title: "List Brand Kits",
      description:
        "List latest immutable Brand Kit revisions owned by this workspace.",
    },
    safe(async () => client.listBrandKits()),
  );
  server.registerTool(
    "audit_brand_system",
    {
      title: "Audit Brand system",
      description:
        "Return deterministic exact-pin Brand integrity, organization, and unbound-token findings without mutating the project.",
      inputSchema: { projectId: z.string().uuid() },
    },
    safe(async ({ projectId }) => client.auditBrand(String(projectId))),
  );
  server.registerTool(
    "get_brand_kit",
    {
      title: "Get Brand Kit",
      description:
        "Inspect one immutable Brand Kit revision, tokens, resources, and reusable definitions.",
      inputSchema: {
        kitId: z.string().uuid(),
        revision: z.number().int().positive().optional(),
      },
    },
    safe(async ({ kitId, revision }) =>
      client.getBrandKit(
        String(kitId),
        revision ? Number(revision) : undefined,
      ),
    ),
  );
  server.registerTool(
    "create_brand_kit",
    {
      title: "Create Brand Kit revision",
      description:
        "Create an immutable workspace Brand Kit revision from verified assets and fonts in one source project.",
      inputSchema: {
        kitId: CreateBrandKitInputSchema.shape.kitId,
        name: CreateBrandKitInputSchema.shape.name,
        description: CreateBrandKitInputSchema.shape.description,
        sourceProjectId: CreateBrandKitInputSchema.shape.sourceProjectId,
        provenance: CreateBrandKitInputSchema.shape.provenance,
        licenseNotes: CreateBrandKitInputSchema.shape.licenseNotes,
        palette: CreateBrandKitInputSchema.shape.palette,
        typeRoles: CreateBrandKitInputSchema.shape.typeRoles,
        effectStyles: CreateBrandKitInputSchema.shape.effectStyles,
        radiusTokens: CreateBrandKitInputSchema.shape.radiusTokens,
        spacingTokens: CreateBrandKitInputSchema.shape.spacingTokens,
        variableModes: CreateBrandKitInputSchema.shape.variableModes,
        logos: CreateBrandKitInputSchema.shape.logos,
        definitions: CreateBrandKitInputSchema.shape.definitions,
      },
    },
    safe(async (input) =>
      client.createBrandKit({
        ...(input.kitId ? { kitId: String(input.kitId) } : {}),
        name: String(input.name),
        ...(input.description
          ? { description: String(input.description) }
          : {}),
        sourceProjectId: String(input.sourceProjectId),
        provenance: String(input.provenance),
        licenseNotes: String(input.licenseNotes),
        palette: input.palette as never,
        typeRoles: input.typeRoles as never,
        ...(input.effectStyles
          ? { effectStyles: input.effectStyles as never }
          : {}),
        ...(input.radiusTokens
          ? { radiusTokens: input.radiusTokens as never }
          : {}),
        ...(input.spacingTokens
          ? { spacingTokens: input.spacingTokens as never }
          : {}),
        ...(input.variableModes
          ? { variableModes: input.variableModes as never }
          : {}),
        logos: input.logos as never,
        definitions: input.definitions as never,
        actor: { source: "mcp", id: "brand-kit" },
      }),
    ),
  );
  server.registerTool(
    "pin_brand_kit",
    {
      title: "Pin Brand Kit",
      description:
        "Preview or commit a project pin to an exact immutable Brand Kit revision. Runtime-owned bytes are verified and copied into the project.",
      inputSchema: {
        projectId: z.string().uuid(),
        kitId: z.string().uuid(),
        revision: z.number().int().positive(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]),
      },
    },
    safe(async ({ projectId, kitId, revision, baseRevision, mode }) =>
      client.pinBrandKit({
        projectId: String(projectId),
        kitId: String(kitId),
        revision: Number(revision),
        baseRevision: Number(baseRevision),
        mode: mode as "preview" | "commit",
        actor: { source: "mcp", id: "brand-kit" },
      }),
    ),
  );
  server.registerTool(
    "unpin_brand_kit",
    {
      title: "Detach Brand Kit",
      description:
        "Preview or commit detaching the project pin without changing existing artwork.",
      inputSchema: {
        projectId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]),
      },
    },
    safe(async ({ projectId, baseRevision, mode }) =>
      client.unpinBrandKit({
        projectId: String(projectId),
        baseRevision: Number(baseRevision),
        mode: mode as "preview" | "commit",
        actor: { source: "mcp", id: "brand-kit" },
      }),
    ),
  );
  server.registerTool(
    "migrate_brand_kit_revision",
    {
      title: "Migrate Brand Kit revision",
      description:
        "Preview or commit an atomic exact-revision migration of every live Brand binding and compatible component instance. Never selects latest implicitly.",
      inputSchema: {
        projectId: z.string().uuid(),
        kitId: z.string().uuid(),
        revision: z.number().int().positive(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]),
      },
    },
    safe(async ({ projectId, kitId, revision, baseRevision, mode }) =>
      client.migrateBrandKit({
        projectId: String(projectId),
        kitId: String(kitId),
        revision: Number(revision),
        baseRevision: Number(baseRevision),
        mode: mode as "preview" | "commit",
        actor: { source: "mcp", id: "brand-migration" },
      }),
    ),
  );
  server.registerTool(
    "rollback_brand_kit_migration",
    {
      title: "Rollback Brand Kit migration",
      description:
        "Preview or commit the exact inverse of the immediately preceding Brand migration.",
      inputSchema: {
        projectId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]),
      },
    },
    safe(async ({ projectId, baseRevision, mode }) =>
      client.rollbackBrandMigration({
        projectId: String(projectId),
        baseRevision: Number(baseRevision),
        mode: mode as "preview" | "commit",
        actor: { source: "mcp", id: "brand-migration" },
      }),
    ),
  );
  server.registerTool(
    "apply_brand",
    {
      title: "Apply Brand Kit",
      description:
        "Preview or commit palette, type, logo, or reusable-definition applications from the project's pinned kit.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]),
        palette: z
          .array(
            z.object({
              nodeId: z.string().uuid(),
              token: z.string(),
              property: z.enum(["fill", "textColor"]),
            }),
          )
          .optional(),
        typeRoles: z
          .array(z.object({ nodeId: z.string().uuid(), role: z.string() }))
          .optional(),
        logo: z
          .object({
            key: z.string(),
            nodeId: z.string().uuid(),
            parentId: z.string(),
            index: z.number().int().nonnegative().optional(),
            x: z.number(),
            y: z.number(),
            width: z.number().positive().optional(),
            height: z.number().positive().optional(),
          })
          .optional(),
        definition: z
          .object({
            key: z.string(),
            parentId: z.string(),
            index: z.number().int().nonnegative().optional(),
            idMap: z.record(z.string(), z.string().uuid()),
            instanceId: z.string().uuid().optional(),
          })
          .optional(),
      },
    },
    safe(
      async ({
        projectId,
        frameId,
        baseRevision,
        mode,
        palette,
        typeRoles,
        logo,
        definition,
      }) =>
        client.applyBrand({
          projectId: String(projectId),
          frameId: String(frameId),
          baseRevision: Number(baseRevision),
          mode: mode as "preview" | "commit",
          actor: { source: "mcp", id: "brand-kit" },
          ...(palette ? { palette: palette as never } : {}),
          ...(typeRoles ? { typeRoles: typeRoles as never } : {}),
          ...(logo ? { logo: logo as never } : {}),
          ...(definition ? { definition: definition as never } : {}),
        }),
    ),
  );
  server.registerTool(
    "detach_brand_component",
    {
      title: "Detach Brand component instance",
      description:
        "Preview or commit removal of exact-pin component identity while preserving every visible node, value, stable node ID, and layer relationship.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        instanceId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        projectId,
        frameId,
        instanceId,
        baseRevision,
        mode,
        actorId,
      }) => {
        const frame = await client.getFrame(String(projectId), String(frameId));
        return client.transact({
          schemaVersion: 1,
          mode: mode === "commit" ? "commit" : "preview",
          scope: {
            kind: "frame",
            projectId: String(projectId),
            frameId: String(frameId),
          },
          baseRevision: Number(baseRevision),
          actor: {
            source: "mcp",
            id: String(actorId ?? "brand-component-agent"),
          },
          operations: detachBrandComponentOperations(frame, String(instanceId)),
        });
      },
    ),
  );
  server.registerTool(
    "bind_live_palette_token",
    {
      title: "Bind live palette token",
      description:
        "Preview or commit one selected node property as a live binding to a palette token in the project's exact immutable Brand Kit pin. Direct later edits detach only that property binding.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        bindingId: z.string().uuid(),
        nodeId: z.string().uuid(),
        property: z.enum(["fill", "stroke", "textColor"]),
        tokenKey: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        projectId,
        frameId,
        baseRevision,
        mode,
        bindingId,
        nodeId,
        property,
        tokenKey,
        actorId,
      }) =>
        client.bindPaletteToken({
          projectId: String(projectId),
          frameId: String(frameId),
          baseRevision: Number(baseRevision),
          mode: mode === "commit" ? "commit" : "preview",
          actor: { source: "mcp", id: String(actorId ?? "live-brand") },
          bindingId: String(bindingId),
          nodeId: String(nodeId),
          property: property as "fill" | "stroke" | "textColor",
          tokenKey: String(tokenKey),
        }),
    ),
  );
  server.registerTool(
    "unbind_live_palette_token",
    {
      title: "Detach live palette token",
      description:
        "Preview or commit detaching one live palette binding while preserving the property's current materialized appearance.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        nodeId: z.string().uuid(),
        property: z.enum(["fill", "stroke", "textColor"]),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        projectId,
        frameId,
        baseRevision,
        mode,
        nodeId,
        property,
        actorId,
      }) =>
        client.unbindPaletteToken({
          projectId: String(projectId),
          frameId: String(frameId),
          baseRevision: Number(baseRevision),
          mode: mode === "commit" ? "commit" : "preview",
          actor: { source: "mcp", id: String(actorId ?? "live-brand") },
          nodeId: String(nodeId),
          property: property as "fill" | "stroke" | "textColor",
        }),
    ),
  );
  server.registerTool(
    "bind_live_typography_role",
    {
      title: "Bind live typography role",
      description:
        "Preview or commit one text layer as a live binding to a type role in the project's exact immutable Brand Kit pin and font resource map. Direct paragraph typography edits detach the role binding.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        bindingId: z.string().uuid(),
        nodeId: z.string().uuid(),
        roleKey: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        projectId,
        frameId,
        baseRevision,
        mode,
        bindingId,
        nodeId,
        roleKey,
        actorId,
      }) =>
        client.bindTypographyRole({
          projectId: String(projectId),
          frameId: String(frameId),
          baseRevision: Number(baseRevision),
          mode: mode === "commit" ? "commit" : "preview",
          actor: { source: "mcp", id: String(actorId ?? "live-brand") },
          bindingId: String(bindingId),
          nodeId: String(nodeId),
          roleKey: String(roleKey),
        }),
    ),
  );
  server.registerTool(
    "unbind_live_typography_role",
    {
      title: "Detach live typography role",
      description:
        "Preview or commit detaching one live typography-role binding while preserving the text layer's current materialized appearance.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        nodeId: z.string().uuid(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async ({ projectId, frameId, baseRevision, mode, nodeId, actorId }) =>
      client.unbindTypographyRole({
        projectId: String(projectId),
        frameId: String(frameId),
        baseRevision: Number(baseRevision),
        mode: mode === "commit" ? "commit" : "preview",
        actor: { source: "mcp", id: String(actorId ?? "live-brand") },
        nodeId: String(nodeId),
      }),
    ),
  );
  server.registerTool(
    "bind_live_effect_style",
    {
      title: "Bind live effect style",
      description:
        "Preview or commit one node's ordered non-destructive effects as a live binding to an effect style in the project's exact immutable Brand Kit pin.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        bindingId: z.string().uuid(),
        nodeId: z.string().uuid(),
        styleKey: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async (input) =>
      client.bindEffectStyle({
        projectId: String(input.projectId),
        frameId: String(input.frameId),
        baseRevision: Number(input.baseRevision),
        mode: input.mode === "commit" ? "commit" : "preview",
        actor: { source: "mcp", id: String(input.actorId ?? "live-brand") },
        bindingId: String(input.bindingId),
        nodeId: String(input.nodeId),
        styleKey: String(input.styleKey),
      }),
    ),
  );
  server.registerTool(
    "unbind_live_effect_style",
    {
      title: "Detach live effect style",
      description:
        "Preview or commit detaching one live effect-style binding while preserving the node's current materialized effects.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        nodeId: z.string().uuid(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async (input) =>
      client.unbindEffectStyle({
        projectId: String(input.projectId),
        frameId: String(input.frameId),
        baseRevision: Number(input.baseRevision),
        mode: input.mode === "commit" ? "commit" : "preview",
        actor: { source: "mcp", id: String(input.actorId ?? "live-brand") },
        nodeId: String(input.nodeId),
      }),
    ),
  );
  server.registerTool(
    "bind_live_radius_token",
    {
      title: "Bind live radius token",
      description:
        "Preview or commit one rectangle's four canonical corner radii as a live binding to a named token in the exact pinned Brand Kit.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        bindingId: z.string().uuid(),
        nodeId: z.string().uuid(),
        tokenKey: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async (input) =>
      client.bindRadiusToken({
        projectId: String(input.projectId),
        frameId: String(input.frameId),
        baseRevision: Number(input.baseRevision),
        mode: input.mode === "commit" ? "commit" : "preview",
        actor: { source: "mcp", id: String(input.actorId ?? "live-brand") },
        bindingId: String(input.bindingId),
        nodeId: String(input.nodeId),
        tokenKey: String(input.tokenKey),
      }),
    ),
  );
  server.registerTool(
    "unbind_live_radius_token",
    {
      title: "Detach live radius token",
      description:
        "Preview or commit detaching one radius binding while preserving the rectangle's current corner radii.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        nodeId: z.string().uuid(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async (input) =>
      client.unbindRadiusToken({
        projectId: String(input.projectId),
        frameId: String(input.frameId),
        baseRevision: Number(input.baseRevision),
        mode: input.mode === "commit" ? "commit" : "preview",
        actor: { source: "mcp", id: String(input.actorId ?? "live-brand") },
        nodeId: String(input.nodeId),
      }),
    ),
  );
  server.registerTool(
    "bind_live_spacing_token",
    {
      title: "Bind live spacing token",
      description:
        "Preview or commit the canvas safe area as one uniform live spacing token from the exact pinned Brand Kit.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        bindingId: z.string().uuid(),
        tokenKey: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async (input) =>
      client.bindSpacingToken({
        projectId: String(input.projectId),
        frameId: String(input.frameId),
        baseRevision: Number(input.baseRevision),
        mode: input.mode === "commit" ? "commit" : "preview",
        actor: { source: "mcp", id: String(input.actorId ?? "live-brand") },
        bindingId: String(input.bindingId),
        tokenKey: String(input.tokenKey),
      }),
    ),
  );
  server.registerTool(
    "unbind_live_spacing_token",
    {
      title: "Detach live spacing token",
      description:
        "Preview or commit detaching the canvas safe-area spacing binding while preserving its current insets.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async (input) =>
      client.unbindSpacingToken({
        projectId: String(input.projectId),
        frameId: String(input.frameId),
        baseRevision: Number(input.baseRevision),
        mode: input.mode === "commit" ? "commit" : "preview",
        actor: { source: "mcp", id: String(input.actorId ?? "live-brand") },
      }),
    ),
  );
  server.registerTool(
    "apply_live_variable_mode",
    {
      title: "Apply live variable mode",
      description:
        "Preview or commit one exact pinned Brand palette mode across every compatible live binding in the frame. Pass null to restore base palette values.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        modeKey: z
          .string()
          .regex(/^[a-z][a-z0-9-]{0,63}$/)
          .nullable(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async (input) =>
      client.applyVariableMode({
        projectId: String(input.projectId),
        frameId: String(input.frameId),
        baseRevision: Number(input.baseRevision),
        mode: input.mode === "commit" ? "commit" : "preview",
        actor: { source: "mcp", id: String(input.actorId ?? "live-brand") },
        modeKey: input.modeKey === null ? null : String(input.modeKey),
      }),
    ),
  );
  server.registerTool(
    "switch_brand_component_variant",
    {
      title: "Switch Brand component variant",
      description:
        "Preview or commit a compatible variant from the exact pinned Brand Kit while preserving canonical node IDs and active overrides.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        instanceId: z.string().uuid(),
        definitionKey: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async (input) =>
      client.switchBrandComponentVariant({
        projectId: String(input.projectId),
        frameId: String(input.frameId),
        instanceId: String(input.instanceId),
        definitionKey: String(input.definitionKey),
        baseRevision: Number(input.baseRevision),
        mode: input.mode === "commit" ? "commit" : "preview",
        actor: {
          source: "mcp",
          id: String(input.actorId ?? "brand-component-agent"),
        },
      }),
    ),
  );
  server.registerTool(
    "get_history",
    {
      title: "Get frame history",
      description:
        "Inspect append-only frame revisions, actors, operations, inverses, and semantic hashes.",
      inputSchema: { projectId: z.string().uuid(), frameId: z.string().uuid() },
    },
    safe(async ({ projectId, frameId }) => ({
      history: await client.getHistory(String(projectId), String(frameId)),
    })),
  );
  server.registerTool(
    "get_revision",
    {
      title: "Reconstruct revision",
      description:
        "Reconstruct and hash-verify an immutable historical frame revision.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        revision: z.number().int().min(0),
      },
    },
    safe(async ({ projectId, frameId, revision }) =>
      client.getRevision(String(projectId), String(frameId), Number(revision)),
    ),
  );
  server.registerTool(
    "compare_revisions",
    {
      title: "Compare revisions",
      description:
        "Return a structured semantic diff between two hash-verified frame revisions.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        left: z.number().int().min(0),
        right: z.number().int().min(0),
      },
    },
    safe(async ({ projectId, frameId, left, right }) =>
      client.compareRevisions(
        String(projectId),
        String(frameId),
        Number(left),
        Number(right),
      ),
    ),
  );
  server.registerTool(
    "validate_frame",
    {
      title: "Validate frame",
      description:
        "Run canonical schema, dependency, capability, and quality validation.",
      inputSchema: { projectId: z.string().uuid(), frameId: z.string().uuid() },
    },
    safe(async ({ projectId, frameId }) =>
      client.validateFrame(String(projectId), String(frameId)),
    ),
  );
  server.registerTool(
    "audit_visual_quality",
    {
      title: "Audit visual quality",
      description:
        "Run read-only deterministic visual QA. Findings are objective checks; heuristic and model-judged categories remain explicitly unevaluated.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        planId: z.string().uuid().optional(),
      },
    },
    safe(async ({ projectId, frameId, planId }) =>
      client.auditVisualQuality(
        String(projectId),
        String(frameId),
        planId ? String(planId) : undefined,
      ),
    ),
  );

  const actorId = z.string().min(1).max(128).default("agent");
  const batchSchema = z.discriminatedUnion("scope", [
    z
      .object({
        scope: z.literal("workspace"),
        baseRevision: z.null(),
        operations: z.array(WorkspaceOperationSchema).length(1),
        actorId,
      })
      .strict(),
    z
      .object({
        scope: z.literal("project"),
        projectId: z.string().uuid(),
        baseRevision: z.number().int().min(0),
        operations: z.array(ProjectOperationSchema).min(1),
        actorId,
      })
      .strict(),
    z
      .object({
        scope: z.literal("frame"),
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().min(0),
        operations: z.array(FrameOperationSchema).min(1),
        actorId,
      })
      .strict(),
  ]);
  const batch = async (
    mode: "preview" | "commit",
    input: z.infer<typeof batchSchema>,
  ) => {
    const common = {
      schemaVersion: 1 as const,
      mode,
      actor: { source: "mcp" as const, id: input.actorId },
      renderPreview: mode === "preview",
    };
    if (input.scope === "workspace")
      return client.transact({
        ...common,
        scope: { kind: "workspace" },
        baseRevision: input.baseRevision,
        operations: input.operations,
      });
    if (input.scope === "project")
      return client.transact({
        ...common,
        scope: { kind: "project", projectId: input.projectId },
        baseRevision: input.baseRevision,
        operations: input.operations,
      });
    return client.transact({
      ...common,
      scope: {
        kind: "frame",
        projectId: input.projectId,
        frameId: input.frameId,
      },
      baseRevision: input.baseRevision,
      operations: input.operations,
    });
  };
  server.registerTool(
    "preview_batch",
    {
      title: "Preview atomic batch",
      description:
        "Simulate one typed, single-scope batch without changing canonical state. Returns a stable operation hash, structured diff, warnings, and affected nodes.",
      inputSchema: batchSchema,
    },
    safe(async (input) => batch("preview", input)),
  );
  server.registerTool(
    "commit_batch",
    {
      title: "Commit atomic batch",
      description:
        "Commit one typed, revision-checked batch as exactly one append-only revision.",
      inputSchema: batchSchema,
    },
    safe(async (input) => batch("commit", input)),
  );
  server.registerTool(
    "commit_preview",
    {
      title: "Commit preview",
      description:
        "Commit an unexpired preview after operation-hash and revision verification.",
      inputSchema: { previewId: z.string().uuid() },
    },
    safe(async ({ previewId }) => client.commitPreview(String(previewId))),
  );
  server.registerTool(
    "explain_proposed_changes",
    {
      title: "Explain proposed changes",
      description:
        "Explain the exact operations and structured diff stored by an unexpired canonical preview. The proposal ID is the preview ID; no duplicate mutation state is created.",
      inputSchema: { previewId: z.string().uuid() },
    },
    safe(async ({ previewId }) =>
      client.explainProposedChanges(String(previewId)),
    ),
  );
  server.registerTool(
    "preview_proposal",
    {
      title: "Preview proposal",
      description:
        "Inspect an unexpired canonical preview as a proposal, including its render URL, author, operation hash, diff, warnings, and affected nodes without mutation.",
      inputSchema: { previewId: z.string().uuid() },
    },
    safe(async ({ previewId }) => client.previewProposal(String(previewId))),
  );
  server.registerTool(
    "commit_proposal",
    {
      title: "Commit proposal",
      description:
        "Commit the exact stored canonical preview through its existing revision and operation-hash checks. This is an explicit alias of canonical preview commit.",
      inputSchema: { previewId: z.string().uuid() },
    },
    safe(async ({ previewId }) => client.commitProposal(String(previewId))),
  );

  server.registerTool(
    "render_preview",
    {
      title: "Render canonical preview",
      description:
        "Render the committed frame with the shared pinned Pixi WebGL renderer and return PNG image content.",
      inputSchema: { projectId: z.string().uuid(), frameId: z.string().uuid() },
    },
    async ({ projectId, frameId }) => {
      try {
        const blob = await client.renderPreview(projectId, frameId);
        return {
          content: [
            {
              type: "image",
              data: Buffer.from(await blob.arrayBuffer()).toString("base64"),
              mimeType: "image/png",
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
  server.registerTool(
    "export_frame",
    {
      title: "Export frame",
      description:
        "Export committed canonical state as PNG, JPEG, or WebP with bounded scale and lossy quality controls.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        format: z.enum(["png", "jpeg", "webp"]).optional(),
        scale: z.number().min(0.25).max(4).optional(),
        quality: z.number().int().min(1).max(100).optional(),
        matteColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
      },
    },
    safe(async ({ projectId, frameId, format, scale, quality, matteColor }) =>
      client.exportFrame(String(projectId), String(frameId), {
        format,
        scale,
        quality,
        matteColor,
      }),
    ),
  );
  server.registerTool(
    "export_project",
    {
      title: "Export project frames",
      description:
        "Export one or more committed frames with shared PNG, JPEG, or WebP settings after validating the full batch.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameIds: z.array(z.string().uuid()).min(1).max(100),
        format: z.enum(["png", "jpeg", "webp"]).optional(),
        scale: z.number().min(0.25).max(4).optional(),
        quality: z.number().int().min(1).max(100).optional(),
        matteColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
      },
    },
    safe(async ({ projectId, frameIds, format, scale, quality, matteColor }) =>
      client.exportProject(String(projectId), frameIds.map(String), {
        format,
        scale,
        quality,
        matteColor,
      }),
    ),
  );
  server.registerTool(
    "list_project_templates",
    {
      title: "List project templates",
      description:
        "Inspect canonical reusable project templates, source node IDs, and semantic slots.",
      inputSchema: { projectId: z.string().uuid() },
    },
    safe(async ({ projectId }) =>
      client.listProjectTemplates(String(projectId)),
    ),
  );
  const designBriefInput = DesignBriefInputSchema;
  server.registerTool(
    "list_design_briefs",
    {
      title: "List design briefs",
      description:
        "Inspect canonical project design briefs, requirements, constraints, and export intent.",
      inputSchema: { projectId: z.string().uuid() },
    },
    safe(async ({ projectId }) => client.listDesignBriefs(String(projectId))),
  );
  server.registerTool(
    "create_design_brief",
    {
      title: "Create design brief",
      description:
        "Preview or commit a bounded non-executable DesignBrief as canonical project state.",
      inputSchema: {
        projectId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
        ...designBriefInput.shape,
      },
    },
    safe(async ({ projectId, baseRevision, mode, actorId, ...input }) => {
      const brief = createDesignBrief({
        ...(input as z.infer<typeof designBriefInput>),
        id: randomUUID(),
        now: new Date().toISOString(),
      });
      const transaction = await client.setDesignBrief({
        projectId: String(projectId),
        brief,
        baseRevision: Number(baseRevision),
        mode: mode === "commit" ? "commit" : "preview",
        actor: { source: "mcp", id: String(actorId ?? "design-brief-agent") },
      });
      return { brief, transaction };
    }),
  );
  server.registerTool(
    "remove_design_brief",
    {
      title: "Remove design brief",
      description:
        "Preview or commit removal of a canonical project design brief with normal history rollback.",
      inputSchema: {
        projectId: z.string().uuid(),
        briefId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async ({ projectId, briefId, baseRevision, mode, actorId }) =>
      client.removeDesignBrief({
        projectId: String(projectId),
        briefId: String(briefId),
        baseRevision: Number(baseRevision),
        mode: mode === "commit" ? "commit" : "preview",
        actor: { source: "mcp", id: String(actorId ?? "design-brief-agent") },
      }),
    ),
  );
  const designPlanInput = DesignPlanInputSchema;
  server.registerTool(
    "list_design_plans",
    {
      title: "List design plans",
      description:
        "Inspect canonical non-executable DesignPlans, semantic roles, layout intent, protections, and approval state.",
      inputSchema: { projectId: z.string().uuid() },
    },
    safe(async ({ projectId }) => client.listDesignPlans(String(projectId))),
  );
  server.registerTool(
    "inspect_design_plan",
    {
      title: "Inspect design plan",
      description:
        "Inspect one exact canonical DesignPlan without mutating project or frame state.",
      inputSchema: {
        projectId: z.string().uuid(),
        planId: z.string().uuid(),
      },
    },
    safe(async ({ projectId, planId }) =>
      client.inspectDesignPlan(String(projectId), String(planId)),
    ),
  );
  server.registerTool(
    "inspect_design_roles",
    {
      title: "Inspect design roles",
      description:
        "Inspect semantic-role bindings, canonical node health, protection IDs, and required missing counts for one DesignPlan.",
      inputSchema: {
        projectId: z.string().uuid(),
        planId: z.string().uuid(),
      },
    },
    safe(async ({ projectId, planId }) =>
      client.inspectDesignRoles(String(projectId), String(planId)),
    ),
  );
  server.registerTool(
    "assign_semantic_role",
    {
      title: "Assign semantic role",
      description:
        "Preview or commit one existing DesignPlan role binding through the canonical project transaction pipeline. Null nodeId detaches the role and any approved plan returns to draft.",
      inputSchema: {
        projectId: z.string().uuid(),
        planId: z.string().uuid(),
        roleId: z.string().uuid(),
        nodeId: z.string().uuid().nullable(),
        copyItemId: z.string().uuid().nullable().optional(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        projectId,
        planId,
        roleId,
        nodeId,
        copyItemId,
        baseRevision,
        mode,
        actorId,
      }) =>
        client.assignSemanticRole({
          projectId: String(projectId),
          planId: String(planId),
          roleId: String(roleId),
          nodeId: nodeId ? String(nodeId) : null,
          ...(copyItemId !== undefined
            ? { copyItemId: copyItemId ? String(copyItemId) : null }
            : {}),
          baseRevision: Number(baseRevision),
          mode: mode === "commit" ? "commit" : "preview",
          actor: {
            source: "mcp",
            id: String(actorId ?? "semantic-role-agent"),
          },
        }),
    ),
  );
  server.registerTool(
    "create_design_plan",
    {
      title: "Create design plan",
      description:
        "Preview or commit a bounded non-executable DesignPlan as canonical project state. This does not mutate artwork.",
      inputSchema: {
        projectId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
        ...designPlanInput.shape,
      },
    },
    safe(async ({ projectId, baseRevision, mode, actorId, ...input }) => {
      const plan = createDesignPlan({
        ...(input as z.infer<typeof designPlanInput>),
        id: randomUUID(),
        now: new Date().toISOString(),
      });
      const transaction = await client.setDesignPlan({
        projectId: String(projectId),
        plan,
        baseRevision: Number(baseRevision),
        mode: mode === "commit" ? "commit" : "preview",
        actor: { source: "mcp", id: String(actorId ?? "design-plan-agent") },
      });
      return { plan, transaction };
    }),
  );
  server.registerTool(
    "remove_design_plan",
    {
      title: "Remove design plan",
      description:
        "Preview or commit removal of a canonical project DesignPlan with exact history rollback.",
      inputSchema: {
        projectId: z.string().uuid(),
        planId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async ({ projectId, planId, baseRevision, mode, actorId }) =>
      client.removeDesignPlan({
        projectId: String(projectId),
        planId: String(planId),
        baseRevision: Number(baseRevision),
        mode: mode === "commit" ? "commit" : "preview",
        actor: { source: "mcp", id: String(actorId ?? "design-plan-agent") },
      }),
    ),
  );
  server.registerTool(
    "preview_design_plan",
    {
      title: "Preview design plan",
      description:
        "Compile selected actionable DesignPlan intent into ordinary frame operations and a canonical preview. Never commits automatically.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        planId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        roleIds: z.array(z.string().uuid()).min(1).max(100).optional(),
        variantRuleId: z.string().uuid().optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        projectId,
        frameId,
        planId,
        baseRevision,
        roleIds,
        variantRuleId,
        actorId,
      }) =>
        client.previewDesignPlan({
          projectId: String(projectId),
          frameId: String(frameId),
          planId: String(planId),
          baseRevision: Number(baseRevision),
          actor: { source: "mcp", id: String(actorId ?? "design-plan-agent") },
          ...(roleIds ? { roleIds: roleIds.map(String) } : {}),
          ...(variantRuleId ? { variantRuleId: String(variantRuleId) } : {}),
        }),
    ),
  );
  server.registerTool(
    "apply_layout_system",
    {
      title: "Apply layout system",
      description:
        "Compile every explicit DesignPlan anchor plus its single global safe area into ordinary frame operations and a canonical preview. Never commits automatically.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        planId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async ({ projectId, frameId, planId, baseRevision, actorId }) =>
      client.applyLayoutSystem({
        projectId: String(projectId),
        frameId: String(frameId),
        planId: String(planId),
        baseRevision: Number(baseRevision),
        actor: { source: "mcp", id: String(actorId ?? "layout-agent") },
      }),
    ),
  );
  server.registerTool(
    "reflow_content",
    {
      title: "Reflow content",
      description:
        "Re-apply explicit anchors for selected DesignPlan roles after content changes. Returns ordinary frame operations in a canonical preview and never changes the canvas safe area.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        planId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        roleIds: z
          .array(z.string().uuid())
          .min(1)
          .max(100)
          .refine((values) => new Set(values).size === values.length, {
            message: "Reflow role IDs must be unique.",
          }),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({ projectId, frameId, planId, baseRevision, roleIds, actorId }) =>
        client.reflowContent({
          projectId: String(projectId),
          frameId: String(frameId),
          planId: String(planId),
          baseRevision: Number(baseRevision),
          roleIds: roleIds.map(String),
          actor: { source: "mcp", id: String(actorId ?? "reflow-agent") },
        }),
    ),
  );
  server.registerTool(
    "create_design_variants",
    {
      title: "Create design variant",
      description:
        "Compile one exact saved DesignPlan variant rule into an ordinary canonical preview. Same-format hide/reflow/stretch-resize behaviors only; format changes return a warning and no partial preview. Never commits automatically.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        planId: z.string().uuid(),
        variantRuleId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        projectId,
        frameId,
        planId,
        variantRuleId,
        baseRevision,
        actorId,
      }) =>
        client.createDesignVariant({
          projectId: String(projectId),
          frameId: String(frameId),
          planId: String(planId),
          variantRuleId: String(variantRuleId),
          baseRevision: Number(baseRevision),
          actor: { source: "mcp", id: String(actorId ?? "variant-agent") },
        }),
    ),
  );
  server.registerTool(
    "bind_brand_tokens",
    {
      title: "Bind Brand tokens",
      description:
        "Compile only exact palette and typography bindings already declared by a DesignPlan against the project's exact pinned Brand Kit into an ordinary canonical preview. Never accepts token or value overrides and never commits automatically.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        planId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        roleIds: z.array(z.string().uuid()).min(1).max(100).optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({ projectId, frameId, planId, baseRevision, roleIds, actorId }) =>
        client.bindBrandTokens({
          projectId: String(projectId),
          frameId: String(frameId),
          planId: String(planId),
          baseRevision: Number(baseRevision),
          ...(roleIds ? { roleIds: roleIds.map(String) } : {}),
          actor: {
            source: "mcp",
            id: String(actorId ?? "brand-binding-agent"),
          },
        }),
    ),
  );
  server.registerTool(
    "replace_role_asset",
    {
      title: "Replace role asset",
      description:
        "Compile the exact asset assignment already declared for one DesignPlan role into ordinary asset/crop operations and a canonical preview. Never accepts undeclared replacement intent or commits automatically.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        planId: z.string().uuid(),
        roleId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({ projectId, frameId, planId, roleId, baseRevision, actorId }) =>
        client.replaceRoleAsset({
          projectId: String(projectId),
          frameId: String(frameId),
          planId: String(planId),
          roleId: String(roleId),
          baseRevision: Number(baseRevision),
          actor: { source: "mcp", id: String(actorId ?? "role-asset-agent") },
        }),
    ),
  );
  server.registerTool(
    "apply_project_template",
    {
      title: "Apply project template",
      description:
        "Compile a canonical project template into ordinary stable-ID frame nodes with semantic slot metadata. Preview is the default.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        templateId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        parentId: z.union([z.literal("root"), z.string().uuid()]).optional(),
        index: z.number().int().nonnegative().optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        projectId,
        frameId,
        templateId,
        baseRevision,
        mode,
        parentId,
        index,
        actorId,
      }) => {
        const templates = await client.listProjectTemplates(String(projectId));
        const template = templates.find(
          (candidate) => candidate.id === String(templateId),
        );
        if (!template)
          throw new Error(`Project template ${templateId} was not found.`);
        const idMap = Object.fromEntries(
          templateSourceNodeIds(template).map((id) => [id, randomUUID()]),
        );
        return client.applyProjectTemplate({
          projectId: String(projectId),
          frameId: String(frameId),
          templateId: String(templateId),
          baseRevision: Number(baseRevision),
          mode: mode === "commit" ? "commit" : "preview",
          actor: { source: "mcp", id: String(actorId ?? "template-agent") },
          instanceId: randomUUID(),
          groupId: randomUUID(),
          idMap,
          parentId: parentId ? String(parentId) : "root",
          ...(index === undefined ? {} : { index: Number(index) }),
        });
      },
    ),
  );
  server.registerTool(
    "detach_project_template",
    {
      title: "Detach project template instance",
      description:
        "Remove template and semantic-slot metadata through normal frame operations while preserving every visible node and value.",
      inputSchema: {
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        instanceId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        projectId,
        frameId,
        instanceId,
        baseRevision,
        mode,
        actorId,
      }) => {
        const frame = await client.getFrame(String(projectId), String(frameId));
        return client.transact({
          schemaVersion: 1,
          mode: mode === "commit" ? "commit" : "preview",
          scope: {
            kind: "frame",
            projectId: String(projectId),
            frameId: String(frameId),
          },
          baseRevision: Number(baseRevision),
          actor: { source: "mcp", id: String(actorId ?? "template-agent") },
          operations: detachTemplateInstanceOperations(
            frame,
            String(instanceId),
          ),
        });
      },
    ),
  );

  const importLocal = async (
    kind: "asset" | "font",
    projectId: string,
    sourcePath: string,
    baseRevision: number,
    licenseNotes?: string,
  ) => {
    const resolved = await realpath(sourcePath);
    await access(resolved, constants.R_OK);
    const info = await stat(resolved);
    if (!info.isFile())
      throw new Error("Import source must be a readable ordinary file.");
    const form = new FormData();
    form.set(
      "file",
      new Blob([await readFile(resolved)]),
      path.basename(resolved),
    );
    form.set("baseRevision", String(baseRevision));
    if (licenseNotes) form.set("licenseNotes", licenseNotes);
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/${kind === "asset" ? "assets" : "fonts"}/import`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${descriptor.capabilityToken}`,
          "x-design-runtime-id": descriptor.runtimeId,
          "x-design-workspace-id": descriptor.workspaceId,
        },
        body: form,
      },
    );
    const body = await response.json();
    if (!response.ok) {
      const apiError = body as {
        error?: {
          code?: string;
          message?: string;
          requestId?: string;
          details?: Record<string, unknown>;
        };
      };
      throw new DesignRuntimeApiError({
        code: (apiError.error?.code ?? "INVALID_OPERATION") as never,
        message: apiError.error?.message ?? response.statusText,
        status: response.status,
        ...(apiError.error?.requestId
          ? { requestId: apiError.error.requestId }
          : {}),
        ...(apiError.error?.details ? { details: apiError.error.details } : {}),
      });
    }
    return body;
  };
  server.registerTool(
    "import_asset",
    {
      title: "Import local asset",
      description:
        "Validate and copy a local PNG, JPEG, WebP, or SVG into a project. The source path is used only as input and is never persisted.",
      inputSchema: {
        projectId: z.string().uuid(),
        sourcePath: z.string().min(1),
        baseRevision: z.number().int().min(0),
      },
    },
    safe(async ({ projectId, sourcePath, baseRevision }) =>
      importLocal(
        "asset",
        String(projectId),
        String(sourcePath),
        Number(baseRevision),
      ),
    ),
  );
  server.registerTool(
    "import_font",
    {
      title: "Import local font",
      description:
        "Validate and copy a local WOFF2, WOFF, TTF, or OTF into a project. The source path is never persisted.",
      inputSchema: {
        projectId: z.string().uuid(),
        sourcePath: z.string().min(1),
        baseRevision: z.number().int().min(0),
        licenseNotes: z.string().optional(),
      },
    },
    safe(async ({ projectId, sourcePath, baseRevision, licenseNotes }) =>
      importLocal(
        "font",
        String(projectId),
        String(sourcePath),
        Number(baseRevision),
        licenseNotes ? String(licenseNotes) : undefined,
      ),
    ),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
};

const invokedDirectly =
  process.argv[1] &&
  realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly)
  runMcp().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
