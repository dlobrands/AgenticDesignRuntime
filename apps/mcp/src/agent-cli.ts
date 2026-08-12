#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  DesignRuntimeApiError,
  type DesignRuntimeClient,
} from "@tva-agentic-design/client";
import {
  DesignBriefInputSchema,
  DesignPlanInputSchema,
  FrameOperationSchema,
  ProjectOperationSchema,
  WorkspaceOperationSchema,
  createDesignBrief,
  createDesignPlan,
  detachTemplateInstanceOperations,
  findNode,
  searchNodes,
  templateSourceNodeIds,
} from "@tva-agentic-design/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import {
  AGENT_PLUGIN_VERSION,
  clientForWorkspace,
  ensureDesignWorkspace,
  listActiveWorkspaces,
  runRuntimeLifecycle,
  runRuntimeUpdate,
  runtimePrerequisites,
} from "./agent-runtime.js";

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

const workspaceSchema = { workspacePath: z.string().min(1) };
const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

const pluginRootFromArguments = (arguments_: string[]): string => {
  const index = arguments_.indexOf("--plugin-root");
  return path.resolve(
    index >= 0 && arguments_[index + 1]
      ? arguments_[index + 1]!
      : (process.env.ADR_PLUGIN_ROOT ?? process.cwd()),
  );
};

const withClient = async <T>(
  workspacePath: unknown,
  callback: (client: DesignRuntimeClient) => Promise<T>,
): Promise<T> => {
  const { client } = await clientForWorkspace(String(workspacePath));
  return callback(client);
};

export const runAgentMcp = async (
  arguments_ = process.argv.slice(2),
): Promise<void> => {
  if (arguments_.includes("--version")) {
    process.stdout.write(`${AGENT_PLUGIN_VERSION}\n`);
    return;
  }
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    process.stdout.write("Usage: agentic-design-mcp [--plugin-root <path>]\n");
    return;
  }
  const pluginRoot = pluginRootFromArguments(arguments_);
  const server = new McpServer({
    name: "agentic-design-runtime",
    version: AGENT_PLUGIN_VERSION,
  });

  server.registerTool(
    "runtime_prerequisites",
    {
      title: "Inspect agent runtime prerequisites",
      description:
        "Inspect the exact bundled runtime, compatibility versions, installation state, and renderer dependency policy without changing the system.",
    },
    safe(async () => runtimePrerequisites(pluginRoot)),
  );
  for (const action of ["check", "fetch", "apply", "rollback"] as const) {
    server.registerTool(
      `update_${action}`,
      {
        title: `ADR update ${action}`,
        description:
          action === "check"
            ? "Read the signed official update manifest without changing local state."
            : action === "fetch"
              ? "Download and verify an official runtime update into inactive staging without activating it."
              : action === "apply"
                ? "Explicitly activate the verified staged runtime only while ADR is stopped; requires a new task or connector restart afterward."
                : "Explicitly restore the retained last-known-good runtime while ADR is stopped.",
      },
      safe(async () => runRuntimeUpdate(action)),
    );
  }
  server.registerTool(
    "ensure_design_workspace",
    {
      title: "Install, start, or reconnect a design workspace",
      description:
        "Install the plugin-pinned runtime when needed, ensure one project-local design workspace, install pinned Chromium, and start or reuse its loopback runtime.",
      inputSchema: {
        clientRoot: z.string().min(1),
        workspaceDirectory: z.string().min(1).default("design-runtime"),
        openStudio: z.boolean().default(false),
        installBrowser: z.boolean().default(true),
      },
    },
    safe(
      async ({ clientRoot, workspaceDirectory, openStudio, installBrowser }) =>
        ensureDesignWorkspace({
          pluginRoot,
          clientRoot: String(clientRoot),
          workspaceDirectory: String(workspaceDirectory),
          openStudio: Boolean(openStudio),
          installBrowser: Boolean(installBrowser),
        }),
    ),
  );
  server.registerTool(
    "list_active_workspaces",
    {
      title: "List active design workspaces",
      description:
        "List active owner-only runtime descriptors without exposing capability tokens.",
    },
    safe(async () => ({ workspaces: await listActiveWorkspaces() })),
  );
  server.registerTool(
    "runtime_status",
    {
      title: "Runtime status",
      description:
        "Inspect one explicit workspace runtime, compatibility, versions, and render capabilities.",
      inputSchema: workspaceSchema,
    },
    safe(async ({ workspacePath }) =>
      runRuntimeLifecycle(String(workspacePath), "status"),
    ),
  );
  server.registerTool(
    "open_studio",
    {
      title: "Open authenticated Studio",
      description:
        "Securely open or focus Studio through a one-time browser bootstrap without exposing the nonce or capability token.",
      inputSchema: workspaceSchema,
    },
    safe(async ({ workspacePath }) =>
      runRuntimeLifecycle(String(workspacePath), "studio"),
    ),
  );
  server.registerTool(
    "stop_runtime",
    {
      title: "Stop design runtime",
      description:
        "Gracefully stop the runtime after final approval or export and remove its descriptor and workspace lock.",
      inputSchema: workspaceSchema,
    },
    safe(async ({ workspacePath }) =>
      runRuntimeLifecycle(String(workspacePath), "stop"),
    ),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List all editable projects in one explicit workspace.",
      inputSchema: workspaceSchema,
    },
    safe(async ({ workspacePath }) =>
      withClient(workspacePath, async (client) => ({
        projects: await client.listProjects(),
      })),
    ),
  );
  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description: "Inspect one project manifest and project revision.",
      inputSchema: { ...workspaceSchema, projectId: z.string().uuid() },
    },
    safe(async ({ workspacePath, projectId }) =>
      withClient(workspacePath, (client) =>
        client.getProject(String(projectId)),
      ),
    ),
  );
  server.registerTool(
    "list_frames",
    {
      title: "List frames",
      description: "List canonical frames and revisions in a project.",
      inputSchema: { ...workspaceSchema, projectId: z.string().uuid() },
    },
    safe(async ({ workspacePath, projectId }) =>
      withClient(workspacePath, async (client) => ({
        frames: await client.listFrames(String(projectId)),
      })),
    ),
  );
  server.registerTool(
    "get_frame",
    {
      title: "Get frame",
      description: "Inspect the complete canonical layered frame scene.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
      },
    },
    safe(async ({ workspacePath, projectId, frameId }) =>
      withClient(workspacePath, (client) =>
        client.getFrame(String(projectId), String(frameId)),
      ),
    ),
  );
  server.registerTool(
    "get_node",
    {
      title: "Get node",
      description: "Inspect one stable-ID scene node.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        nodeId: z.string().uuid(),
      },
    },
    safe(async ({ workspacePath, projectId, frameId, nodeId }) =>
      withClient(workspacePath, async (client) => {
        const frame = await client.getFrame(String(projectId), String(frameId));
        const node = findNode(frame, String(nodeId));
        if (!node) throw new Error(`NODE_NOT_FOUND: ${String(nodeId)}`);
        return node;
      }),
    ),
  );
  server.registerTool(
    "search_nodes",
    {
      title: "Search nodes",
      description:
        "Search a frame by layer name, type, visibility, or lock state before editing.",
      inputSchema: {
        ...workspaceSchema,
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
    safe(
      async ({
        workspacePath,
        projectId,
        frameId,
        text,
        types,
        visible,
        locked,
      }) =>
        withClient(workspacePath, async (client) => {
          const frame = await client.getFrame(
            String(projectId),
            String(frameId),
          );
          return {
            nodes: searchNodes(frame, {
              ...(text ? { text: String(text) } : {}),
              ...(types ? { types: types as never } : {}),
              ...(visible !== undefined ? { visible: Boolean(visible) } : {}),
              ...(locked !== undefined ? { locked: Boolean(locked) } : {}),
            }),
          };
        }),
    ),
  );
  server.registerTool(
    "list_assets",
    {
      title: "List assets",
      description: "Inspect registered raster and SVG assets.",
      inputSchema: { ...workspaceSchema, projectId: z.string().uuid() },
    },
    safe(async ({ workspacePath, projectId }) =>
      withClient(workspacePath, (client) =>
        client.getAssets(String(projectId)),
      ),
    ),
  );
  server.registerTool(
    "list_fonts",
    {
      title: "List fonts",
      description: "Inspect project fonts, hashes, weights, and license notes.",
      inputSchema: { ...workspaceSchema, projectId: z.string().uuid() },
    },
    safe(async ({ workspacePath, projectId }) =>
      withClient(workspacePath, (client) => client.getFonts(String(projectId))),
    ),
  );
  server.registerTool(
    "get_history",
    {
      title: "Get frame history",
      description: "Inspect append-only frame revisions and semantic hashes.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
      },
    },
    safe(async ({ workspacePath, projectId, frameId }) =>
      withClient(workspacePath, async (client) => ({
        history: await client.getHistory(String(projectId), String(frameId)),
      })),
    ),
  );
  server.registerTool(
    "get_revision",
    {
      title: "Reconstruct revision",
      description: "Reconstruct a hash-verified historical frame revision.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        revision: z.number().int().min(0),
      },
    },
    safe(async ({ workspacePath, projectId, frameId, revision }) =>
      withClient(workspacePath, (client) =>
        client.getRevision(
          String(projectId),
          String(frameId),
          Number(revision),
        ),
      ),
    ),
  );
  server.registerTool(
    "compare_revisions",
    {
      title: "Compare revisions",
      description: "Return a structured semantic revision diff.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        left: z.number().int().min(0),
        right: z.number().int().min(0),
      },
    },
    safe(async ({ workspacePath, projectId, frameId, left, right }) =>
      withClient(workspacePath, (client) =>
        client.compareRevisions(
          String(projectId),
          String(frameId),
          Number(left),
          Number(right),
        ),
      ),
    ),
  );
  server.registerTool(
    "validate_frame",
    {
      title: "Validate frame",
      description:
        "Run schema, dependency, capability, and quality validation.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
      },
    },
    safe(async ({ workspacePath, projectId, frameId }) =>
      withClient(workspacePath, (client) =>
        client.validateFrame(String(projectId), String(frameId)),
      ),
    ),
  );
  server.registerTool(
    "audit_visual_quality",
    {
      title: "Audit visual quality",
      description:
        "Run read-only deterministic visual QA. Findings are objective checks; heuristic and model-judged categories remain explicitly unevaluated.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        planId: z.string().uuid().optional(),
      },
    },
    safe(async ({ workspacePath, projectId, frameId, planId }) =>
      withClient(workspacePath, (client) =>
        client.auditVisualQuality(
          String(projectId),
          String(frameId),
          planId ? String(planId) : undefined,
        ),
      ),
    ),
  );
  server.registerTool(
    "audit_brand_system",
    {
      title: "Audit Brand system",
      description:
        "Return deterministic exact-pin Brand integrity, organization, and unbound-token findings without mutation.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
      },
    },
    safe(async ({ workspacePath, projectId }) =>
      withClient(workspacePath, (client) =>
        client.auditBrand(String(projectId)),
      ),
    ),
  );
  server.registerTool(
    "migrate_brand_kit_revision",
    {
      title: "Migrate Brand Kit revision",
      description:
        "Preview or commit one explicit atomic exact-revision Brand migration; latest is never selected implicitly.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        kitId: z.string().uuid(),
        revision: z.number().int().positive(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]),
      },
    },
    safe(
      async ({
        workspacePath,
        projectId,
        kitId,
        revision,
        baseRevision,
        mode,
      }) =>
        withClient(workspacePath, (client) =>
          client.migrateBrandKit({
            projectId: String(projectId),
            kitId: String(kitId),
            revision: Number(revision),
            baseRevision: Number(baseRevision),
            mode: mode as "preview" | "commit",
            actor: { source: "mcp", id: "brand-migration" },
          }),
        ),
    ),
  );
  server.registerTool(
    "rollback_brand_kit_migration",
    {
      title: "Rollback Brand Kit migration",
      description:
        "Preview or commit the exact inverse of the immediately preceding Brand migration.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]),
      },
    },
    safe(async ({ workspacePath, projectId, baseRevision, mode }) =>
      withClient(workspacePath, (client) =>
        client.rollbackBrandMigration({
          projectId: String(projectId),
          baseRevision: Number(baseRevision),
          mode: mode as "preview" | "commit",
          actor: { source: "mcp", id: "brand-migration" },
        }),
      ),
    ),
  );

  const actorId = z.string().min(1).max(128).default("agent");
  const batchSchema = z.discriminatedUnion("scope", [
    z
      .object({
        ...workspaceSchema,
        scope: z.literal("workspace"),
        baseRevision: z.null(),
        operations: z.array(WorkspaceOperationSchema).length(1),
        actorId,
      })
      .strict(),
    z
      .object({
        ...workspaceSchema,
        scope: z.literal("project"),
        projectId: z.string().uuid(),
        baseRevision: z.number().int().min(0),
        operations: z.array(ProjectOperationSchema).min(1),
        actorId,
      })
      .strict(),
    z
      .object({
        ...workspaceSchema,
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
    return withClient(input.workspacePath, (client) => {
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
    });
  };
  server.registerTool(
    "preview_batch",
    {
      title: "Preview atomic batch",
      description:
        "Simulate one typed, single-scope batch and return its diff, warnings, operation hash, and affected nodes without mutation.",
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
      inputSchema: {
        ...workspaceSchema,
        previewId: z.string().uuid(),
      },
    },
    safe(async ({ workspacePath, previewId }) =>
      withClient(workspacePath, (client) =>
        client.commitPreview(String(previewId)),
      ),
    ),
  );
  server.registerTool(
    "bind_live_palette_token",
    {
      title: "Bind live palette token",
      description:
        "Preview or commit one selected node property as a live binding to a palette token in the project's exact immutable Brand Kit pin. Direct later edits detach only that property binding.",
      inputSchema: {
        ...workspaceSchema,
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
        workspacePath,
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
        withClient(workspacePath, (client) =>
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
    ),
  );
  server.registerTool(
    "unbind_live_palette_token",
    {
      title: "Detach live palette token",
      description:
        "Preview or commit detaching one live palette binding while preserving the property's current materialized appearance.",
      inputSchema: {
        ...workspaceSchema,
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
        workspacePath,
        projectId,
        frameId,
        baseRevision,
        mode,
        nodeId,
        property,
        actorId,
      }) =>
        withClient(workspacePath, (client) =>
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
    ),
  );
  server.registerTool(
    "bind_live_typography_role",
    {
      title: "Bind live typography role",
      description:
        "Preview or commit one text layer as a live binding to a type role in the project's exact immutable Brand Kit pin and font resource map. Direct paragraph typography edits detach the role binding.",
      inputSchema: {
        ...workspaceSchema,
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
        workspacePath,
        projectId,
        frameId,
        baseRevision,
        mode,
        bindingId,
        nodeId,
        roleKey,
        actorId,
      }) =>
        withClient(workspacePath, (client) =>
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
    ),
  );
  server.registerTool(
    "unbind_live_typography_role",
    {
      title: "Detach live typography role",
      description:
        "Preview or commit detaching one live typography-role binding while preserving the text layer's current materialized appearance.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        nodeId: z.string().uuid(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        workspacePath,
        projectId,
        frameId,
        baseRevision,
        mode,
        nodeId,
        actorId,
      }) =>
        withClient(workspacePath, (client) =>
          client.unbindTypographyRole({
            projectId: String(projectId),
            frameId: String(frameId),
            baseRevision: Number(baseRevision),
            mode: mode === "commit" ? "commit" : "preview",
            actor: { source: "mcp", id: String(actorId ?? "live-brand") },
            nodeId: String(nodeId),
          }),
        ),
    ),
  );
  server.registerTool(
    "bind_live_effect_style",
    {
      title: "Bind live effect style",
      description:
        "Preview or commit one node's ordered non-destructive effects as a live binding to an effect style in the project's exact immutable Brand Kit pin.",
      inputSchema: {
        ...workspaceSchema,
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
      withClient(input.workspacePath, (client) =>
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
    ),
  );
  server.registerTool(
    "unbind_live_effect_style",
    {
      title: "Detach live effect style",
      description:
        "Preview or commit detaching one live effect-style binding while preserving the node's current materialized effects.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        nodeId: z.string().uuid(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async (input) =>
      withClient(input.workspacePath, (client) =>
        client.unbindEffectStyle({
          projectId: String(input.projectId),
          frameId: String(input.frameId),
          baseRevision: Number(input.baseRevision),
          mode: input.mode === "commit" ? "commit" : "preview",
          actor: { source: "mcp", id: String(input.actorId ?? "live-brand") },
          nodeId: String(input.nodeId),
        }),
      ),
    ),
  );
  server.registerTool(
    "bind_live_radius_token",
    {
      title: "Bind live radius token",
      description:
        "Preview or commit one rectangle's four corner radii as a live exact-pin Brand token binding.",
      inputSchema: {
        ...workspaceSchema,
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
      withClient(input.workspacePath, (client) =>
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
    ),
  );
  server.registerTool(
    "unbind_live_radius_token",
    {
      title: "Detach live radius token",
      description:
        "Preview or commit appearance-preserving detach of one live radius binding.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        nodeId: z.string().uuid(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async (input) =>
      withClient(input.workspacePath, (client) =>
        client.unbindRadiusToken({
          projectId: String(input.projectId),
          frameId: String(input.frameId),
          baseRevision: Number(input.baseRevision),
          mode: input.mode === "commit" ? "commit" : "preview",
          actor: { source: "mcp", id: String(input.actorId ?? "live-brand") },
          nodeId: String(input.nodeId),
        }),
      ),
    ),
  );
  server.registerTool(
    "bind_live_spacing_token",
    {
      title: "Bind live spacing token",
      description:
        "Preview or commit the canvas safe area as one uniform live exact-pin Brand spacing token.",
      inputSchema: {
        ...workspaceSchema,
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
      withClient(input.workspacePath, (client) =>
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
    ),
  );
  server.registerTool(
    "unbind_live_spacing_token",
    {
      title: "Detach live spacing token",
      description:
        "Preview or commit appearance-preserving detach of the canvas safe-area spacing binding.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(async (input) =>
      withClient(input.workspacePath, (client) =>
        client.unbindSpacingToken({
          projectId: String(input.projectId),
          frameId: String(input.frameId),
          baseRevision: Number(input.baseRevision),
          mode: input.mode === "commit" ? "commit" : "preview",
          actor: { source: "mcp", id: String(input.actorId ?? "live-brand") },
        }),
      ),
    ),
  );
  server.registerTool(
    "apply_live_variable_mode",
    {
      title: "Apply live variable mode",
      description:
        "Preview or commit one exact pinned Brand palette mode across compatible frame bindings; null restores base palette values.",
      inputSchema: {
        ...workspaceSchema,
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
      withClient(input.workspacePath, (client) =>
        client.applyVariableMode({
          projectId: String(input.projectId),
          frameId: String(input.frameId),
          baseRevision: Number(input.baseRevision),
          mode: input.mode === "commit" ? "commit" : "preview",
          actor: { source: "mcp", id: String(input.actorId ?? "live-brand") },
          modeKey: input.modeKey === null ? null : String(input.modeKey),
        }),
      ),
    ),
  );
  server.registerTool(
    "explain_proposed_changes",
    {
      title: "Explain proposed changes",
      description:
        "Explain the exact operations and structured diff stored by an unexpired canonical preview. The proposal ID is the preview ID; no duplicate mutation state is created.",
      inputSchema: {
        ...workspaceSchema,
        previewId: z.string().uuid(),
      },
    },
    safe(async ({ workspacePath, previewId }) =>
      withClient(workspacePath, (client) =>
        client.explainProposedChanges(String(previewId)),
      ),
    ),
  );
  server.registerTool(
    "preview_proposal",
    {
      title: "Preview proposal",
      description:
        "Inspect an unexpired canonical preview as a proposal, including its render URL, author, operation hash, diff, warnings, and affected nodes without mutation.",
      inputSchema: {
        ...workspaceSchema,
        previewId: z.string().uuid(),
      },
    },
    safe(async ({ workspacePath, previewId }) =>
      withClient(workspacePath, (client) =>
        client.previewProposal(String(previewId)),
      ),
    ),
  );
  server.registerTool(
    "commit_proposal",
    {
      title: "Commit proposal",
      description:
        "Commit the exact stored canonical preview through its existing revision and operation-hash checks. This is an explicit alias of canonical preview commit.",
      inputSchema: {
        ...workspaceSchema,
        previewId: z.string().uuid(),
      },
    },
    safe(async ({ workspacePath, previewId }) =>
      withClient(workspacePath, (client) =>
        client.commitProposal(String(previewId)),
      ),
    ),
  );
  server.registerTool(
    "render_preview",
    {
      title: "Render canonical preview",
      description:
        "Render committed canonical state and return PNG image content directly to the conversation.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
      },
    },
    async ({ workspacePath, projectId, frameId }) => {
      try {
        const blob = await withClient(workspacePath, (client) =>
          client.renderPreview(String(projectId), String(frameId)),
        );
        return {
          content: [
            {
              type: "image" as const,
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
        "Export committed canonical state as PNG, JPEG, or WebP with bounded scale and lossy quality controls. Alpha is retained only for transparent PNG/WebP canvases.",
      inputSchema: {
        ...workspaceSchema,
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
    safe(
      async ({
        workspacePath,
        projectId,
        frameId,
        format,
        scale,
        quality,
        matteColor,
      }) =>
        withClient(workspacePath, (client) =>
          client.exportFrame(String(projectId), String(frameId), {
            format,
            scale,
            quality,
            matteColor,
          }),
        ),
    ),
  );
  server.registerTool(
    "export_project",
    {
      title: "Export project frames",
      description:
        "Export one or more committed frames with shared PNG, JPEG, or WebP settings. Every frame is validated before rendering begins.",
      inputSchema: {
        ...workspaceSchema,
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
    safe(
      async ({
        workspacePath,
        projectId,
        frameIds,
        format,
        scale,
        quality,
        matteColor,
      }) =>
        withClient(workspacePath, (client) =>
          client.exportProject(String(projectId), frameIds.map(String), {
            format,
            scale,
            quality,
            matteColor,
          }),
        ),
    ),
  );
  server.registerTool(
    "list_project_templates",
    {
      title: "List project templates",
      description:
        "Inspect canonical reusable project templates, source node IDs, and semantic slots.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
      },
    },
    safe(async ({ workspacePath, projectId }) =>
      withClient(workspacePath, (client) =>
        client.listProjectTemplates(String(projectId)),
      ),
    ),
  );
  const designBriefInput = DesignBriefInputSchema;
  server.registerTool(
    "list_design_briefs",
    {
      title: "List design briefs",
      description:
        "Inspect canonical project design briefs, requirements, constraints, and export intent.",
      inputSchema: { ...workspaceSchema, projectId: z.string().uuid() },
    },
    safe(async ({ workspacePath, projectId }) =>
      withClient(workspacePath, (client) =>
        client.listDesignBriefs(String(projectId)),
      ),
    ),
  );
  server.registerTool(
    "create_design_brief",
    {
      title: "Create design brief",
      description:
        "Preview or commit a bounded non-executable DesignBrief as canonical project state.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
        ...designBriefInput.shape,
      },
    },
    safe(
      async ({
        workspacePath,
        projectId,
        baseRevision,
        mode,
        actorId,
        ...input
      }) =>
        withClient(workspacePath, async (client) => {
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
            actor: {
              source: "mcp",
              id: String(actorId ?? "design-brief-agent"),
            },
          });
          return { brief, transaction };
        }),
    ),
  );
  server.registerTool(
    "remove_design_brief",
    {
      title: "Remove design brief",
      description:
        "Preview or commit removal of a canonical project design brief with normal history rollback.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        briefId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        workspacePath,
        projectId,
        briefId,
        baseRevision,
        mode,
        actorId,
      }) =>
        withClient(workspacePath, (client) =>
          client.removeDesignBrief({
            projectId: String(projectId),
            briefId: String(briefId),
            baseRevision: Number(baseRevision),
            mode: mode === "commit" ? "commit" : "preview",
            actor: {
              source: "mcp",
              id: String(actorId ?? "design-brief-agent"),
            },
          }),
        ),
    ),
  );
  const designPlanInput = DesignPlanInputSchema;
  server.registerTool(
    "list_design_plans",
    {
      title: "List design plans",
      description:
        "Inspect canonical non-executable DesignPlans, semantic roles, layout intent, protections, and approval state.",
      inputSchema: { ...workspaceSchema, projectId: z.string().uuid() },
    },
    safe(async ({ workspacePath, projectId }) =>
      withClient(workspacePath, (client) =>
        client.listDesignPlans(String(projectId)),
      ),
    ),
  );
  server.registerTool(
    "inspect_design_plan",
    {
      title: "Inspect design plan",
      description:
        "Inspect one exact canonical DesignPlan without mutating project or frame state.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        planId: z.string().uuid(),
      },
    },
    safe(async ({ workspacePath, projectId, planId }) =>
      withClient(workspacePath, (client) =>
        client.inspectDesignPlan(String(projectId), String(planId)),
      ),
    ),
  );
  server.registerTool(
    "inspect_design_roles",
    {
      title: "Inspect design roles",
      description:
        "Inspect semantic-role bindings, canonical node health, protection IDs, and required missing counts for one DesignPlan.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        planId: z.string().uuid(),
      },
    },
    safe(async ({ workspacePath, projectId, planId }) =>
      withClient(workspacePath, (client) =>
        client.inspectDesignRoles(String(projectId), String(planId)),
      ),
    ),
  );
  server.registerTool(
    "assign_semantic_role",
    {
      title: "Assign semantic role",
      description:
        "Preview or commit one existing DesignPlan role binding through the canonical project transaction pipeline. Null nodeId detaches the role and any approved plan returns to draft.",
      inputSchema: {
        ...workspaceSchema,
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
        workspacePath,
        projectId,
        planId,
        roleId,
        nodeId,
        copyItemId,
        baseRevision,
        mode,
        actorId,
      }) =>
        withClient(workspacePath, (client) =>
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
    ),
  );
  server.registerTool(
    "create_design_plan",
    {
      title: "Create design plan",
      description:
        "Preview or commit a bounded non-executable DesignPlan as canonical project state. This does not mutate artwork.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
        ...designPlanInput.shape,
      },
    },
    safe(
      async ({
        workspacePath,
        projectId,
        baseRevision,
        mode,
        actorId,
        ...input
      }) =>
        withClient(workspacePath, async (client) => {
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
            actor: {
              source: "mcp",
              id: String(actorId ?? "design-plan-agent"),
            },
          });
          return { plan, transaction };
        }),
    ),
  );
  server.registerTool(
    "remove_design_plan",
    {
      title: "Remove design plan",
      description:
        "Preview or commit removal of a canonical project DesignPlan with exact history rollback.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        planId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        mode: z.enum(["preview", "commit"]).optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        workspacePath,
        projectId,
        planId,
        baseRevision,
        mode,
        actorId,
      }) =>
        withClient(workspacePath, (client) =>
          client.removeDesignPlan({
            projectId: String(projectId),
            planId: String(planId),
            baseRevision: Number(baseRevision),
            mode: mode === "commit" ? "commit" : "preview",
            actor: {
              source: "mcp",
              id: String(actorId ?? "design-plan-agent"),
            },
          }),
        ),
    ),
  );
  server.registerTool(
    "preview_design_plan",
    {
      title: "Preview design plan",
      description:
        "Compile selected actionable DesignPlan intent into ordinary frame operations and a canonical preview. Never commits automatically.",
      inputSchema: {
        ...workspaceSchema,
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
        workspacePath,
        projectId,
        frameId,
        planId,
        baseRevision,
        roleIds,
        variantRuleId,
        actorId,
      }) =>
        withClient(workspacePath, (client) =>
          client.previewDesignPlan({
            projectId: String(projectId),
            frameId: String(frameId),
            planId: String(planId),
            baseRevision: Number(baseRevision),
            actor: {
              source: "mcp",
              id: String(actorId ?? "design-plan-agent"),
            },
            ...(roleIds ? { roleIds: roleIds.map(String) } : {}),
            ...(variantRuleId ? { variantRuleId: String(variantRuleId) } : {}),
          }),
        ),
    ),
  );
  server.registerTool(
    "apply_layout_system",
    {
      title: "Apply layout system",
      description:
        "Compile every explicit DesignPlan anchor plus its single global safe area into ordinary frame operations and a canonical preview. Never commits automatically.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        planId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        workspacePath,
        projectId,
        frameId,
        planId,
        baseRevision,
        actorId,
      }) =>
        withClient(workspacePath, (client) =>
          client.applyLayoutSystem({
            projectId: String(projectId),
            frameId: String(frameId),
            planId: String(planId),
            baseRevision: Number(baseRevision),
            actor: { source: "mcp", id: String(actorId ?? "layout-agent") },
          }),
        ),
    ),
  );
  server.registerTool(
    "reflow_content",
    {
      title: "Reflow content",
      description:
        "Re-apply explicit anchors for selected DesignPlan roles after content changes. Returns ordinary frame operations in a canonical preview and never changes the canvas safe area.",
      inputSchema: {
        ...workspaceSchema,
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
      async ({
        workspacePath,
        projectId,
        frameId,
        planId,
        baseRevision,
        roleIds,
        actorId,
      }) =>
        withClient(workspacePath, (client) =>
          client.reflowContent({
            projectId: String(projectId),
            frameId: String(frameId),
            planId: String(planId),
            baseRevision: Number(baseRevision),
            roleIds: roleIds.map(String),
            actor: { source: "mcp", id: String(actorId ?? "reflow-agent") },
          }),
        ),
    ),
  );
  server.registerTool(
    "create_design_variants",
    {
      title: "Create design variant",
      description:
        "Compile one exact saved DesignPlan variant rule into an ordinary canonical preview. Same-format hide/reflow/stretch-resize behaviors only; format changes return a warning and no partial preview. Never commits automatically.",
      inputSchema: {
        ...workspaceSchema,
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
        workspacePath,
        projectId,
        frameId,
        planId,
        variantRuleId,
        baseRevision,
        actorId,
      }) =>
        withClient(workspacePath, (client) =>
          client.createDesignVariant({
            projectId: String(projectId),
            frameId: String(frameId),
            planId: String(planId),
            variantRuleId: String(variantRuleId),
            baseRevision: Number(baseRevision),
            actor: {
              source: "mcp",
              id: String(actorId ?? "variant-agent"),
            },
          }),
        ),
    ),
  );
  server.registerTool(
    "bind_brand_tokens",
    {
      title: "Bind Brand tokens",
      description:
        "Compile only exact palette and typography bindings already declared by a DesignPlan against the project's exact pinned Brand Kit into an ordinary canonical preview. Never accepts token or value overrides and never commits automatically.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        planId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        roleIds: z.array(z.string().uuid()).min(1).max(100).optional(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        workspacePath,
        projectId,
        frameId,
        planId,
        baseRevision,
        roleIds,
        actorId,
      }) =>
        withClient(workspacePath, (client) =>
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
    ),
  );
  server.registerTool(
    "replace_role_asset",
    {
      title: "Replace role asset",
      description:
        "Compile the exact asset assignment already declared for one DesignPlan role into ordinary asset/crop operations and a canonical preview. Never accepts undeclared replacement intent or commits automatically.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        planId: z.string().uuid(),
        roleId: z.string().uuid(),
        baseRevision: z.number().int().nonnegative(),
        actorId: z.string().min(1).max(128).optional(),
      },
    },
    safe(
      async ({
        workspacePath,
        projectId,
        frameId,
        planId,
        roleId,
        baseRevision,
        actorId,
      }) =>
        withClient(workspacePath, (client) =>
          client.replaceRoleAsset({
            projectId: String(projectId),
            frameId: String(frameId),
            planId: String(planId),
            roleId: String(roleId),
            baseRevision: Number(baseRevision),
            actor: {
              source: "mcp",
              id: String(actorId ?? "role-asset-agent"),
            },
          }),
        ),
    ),
  );
  server.registerTool(
    "apply_project_template",
    {
      title: "Apply project template",
      description:
        "Compile a canonical project template into ordinary stable-ID frame nodes with semantic slot metadata. Preview is the default and must be reviewed before commit.",
      inputSchema: {
        ...workspaceSchema,
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
        workspacePath,
        projectId,
        frameId,
        templateId,
        baseRevision,
        mode,
        parentId,
        index,
        actorId,
      }) =>
        withClient(workspacePath, async (client) => {
          const templates = await client.listProjectTemplates(
            String(projectId),
          );
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
        }),
    ),
  );
  server.registerTool(
    "detach_project_template",
    {
      title: "Detach project template instance",
      description:
        "Remove template and semantic-slot metadata through normal frame operations while preserving every visible node and value.",
      inputSchema: {
        ...workspaceSchema,
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
        workspacePath,
        projectId,
        frameId,
        instanceId,
        baseRevision,
        mode,
        actorId,
      }) =>
        withClient(workspacePath, async (client) => {
          const frame = await client.getFrame(
            String(projectId),
            String(frameId),
          );
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
        }),
    ),
  );

  const importLocal = async (
    type: "asset" | "font",
    workspacePath: string,
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
    const { descriptor } = await clientForWorkspace(workspacePath);
    const form = new FormData();
    form.set(
      "file",
      new Blob([await readFile(resolved)]),
      path.basename(resolved),
    );
    form.set("baseRevision", String(baseRevision));
    if (licenseNotes) form.set("licenseNotes", licenseNotes);
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/${type === "asset" ? "assets" : "fonts"}/import`,
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
        "Validate and copy a local PNG, JPEG, WebP, or SVG. The source path is never persisted.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        sourcePath: z.string().min(1),
        baseRevision: z.number().int().min(0),
      },
    },
    safe(async ({ workspacePath, projectId, sourcePath, baseRevision }) =>
      importLocal(
        "asset",
        String(workspacePath),
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
        "Validate and copy a local WOFF2, WOFF, TTF, or OTF with license notes. The source path is never persisted.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        sourcePath: z.string().min(1),
        baseRevision: z.number().int().min(0),
        licenseNotes: z.string().optional(),
      },
    },
    safe(
      async ({
        workspacePath,
        projectId,
        sourcePath,
        baseRevision,
        licenseNotes,
      }) =>
        importLocal(
          "font",
          String(workspacePath),
          String(projectId),
          String(sourcePath),
          Number(baseRevision),
          licenseNotes ? String(licenseNotes) : undefined,
        ),
    ),
  );
  server.registerTool(
    "wait_for_frame_change",
    {
      title: "Wait for a human or agent frame revision",
      description:
        "Wait briefly for Studio or another agent to commit a newer frame revision, then return the refreshed canonical frame.",
      inputSchema: {
        ...workspaceSchema,
        projectId: z.string().uuid(),
        frameId: z.string().uuid(),
        afterRevision: z.number().int().min(0),
        timeoutMs: z.number().int().min(250).max(55_000).default(30_000),
      },
    },
    safe(
      async ({
        workspacePath,
        projectId,
        frameId,
        afterRevision,
        timeoutMs,
      }) => {
        const { client } = await clientForWorkspace(String(workspacePath));
        const deadline = Date.now() + Number(timeoutMs);
        do {
          const frame = await client.getFrame(
            String(projectId),
            String(frameId),
          );
          if (frame.revision > Number(afterRevision))
            return { status: "changed", frame };
          await wait(250);
        } while (Date.now() < deadline);
        return {
          status: "timeout",
          afterRevision: Number(afterRevision),
        };
      },
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
  runAgentMcp().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
