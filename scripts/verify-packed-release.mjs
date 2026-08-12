import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(root, "release");
const productMetadata = JSON.parse(
  await readFile(path.join(root, "product-metadata.json"), "utf8"),
);
const expectedVersion = productMetadata.productVersion;
const sourcePluginManifest = JSON.parse(
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
const expectedPluginVersion = sourcePluginManifest.version;
const files = await readdir(release);
const runtime = files.find((name) =>
  /^agentic-design-runtime-[0-9].*\.tgz$/.test(name),
);
const mcp = files.find((name) =>
  /^agentic-design-mcp-[0-9].*\.tgz$/.test(name),
);
const plugin = files.find((name) =>
  /^agentic-design-runtime-plugin-[0-9].*\.tgz$/.test(name),
);
const publicLibraries = ["core", "client", "renderer-pixi"].map((packageName) =>
  files.find((name) =>
    new RegExp(`^agentic-design-${packageName}-[0-9].*\\.tgz$`).test(name),
  ),
);
if (!runtime || !mcp || !plugin || publicLibraries.some((name) => !name))
  throw new Error("Packed runtime, MCP, and plugin components were not found.");
const temporary = await mkdtemp(path.join(tmpdir(), "agentic-packed-install-"));
let runtimeProcess;

const availablePort = async () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a loopback port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const stopRuntime = async () => {
  if (!runtimeProcess || runtimeProcess.exitCode !== null) return;
  runtimeProcess.kill("SIGTERM");
  await Promise.race([
    once(runtimeProcess, "exit"),
    new Promise((resolve) => globalThis.setTimeout(resolve, 10_000)),
  ]);
  if (runtimeProcess.exitCode === null) runtimeProcess.kill("SIGKILL");
};

try {
  for (const releaseTool of [
    "doctor-macos.mjs",
    "install-macos-release.mjs",
    "uninstall-macos-release.mjs",
  ])
    if (!(await stat(path.join(release, releaseTool)).catch(() => undefined)))
      throw new Error(`Packed release is missing ${releaseTool}.`);
  await writeFile(
    path.join(temporary, "package.json"),
    `${JSON.stringify({
      private: true,
      type: "module",
      packageManager: "pnpm@10.34.5",
      dependencies: {
        "@agentic-design/core": `file:${path.join(release, publicLibraries[0])}`,
        "@agentic-design/client": `file:${path.join(release, publicLibraries[1])}`,
        "@agentic-design/renderer-pixi": `file:${path.join(release, publicLibraries[2])}`,
        "@agentic-design/runtime": `file:${path.join(release, runtime)}`,
        "@agentic-design/mcp": `file:${path.join(release, mcp)}`,
      },
      pnpm: {
        overrides: {
          "@agentic-design/core": `file:${path.join(release, publicLibraries[0])}`,
        },
      },
    })}\n`,
  );
  for (const archive of publicLibraries) {
    const packageManifest = JSON.parse(
      execFileSync(
        "tar",
        ["-xOf", path.join(release, archive), "package/package.json"],
        {
          encoding: "utf8",
        },
      ),
    );
    const dependencyValues = Object.values(packageManifest.dependencies ?? {});
    if (
      dependencyValues.some((value) => String(value).startsWith("workspace:"))
    )
      throw new Error(
        `${archive} retained an unpublished workspace dependency.`,
      );
    if (packageManifest.publishConfig?.access !== "public")
      throw new Error(`${archive} is not configured for public npm access.`);
  }
  execFileSync("pnpm", ["install"], { cwd: temporary, stdio: "inherit" });
  const binaryPath = (binary) =>
    path.join(temporary, "node_modules", ".bin", binary);
  for (const binary of [
    "design-runtime",
    "design-runtime-mcp",
    "agentic-design-mcp",
  ]) {
    const output = execFileSync(binaryPath(binary), ["--version"], {
      cwd: temporary,
      encoding: "utf8",
    }).trim();
    if (output !== expectedVersion)
      throw new Error(`${binary} returned ${output || "no version"}.`);
  }
  const manifest = JSON.parse(
    await readFile(path.join(release, "release-manifest.json"), "utf8"),
  );
  if (
    manifest.binaries?.length !== 3 ||
    !manifest.binaries.includes("agentic-design-mcp") ||
    manifest.agentIntegration?.pluginVersion !== expectedPluginVersion ||
    manifest.compatibility?.runtimeApiVersion !==
      productMetadata.runtimeApiVersion ||
    manifest.compatibility?.workspaceSchemaVersion !==
      productMetadata.workspaceSchemaVersion
  )
    throw new Error("Release manifest compatibility or binaries are invalid.");
  const sbom = JSON.parse(
    await readFile(path.join(release, "sbom.spdx.json"), "utf8"),
  );
  const provenance = JSON.parse(
    await readFile(path.join(release, "provenance.template.json"), "utf8"),
  );
  const updateTemplate = JSON.parse(
    await readFile(
      path.join(release, "trusted-update-manifest.template.json"),
      "utf8",
    ),
  );
  if (
    sbom.spdxVersion !== "SPDX-2.3" ||
    !Array.isArray(sbom.packages) ||
    sbom.packages.length < 6 ||
    provenance.predicateType !== "https://slsa.dev/provenance/v1" ||
    updateTemplate.artifact?.format !== "adr-runtime-bundle-v1" ||
    updateTemplate.signature?.keyId !== "UNBOUND_RELEASE_SIGNING_KEY_ID"
  )
    throw new Error(
      "Release SBOM, provenance, or update scaffolding is invalid.",
    );

  const pluginDirectory = path.join(temporary, "plugin");
  await mkdir(pluginDirectory);
  execFileSync(
    "tar",
    ["-xzf", path.join(release, plugin), "-C", pluginDirectory],
    { cwd: temporary, stdio: "inherit" },
  );
  const packedPluginManifest = JSON.parse(
    await readFile(
      path.join(pluginDirectory, ".codex-plugin", "plugin.json"),
      "utf8",
    ),
  );
  if (packedPluginManifest.version !== expectedPluginVersion)
    throw new Error(
      `Packed plugin version ${packedPluginManifest.version || "missing"} does not match ${expectedPluginVersion}.`,
    );
  execFileSync(
    process.execPath,
    [path.join(root, "scripts", "validate-plugin.mjs"), pluginDirectory],
    { cwd: temporary, stdio: "inherit" },
  );
  const agentVersion = execFileSync(
    process.execPath,
    [path.join(pluginDirectory, "dist", "agent-cli.js"), "--version"],
    { cwd: temporary, encoding: "utf8" },
  ).trim();
  if (agentVersion !== expectedVersion)
    throw new Error(`Packed plugin returned ${agentVersion || "no version"}.`);

  const workspace = path.join(temporary, "workspace");
  const descriptors = path.join(temporary, "descriptors");
  await mkdir(workspace);
  const port = await availablePort();
  const runtimeEnvironment = {
    ...process.env,
    ADR_DESCRIPTOR_DIRECTORY: descriptors,
    ADR_PREFERENCES_PATH: path.join(temporary, "preferences.json"),
  };
  runtimeProcess = spawn(
    binaryPath("design-runtime"),
    ["dev", workspace, "--no-open", "--port", String(port)],
    {
      cwd: temporary,
      env: runtimeEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const ready = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = globalThis.setTimeout(
      () => reject(new Error(`Packed runtime did not become ready. ${output}`)),
      30_000,
    );
    runtimeProcess.stdout.on("data", (chunk) => {
      output += chunk.toString();
      for (const line of output.split("\n")) {
        try {
          const value = JSON.parse(line);
          if (value.status === "ready") {
            globalThis.clearTimeout(timeout);
            resolve(value);
          }
        } catch {
          // Ignore partial non-JSON output while the process starts.
        }
      }
    });
    runtimeProcess.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    runtimeProcess.once("exit", (code) => {
      globalThis.clearTimeout(timeout);
      reject(new Error(`Packed runtime exited with ${code}. ${output}`));
    });
  });
  const descriptorPath = path.join(descriptors, `${ready.runtimeId}.json`);
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  const response = await globalThis.fetch(`${ready.baseUrl}/api/runtime`, {
    headers: {
      authorization: `Bearer ${descriptor.capabilityToken}`,
      "x-design-runtime-id": descriptor.runtimeId,
      "x-design-workspace-id": descriptor.workspaceId,
    },
  });
  const runtimeStatus = await response.json();
  if (
    !response.ok ||
    runtimeStatus.status !== "ready" ||
    runtimeStatus.versions?.runtime !== expectedVersion ||
    runtimeStatus.compatibility?.runtimeApiVersion !==
      productMetadata.runtimeApiVersion ||
    runtimeStatus.compatibility?.workspaceSchemaVersion !==
      productMetadata.workspaceSchemaVersion
  )
    throw new Error("Packed runtime API smoke check failed.");
  if (!(await globalThis.fetch(ready.baseUrl)).ok)
    throw new Error("Packed production Studio was not served.");
  const runtimeExited = once(runtimeProcess, "exit");
  const stopStatus = JSON.parse(
    execFileSync(binaryPath("design-runtime"), ["stop", workspace], {
      cwd: temporary,
      encoding: "utf8",
      env: runtimeEnvironment,
    }),
  );
  if (
    stopStatus.status !== "stopped" ||
    stopStatus.runtimeId !== descriptor.runtimeId
  )
    throw new Error(
      "Packed runtime CLI shutdown did not authenticate cleanly.",
    );
  await runtimeExited;
  if (await stat(descriptorPath).catch(() => undefined))
    throw new Error("Packed runtime descriptor remained after shutdown.");

  const diagnostics = JSON.parse(
    execFileSync(
      binaryPath("design-runtime"),
      ["diagnostics", "export", workspace],
      { cwd: temporary, encoding: "utf8" },
    ),
  );
  const diagnosticsFiles = await readdir(diagnostics.directory);
  if (
    ![
      "runtime-summary.json",
      "redaction-report.json",
      "system-profile.json",
    ].every((name) => diagnosticsFiles.includes(name))
  )
    throw new Error("Packed diagnostics export is incomplete.");

  const installerTarget = path.join(temporary, "installer-target");
  const installerResult = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(release, "install-macos-release.mjs"),
        "--release",
        release,
        "--target",
        installerTarget,
        "--skip-browser",
      ],
      { cwd: temporary, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .at(-1),
  );
  if (
    installerResult.status !== "installed" ||
    installerResult.version !== expectedVersion
  )
    throw new Error(
      "macOS installer did not report an exact successful install.",
    );
  const doctor = JSON.parse(
    execFileSync(
      process.execPath,
      [path.join(release, "doctor-macos.mjs"), "--target", installerTarget],
      { cwd: temporary, encoding: "utf8" },
    ).trim(),
  );
  if (doctor.status !== "ready")
    throw new Error("Installed runtime failed macOS doctor checks.");
  const preservedWorkspace = path.join(temporary, "preserved-workspace");
  await mkdir(preservedWorkspace);
  await writeFile(path.join(preservedWorkspace, "sentinel"), "preserved\n");
  const uninstallResult = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(release, "uninstall-macos-release.mjs"),
        "--target",
        installerTarget,
        "--recovery-root",
        path.join(temporary, "removed-installs"),
      ],
      { cwd: temporary, encoding: "utf8" },
    ).trim(),
  );
  if (
    uninstallResult.status !== "removed" ||
    uninstallResult.workspacesChanged !== false ||
    !(await stat(path.join(preservedWorkspace, "sentinel")).catch(
      () => undefined,
    ))
  )
    throw new Error("Recoverable uninstall did not preserve workspace data.");

  const agentDescriptors = path.join(temporary, "agent-descriptors");
  const agentEnvironment = {
    ...process.env,
    ADR_DESCRIPTOR_DIRECTORY: agentDescriptors,
    ADR_PREFERENCES_PATH: path.join(temporary, "agent-preferences.json"),
    ADR_LAUNCHER_LOG_DIRECTORY: path.join(temporary, "launcher-logs"),
    ADR_AGENT_INSTALL_ROOT: path.join(temporary, "agent-install"),
    ADR_SKIP_BROWSER_INSTALL: "1",
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(pluginDirectory, "dist", "agent-cli.js"),
      "--plugin-root",
      pluginDirectory,
    ],
    cwd: temporary,
    env: agentEnvironment,
    stderr: "pipe",
  });
  const agentClient = new Client({
    name: "packed-agentic-design-verifier",
    version: expectedVersion,
  });
  await agentClient.connect(transport);
  let agentWorkspace;
  try {
    const availableTools = await agentClient.listTools();
    for (const required of [
      "ensure_design_workspace",
      "preview_batch",
      "commit_preview",
      "render_preview",
      "open_studio",
      "stop_runtime",
    ])
      if (!availableTools.tools.some((tool) => tool.name === required))
        throw new Error(`Packed plugin is missing the ${required} tool.`);

    const ensured = await agentClient.callTool({
      name: "ensure_design_workspace",
      arguments: {
        clientRoot: temporary,
        workspaceDirectory: "agent-workspace",
        openStudio: false,
        installBrowser: false,
      },
    });
    if (ensured.isError)
      throw new Error(
        `Packed plugin could not ensure a workspace: ${JSON.stringify(ensured.content)}`,
      );
    agentWorkspace = ensured.structuredContent?.workspacePath;
    if (typeof agentWorkspace !== "string")
      throw new Error(
        "Packed plugin did not return an explicit workspace path.",
      );

    const agentStatus = await agentClient.callTool({
      name: "runtime_status",
      arguments: { workspacePath: agentWorkspace },
    });
    if (
      agentStatus.isError ||
      agentStatus.structuredContent?.status !== "ready" ||
      agentStatus.structuredContent?.compatibility?.runtimeApiVersion !==
        productMetadata.runtimeApiVersion
    )
      throw new Error("Packed plugin lifecycle status check failed.");

    const projects = await agentClient.callTool({
      name: "list_projects",
      arguments: { workspacePath: agentWorkspace },
    });
    if (
      projects.isError ||
      !Array.isArray(projects.structuredContent?.projects)
    )
      throw new Error(
        "Packed plugin could not inspect its explicit workspace.",
      );
  } finally {
    if (agentWorkspace)
      await agentClient.callTool({
        name: "stop_runtime",
        arguments: { workspacePath: agentWorkspace },
      });
    await agentClient.close();
  }
} finally {
  await stopRuntime();
  await rm(temporary, { recursive: true, force: true });
}
