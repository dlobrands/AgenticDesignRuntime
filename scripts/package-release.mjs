import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(root, "release");
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const productMetadata = JSON.parse(
  await readFile(path.join(root, "product-metadata.json"), "utf8"),
);
const version = productMetadata.productVersion;
if (packageJson.version !== version)
  throw new Error("Root package version does not match product-metadata.json.");
for (const packagePath of [
  "apps/mcp/package.json",
  "apps/runtime/package.json",
  "apps/studio/package.json",
  "packages/client/package.json",
  "packages/core/package.json",
  "packages/renderer-pixi/package.json",
]) {
  const manifest = JSON.parse(
    await readFile(path.join(root, packagePath), "utf8"),
  );
  if (manifest.version !== version)
    throw new Error(`${packagePath} version does not match ${version}.`);
}
const pluginManifest = JSON.parse(
  await readFile(
    path.join(
      root,
      "plugins",
      "agentic-design-runtime",
      ".codex-plugin",
      "plugin.json",
    ),
    "utf8",
  ),
);
const pluginVersion = pluginManifest.version;
const packagesFromRegistry = process.argv.includes("--packages-from-registry");
await rm(release, { recursive: true, force: true });
await mkdir(release, { recursive: true });

const digest = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

for (const packageName of [
  "@tva-agentic-design/core",
  "@tva-agentic-design/client",
  "@tva-agentic-design/renderer-pixi",
  "@tva-agentic-design/runtime",
  "@tva-agentic-design/mcp",
]) {
  if (packagesFromRegistry)
    execFileSync(
      "npm",
      [
        "pack",
        `${packageName}@${version}`,
        "--pack-destination",
        release,
        "--silent",
      ],
      { cwd: root, stdio: "inherit" },
    );
  else
    execFileSync(
      "pnpm",
      ["--filter", packageName, "pack", "--pack-destination", release],
      {
        cwd: root,
        stdio: "inherit",
      },
    );
}

const runtimeArchiveName = `tva-agentic-design-runtime-${version}.tgz`;
const runtimeArchive = path.join(release, runtimeArchiveName);
const pluginSource = path.join(root, "plugins", "agentic-design-runtime");
const pluginStage = path.join(release, ".agentic-design-plugin-stage");
await cp(pluginSource, pluginStage, {
  recursive: true,
  filter: (source) => path.basename(source) !== ".DS_Store",
});
await rm(path.join(pluginStage, "dist"), { recursive: true, force: true });
await rm(path.join(pluginStage, "packages"), {
  recursive: true,
  force: true,
});
await mkdir(path.join(pluginStage, "dist"), { recursive: true });
await mkdir(path.join(pluginStage, "packages"), { recursive: true });
await cp(
  path.join(root, "apps", "mcp", "dist", "agent-cli.js"),
  path.join(pluginStage, "dist", "agent-cli.js"),
);
await cp(
  runtimeArchive,
  path.join(pluginStage, "packages", runtimeArchiveName),
);
await writeFile(
  path.join(pluginStage, "compatibility.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      productVersion: version,
      runtimeApiVersion: productMetadata.runtimeApiVersion,
      workspaceSchemaVersion: productMetadata.workspaceSchemaVersion,
      runtimeArtifact: runtimeArchiveName,
      runtimeSha256: await digest(runtimeArchive),
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
execFileSync(
  "node",
  [path.join(root, "scripts", "validate-plugin.mjs"), pluginStage],
  {
    cwd: root,
    stdio: "inherit",
  },
);
const pluginArchiveName = `agentic-design-runtime-plugin-${pluginVersion}.tgz`;
execFileSync(
  "tar",
  ["-czf", path.join(release, pluginArchiveName), "-C", pluginStage, "."],
  { cwd: root, stdio: "inherit" },
);
await rm(pluginStage, { recursive: true, force: true });

const components = (await readdir(release))
  .filter((name) => name.endsWith(".tgz"))
  .sort();
const artifacts = await Promise.all(
  components.map(async (name) => ({
    name,
    sizeBytes: (await stat(path.join(release, name))).size,
    sha256: await digest(path.join(release, name)),
  })),
);
const manifest = {
  schemaVersion: 1,
  product: "Agentic Design Runtime",
  version,
  platform: "macOS Apple Silicon",
  builtAt: new Date().toISOString(),
  engines: {
    node: ">=22",
    referenceNode: productMetadata.referenceVersions.node,
    pnpm: productMetadata.referenceVersions.pnpm,
  },
  renderer: {
    pixi: productMetadata.referenceVersions.pixi,
    playwright: productMetadata.referenceVersions.playwright,
    fastify: productMetadata.referenceVersions.fastify,
  },
  compatibility: {
    runtimeApiVersion: productMetadata.runtimeApiVersion,
    workspaceSchemaVersion: productMetadata.workspaceSchemaVersion,
  },
  binaries: ["design-runtime", "design-runtime-mcp", "agentic-design-mcp"],
  agentIntegration: {
    plugin: "agentic-design-runtime",
    pluginVersion,
    skill: "$agentic-design",
    runtimeArtifact: runtimeArchiveName,
  },
  trustedUpdates: {
    implementation: "check-fetch-apply-rollback",
    productionConfiguration: "unbound",
    evidence: [
      "sbom.spdx.json",
      "provenance.template.json",
      "trusted-update-manifest.template.json",
    ],
  },
  contents: [
    "production Studio",
    "IBM Plex interface fonts",
    "runtime CLI",
    "MCP stdio adapter",
    "Agentic Design Runtime Codex plugin",
    "$agentic-design entry skill",
  ],
  artifacts,
};
await writeFile(
  path.join(release, "release-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o600 },
);
const install = `# Agentic Design Runtime ${version}\n\nRequires macOS Apple Silicon, macOS 14+, Node 24.18.0 (Node >=22 accepted), pnpm 10.34.5, and pinned Chromium.\n\n## Verified local installation\n\n\`\`\`bash\nnode install-macos-release.mjs --release . --target "$HOME/.agentic-design-runtime/current"\nnode doctor-macos.mjs --target "$HOME/.agentic-design-runtime/current"\n\`\`\`\n\nThe installer verifies every checksum before writing, stages an isolated exact-version install, validates all three binaries, and atomically replaces the target while retaining the previous install as a timestamped backup. Workspaces are never stored inside or deleted with the installation. Start with an existing empty directory: \`$HOME/.agentic-design-runtime/current/node_modules/.bin/design-runtime dev /absolute/workspace/path\`.\n\nTo uninstall recoverably, run \`node uninstall-macos-release.mjs --target "$HOME/.agentic-design-runtime/current"\`.\n\n## Trusted updates\n\nUpdate check/fetch/apply/rollback remains disabled until an approved official origin, release signing key, provenance builder identity, and channel policy are provisioned in the owner-only trust configuration. The included manifest and provenance files are non-active templates.\n\n## Codex agent plugin\n\nRun \`node install-personal-plugin.mjs\`, start a new Codex task, then invoke \`$agentic-design\`. The plugin installs its exact bundled runtime on first use.\n`;
await writeFile(path.join(release, "INSTALL.md"), install, { mode: 0o600 });
await cp(
  path.join(root, "scripts", "install-personal-plugin.mjs"),
  path.join(release, "install-personal-plugin.mjs"),
);
for (const script of [
  "doctor-macos.mjs",
  "install-macos-release.mjs",
  "uninstall-macos-release.mjs",
])
  await cp(path.join(root, "scripts", script), path.join(release, script));
execFileSync(
  process.execPath,
  [path.join(root, "scripts", "generate-release-evidence.mjs")],
  { cwd: root, stdio: "inherit" },
);

const bundleName = `agentic-design-runtime-v${version}-macos-arm64.tgz`;
execFileSync(
  "tar",
  [
    "-czf",
    path.join(release, bundleName),
    "-C",
    release,
    ...components,
    "release-manifest.json",
    "INSTALL.md",
    "install-personal-plugin.mjs",
    "doctor-macos.mjs",
    "install-macos-release.mjs",
    "uninstall-macos-release.mjs",
    "sbom.spdx.json",
    "provenance.template.json",
    "trusted-update-manifest.template.json",
  ],
  { cwd: root, stdio: "inherit" },
);
const checksumFiles = [
  ...components,
  "release-manifest.json",
  "INSTALL.md",
  "install-personal-plugin.mjs",
  "doctor-macos.mjs",
  "install-macos-release.mjs",
  "uninstall-macos-release.mjs",
  "sbom.spdx.json",
  "provenance.template.json",
  "trusted-update-manifest.template.json",
  bundleName,
];
const checksums = (
  await Promise.all(
    checksumFiles.map(
      async (name) => `${await digest(path.join(release, name))}  ${name}`,
    ),
  )
).join("\n");
await writeFile(path.join(release, "SHA256SUMS"), `${checksums}\n`, {
  mode: 0o600,
});
await chmod(path.join(release, "SHA256SUMS"), 0o600);
process.stdout.write(`${path.join(release, bundleName)}\n`);
