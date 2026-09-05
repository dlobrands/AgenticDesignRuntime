import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

const readOnlyTools = new Set([
  "runtime_prerequisites",
  "update_check",
  "inspect_workspace_migration",
  "preview_workspace_migration",
  "list_active_workspaces",
  "runtime_status",
  "list_projects",
  "get_project",
  "list_frames",
  "get_frame",
  "get_node",
  "search_nodes",
  "list_assets",
  "list_fonts",
  "list_brand_kits",
  "get_brand_kit",
  "get_history",
  "get_revision",
  "compare_revisions",
  "validate_frame",
  "audit_visual_quality",
  "audit_brand_system",
  "explain_proposed_changes",
  "preview_proposal",
  "render_preview",
  "list_project_templates",
  "list_design_briefs",
  "list_design_plans",
  "inspect_design_plan",
  "inspect_design_roles",
  "wait_for_frame_change",
]);

const destructiveTools = new Set([
  "update_apply",
  "update_rollback",
  "commit_workspace_migration",
  "rollback_workspace_migration",
]);
const openWorldTools = new Set([
  "runtime_prerequisites",
  "ensure_design_workspace",
  "update_check",
  "update_fetch",
]);

export const annotationsForTool = (name: string): ToolAnnotations => ({
  readOnlyHint: readOnlyTools.has(name),
  destructiveHint: destructiveTools.has(name),
  idempotentHint:
    readOnlyTools.has(name) ||
    name === "open_studio" ||
    name === "stop_runtime" ||
    name.startsWith("export_"),
  openWorldHint: openWorldTools.has(name),
});

const describeForSelection = (description?: string): string | undefined => {
  if (!description || description.startsWith("Use this when"))
    return description;
  return `Use this when you need to ${description.charAt(0).toLowerCase()}${description.slice(1)}`;
};

export const withToolContracts = (server: McpServer): McpServer => {
  const register = server.registerTool.bind(server);
  server.registerTool = ((name, config, callback) =>
    register(
      name,
      {
        ...config,
        description: describeForSelection(config.description),
        outputSchema: config.outputSchema ?? (z.looseObject({}) as never),
        annotations: config.annotations ?? annotationsForTool(name),
      },
      callback,
    )) as McpServer["registerTool"];
  return server;
};
