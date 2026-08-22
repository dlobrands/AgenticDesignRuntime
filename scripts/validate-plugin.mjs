import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
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

const requiredFiles = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "skills/agentic-design/SKILL.md",
  "skills/agentic-design/agents/openai.yaml",
  "skills/agentic-design/references/operations.md",
  "skills/agentic-design/references/recovery.md",
  "skills/agentic-design/references/visual-qa.md",
  "design-intelligence-manifest.json",
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
if (manifest.skills !== "./skills/" || manifest.mcpServers !== "./.mcp.json")
  throw new Error("Plugin component paths are not canonical.");

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
}

process.stdout.write(`${plugin}\n`);
