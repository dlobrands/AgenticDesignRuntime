import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productMetadata = JSON.parse(
  await readFile(path.join(root, "product-metadata.json"), "utf8"),
);
const plugin = path.resolve(
  process.argv[2] ?? path.join(root, "plugins", "agentic-design-runtime"),
);

const updateTools = [
  "update_check",
  "update_fetch",
  "update_apply",
  "update_rollback",
];
const workspaceMigrationTools = [
  "inspect_workspace_migration",
  "preview_workspace_migration",
  "commit_workspace_migration",
  "rollback_workspace_migration",
];
const sortedUnique = (values) => [...new Set(values)].sort();
const extractRegisteredTools = (source) => {
  const tools = [...source.matchAll(/registerTool\(\s*["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  if (source.includes("`update_${action}`")) tools.push(...updateTools);
  if (source.includes("`${action}_workspace_migration`"))
    tools.push(...workspaceMigrationTools);
  return sortedUnique(tools);
};
const assertExactSet = (actual, expected, label) => {
  const missing = expected.filter((value) => !actual.includes(value));
  const extra = actual.filter((value) => !expected.includes(value));
  if (missing.length || extra.length)
    throw new Error(
      `${label} differs from tool-surface.json. Missing: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}.`,
    );
};
const markdownFiles = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(target)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
  }
  return files;
};

const requiredFiles = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "skills/agentic-design/SKILL.md",
  "skills/agentic-design/agents/openai.yaml",
  "skills/agentic-design/references/operations.md",
  "skills/agentic-design/references/recovery.md",
  "skills/agentic-design/references/visual-qa.md",
  "design-intelligence-manifest.json",
  "tool-surface.json",
  "plugin-evals.json",
];
for (const relative of requiredFiles) {
  const info = await stat(path.join(plugin, relative)).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`Plugin file is missing: ${relative}`);
}

const manifest = JSON.parse(
  await readFile(path.join(plugin, ".codex-plugin", "plugin.json"), "utf8"),
);
if (manifest.name !== "agentic-design-runtime")
  throw new Error("Plugin name must remain agentic-design-runtime.");
if (!/^\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version))
  throw new Error("Plugin version is not valid release or cachebuster semver.");
if (manifest.version.split("+")[0] !== productMetadata.pluginVersion)
  throw new Error("Plugin base version does not match product metadata.");
if (manifest.skills !== "./skills/" || manifest.mcpServers !== "./.mcp.json")
  throw new Error("Plugin component paths are not canonical.");
for (const field of ["composerIcon", "logo", "logoDark"])
  if (
    typeof manifest.interface?.[field] !== "string" ||
    !(
      await stat(path.join(plugin, manifest.interface[field])).catch(
        () => undefined,
      )
    )?.isFile()
  )
    throw new Error(`Plugin interface asset is missing: ${field}.`);

const mcp = JSON.parse(await readFile(path.join(plugin, ".mcp.json"), "utf8"));
const server = mcp.mcpServers?.["agentic-design-runtime"];
if (
  server?.command !== "node" ||
  !Array.isArray(server.args) ||
  !server.args.includes("./dist/agent-cli.js")
)
  throw new Error("Plugin MCP launcher is invalid.");

const skill = await readFile(
  path.join(plugin, "skills", "agentic-design", "SKILL.md"),
  "utf8",
);
if (!skill.startsWith("---\nname: agentic-design\n"))
  throw new Error("Skill frontmatter is invalid.");
if (skill.includes("[TODO:"))
  throw new Error("Skill contains TODO placeholders.");

const expectedSkills = [
  "agentic-brand-system",
  "agentic-design",
  "agentic-design-ops",
  "agentic-design-review",
];
const discoveredSkills = [];
for (const entry of await readdir(path.join(plugin, "skills"), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  const skillPath = path.join(plugin, "skills", entry.name, "SKILL.md");
  if (!(await stat(skillPath).catch(() => undefined))?.isFile()) continue;
  const contents = await readFile(skillPath, "utf8");
  if (!contents.startsWith(`---\nname: ${entry.name}\n`))
    throw new Error(
      `Skill frontmatter does not match its folder: ${entry.name}.`,
    );
  if (contents.includes("[TODO:"))
    throw new Error(`Skill contains TODO placeholders: ${entry.name}.`);
  const agentMetadata = path.join(
    plugin,
    "skills",
    entry.name,
    "agents",
    "openai.yaml",
  );
  if (!(await stat(agentMetadata).catch(() => undefined))?.isFile())
    throw new Error(`Skill UI metadata is missing: ${entry.name}.`);
  discoveredSkills.push(entry.name);
}
assertExactSet(discoveredSkills.sort(), expectedSkills, "Plugin skill surface");

const pluginEvals = JSON.parse(
  await readFile(path.join(plugin, "plugin-evals.json"), "utf8"),
);
if (pluginEvals.schemaVersion !== 1)
  throw new Error("Plugin eval manifest schema is invalid.");
assertExactSet(
  Object.keys(pluginEvals.skills ?? {}).sort(),
  expectedSkills,
  "Plugin eval skill coverage",
);
for (const skillName of expectedSkills)
  for (const lane of ["explicit", "indirect", "negative"])
    if (
      !Array.isArray(pluginEvals.skills[skillName]?.[lane]) ||
      pluginEvals.skills[skillName][lane].length !== 5 ||
      pluginEvals.skills[skillName][lane].some(
        (prompt) => typeof prompt !== "string" || !prompt.trim(),
      )
    )
      throw new Error(
        `Plugin evals require five non-empty ${lane} prompts for ${skillName}.`,
      );
if (
  !Array.isArray(pluginEvals.crossLane) ||
  pluginEvals.crossLane.length !== 20 ||
  pluginEvals.crossLane.some(
    (entry) =>
      typeof entry?.prompt !== "string" ||
      !entry.prompt.trim() ||
      !Array.isArray(entry.expectedSkills) ||
      entry.expectedSkills.length === 0 ||
      entry.expectedSkills.some((name) => !expectedSkills.includes(name)),
  )
)
  throw new Error("Plugin evals require twenty valid cross-lane prompts.");

const toolSurface = JSON.parse(
  await readFile(path.join(plugin, "tool-surface.json"), "utf8"),
);
if (
  toolSurface.schemaVersion !== 1 ||
  !Array.isArray(toolSurface.directTools) ||
  !Array.isArray(toolSurface.agentOnlyTools)
)
  throw new Error("Plugin tool-surface.json is invalid.");
const directTools = sortedUnique(toolSurface.directTools);
const agentOnlyTools = sortedUnique(toolSurface.agentOnlyTools);
const agentTools = sortedUnique([...directTools, ...agentOnlyTools]);
if (
  directTools.length !== toolSurface.directTools.length ||
  agentOnlyTools.length !== toolSurface.agentOnlyTools.length
)
  throw new Error("Plugin tool-surface.json contains duplicate tools.");

const sourceAgentPath = path.join(root, "apps", "mcp", "src", "agent-cli.ts");
const sourceDirectPath = path.join(root, "apps", "mcp", "src", "cli.ts");
if (
  (await stat(sourceAgentPath).catch(() => undefined))?.isFile() &&
  (await stat(sourceDirectPath).catch(() => undefined))?.isFile()
) {
  assertExactSet(
    extractRegisteredTools(await readFile(sourceAgentPath, "utf8")),
    agentTools,
    "Agent MCP source tool surface",
  );
  assertExactSet(
    extractRegisteredTools(await readFile(sourceDirectPath, "utf8")),
    directTools,
    "Direct MCP source tool surface",
  );
}

const toolLikeReference =
  /`((?:runtime|update|ensure|list|get|search|validate|audit|migrate|rollback|preview|commit|bind|unbind|apply|create|remove|inspect|assign|reflow|replace|detach|import|wait|stop|open|switch|export)_[a-z0-9_]+)`/g;
for (const file of await markdownFiles(path.join(plugin, "skills"))) {
  const contents = await readFile(file, "utf8");
  for (const match of contents.matchAll(toolLikeReference))
    if (!agentTools.includes(match[1]))
      throw new Error(
        `Skill reference names unavailable agent tool ${match[1]} in ${path.relative(plugin, file)}.`,
      );
}

const designIntelligenceManifestPath = path.join(
  plugin,
  "design-intelligence-manifest.json",
);
const designIntelligenceManifestBytes = await readFile(
  designIntelligenceManifestPath,
);
const designIntelligenceManifest = JSON.parse(
  designIntelligenceManifestBytes.toString("utf8"),
);
if (
  designIntelligenceManifest.schemaVersion !== 1 ||
  !/^\d+\.\d+\.\d+$/.test(designIntelligenceManifest.version ?? "") ||
  designIntelligenceManifest.version !==
    productMetadata.designIntelligenceVersion ||
  !Array.isArray(designIntelligenceManifest.modules) ||
  designIntelligenceManifest.modules.length < 8
)
  throw new Error("Design-intelligence manifest is invalid.");

const moduleIds = new Set();
const modulePaths = new Set();
for (const module of designIntelligenceManifest.modules) {
  if (
    typeof module?.id !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(module.id) ||
    typeof module?.path !== "string" ||
    module.path !==
      `skills/agentic-design/references/design-intelligence/${module.id}.md` ||
    typeof module?.loadWhen !== "string" ||
    !module.loadWhen.trim()
  )
    throw new Error("Design-intelligence module metadata is invalid.");
  if (moduleIds.has(module.id) || modulePaths.has(module.path))
    throw new Error("Design-intelligence module IDs and paths must be unique.");
  moduleIds.add(module.id);
  modulePaths.add(module.path);
  const target = path.resolve(plugin, module.path);
  if (!target.startsWith(`${plugin}${path.sep}`))
    throw new Error(
      `Design-intelligence module escapes the plugin: ${module.path}`,
    );
  const info = await stat(target).catch(() => undefined);
  if (!info?.isFile() || info.size === 0)
    throw new Error(
      `Design-intelligence module is missing or empty: ${module.path}`,
    );
  const skillLink = module.path.replace("skills/agentic-design/", "");
  if (!skill.includes(skillLink))
    throw new Error(
      `Skill does not route to design-intelligence module: ${module.id}`,
    );
}
if (!modulePaths.has(designIntelligenceManifest.entryPoint))
  throw new Error("Design-intelligence entry point is not a declared module.");
if (!moduleIds.has("core-judgment") || !moduleIds.has("critique"))
  throw new Error(
    "Design-intelligence core and critique modules are required.",
  );

const designIntelligenceManifestSha256 = createHash("sha256")
  .update(designIntelligenceManifestBytes)
  .digest("hex");

const packed = await stat(path.join(plugin, "compatibility.json"))
  .then((entry) => entry.isFile())
  .catch(() => false);
if (packed) {
  for (const relative of [
    "dist/agent-cli.js",
    `packages/tva-agentic-design-runtime-${productMetadata.productVersion}.tgz`,
  ]) {
    const info = await stat(path.join(plugin, relative)).catch(() => undefined);
    if (!info?.isFile())
      throw new Error(`Packed plugin payload is missing: ${relative}`);
  }
  const compatibility = JSON.parse(
    await readFile(path.join(plugin, "compatibility.json"), "utf8"),
  );
  if (
    compatibility.productVersion !== productMetadata.productVersion ||
    compatibility.runtimeApiVersion !== productMetadata.runtimeApiVersion ||
    compatibility.workspaceSchemaVersion !==
      productMetadata.workspaceSchemaVersion ||
    compatibility.designIntelligenceVersion !==
      productMetadata.designIntelligenceVersion ||
    compatibility.designIntelligenceManifestSha256 !==
      designIntelligenceManifestSha256
  )
    throw new Error("Packed plugin compatibility metadata is invalid.");
  assertExactSet(
    extractRegisteredTools(
      await readFile(path.join(plugin, "dist", "agent-cli.js"), "utf8"),
    ),
    agentTools,
    "Packed agent MCP tool surface",
  );
}

process.stdout.write(`${plugin}\n`);
