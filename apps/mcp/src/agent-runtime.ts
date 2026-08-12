import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { DesignRuntimeClient } from "@agentic-design/client";
import {
  UpdateManifestSchema,
  compareSemver,
  sha256,
  stableStringify,
} from "@agentic-design/core";
import {
  PRODUCT_VERSION,
  RUNTIME_API_VERSION,
  WORKSPACE_SCHEMA_VERSION,
} from "./version.js";

const executeFile = promisify(execFile);
export const AGENT_PLUGIN_VERSION = PRODUCT_VERSION;

export type Descriptor = {
  schemaVersion: 1;
  runtimeId: string;
  workspaceId: string;
  workspacePath: string;
  baseUrl: string;
  pid: number;
  startedAt: string;
  capabilityToken: string;
};

type RuntimeInvocation = {
  command: string;
  prefix: string[];
  source: "configured" | "update" | "bundled";
  installPath?: string;
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

const descriptorDirectory = (): string =>
  process.env.ADR_DESCRIPTOR_DIRECTORY ??
  path.join(homedir(), ".design-runtime", "runtimes");

const installRoot = (): string =>
  process.env.ADR_AGENT_INSTALL_ROOT ??
  path.join(
    homedir(),
    ".design-runtime",
    "agent",
    "releases",
    AGENT_PLUGIN_VERSION,
  );

const installedRuntimeBinary = (): string =>
  path.join(installRoot(), "node_modules", ".bin", "design-runtime");

const installedRuntimeArchiveDigest = (): string =>
  path.join(installRoot(), ".runtime-archive.sha256");

const pluginRuntimeArchive = (pluginRoot: string): string =>
  path.join(
    pluginRoot,
    "packages",
    `agentic-design-runtime-${AGENT_PLUGIN_VERSION}.tgz`,
  );

const fileSha256 = async (filePath: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");

const updateRoot = (): string =>
  process.env.ADR_UPDATE_ROOT ??
  path.join(homedir(), ".design-runtime", "updates");

const updatedRuntimeInvocation = async (): Promise<
  RuntimeInvocation | undefined
> => {
  const pointer = await readFile(path.join(updateRoot(), "state.json"), "utf8")
    .then(
      (value) =>
        (
          JSON.parse(value) as {
            current?: {
              installPath?: string;
              entrypoint?: string;
              invocation?: "node" | "executable";
              manifestHash?: string;
            };
          }
        ).current,
    )
    .catch(() => undefined);
  if (
    !pointer?.installPath ||
    !pointer.entrypoint ||
    !pointer.invocation ||
    !pointer.manifestHash
  )
    return undefined;
  const root = await realpath(pointer.installPath).catch(() => undefined);
  if (!root) return undefined;
  const installs = await realpath(path.join(updateRoot(), "installs")).catch(
    () => undefined,
  );
  if (!installs || !root.startsWith(`${installs}${path.sep}`)) return undefined;
  const entrypoint = await realpath(path.join(root, pointer.entrypoint)).catch(
    () => undefined,
  );
  if (!entrypoint || !entrypoint.startsWith(`${root}${path.sep}`))
    return undefined;
  const manifest = UpdateManifestSchema.parse(
    JSON.parse(await readFile(path.join(root, "update-manifest.json"), "utf8")),
  );
  if ((await sha256(stableStringify(manifest))) !== pointer.manifestHash)
    return undefined;
  return pointer.invocation === "node"
    ? {
        command: process.execPath,
        prefix: [entrypoint],
        source: "update",
        installPath: root,
      }
    : {
        command: entrypoint,
        prefix: [],
        source: "update",
        installPath: root,
      };
};

export const bundledRuntimeIntegrity = async (
  pluginRoot: string,
): Promise<{
  archive: string;
  archivePresent: boolean;
  archiveSha256?: string;
  installedArchiveSha256?: string;
  matches: boolean;
}> => {
  const archive = pluginRuntimeArchive(pluginRoot);
  const archivePresent = await stat(archive)
    .then((entry) => entry.isFile())
    .catch(() => false);
  const archiveSha256 = archivePresent ? await fileSha256(archive) : undefined;
  const installedArchiveSha256 = await readFile(
    installedRuntimeArchiveDigest(),
    "utf8",
  )
    .then((value) => value.trim() || undefined)
    .catch(() => undefined);
  return {
    archive,
    archivePresent,
    archiveSha256,
    installedArchiveSha256,
    matches:
      archiveSha256 !== undefined && archiveSha256 === installedArchiveSha256,
  };
};

const runtimeInvocation = async (): Promise<RuntimeInvocation | undefined> => {
  if (process.env.ADR_RUNTIME_CLI_PATH)
    return {
      command: process.execPath,
      prefix: [path.resolve(process.env.ADR_RUNTIME_CLI_PATH)],
      source: "configured",
    };
  if (process.env.ADR_RUNTIME_COMMAND)
    return {
      command: path.resolve(process.env.ADR_RUNTIME_COMMAND),
      prefix: [],
      source: "configured",
    };
  const updated = await updatedRuntimeInvocation();
  if (updated) return updated;
  const binary = installedRuntimeBinary();
  return access(binary, constants.X_OK)
    .then(() => ({ command: binary, prefix: [], source: "bundled" as const }))
    .catch(() => undefined);
};

const codexPluginVersion = async (pluginRoot: string): Promise<string> => {
  const manifest = JSON.parse(
    await readFile(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      "utf8",
    ),
  ) as { version?: string };
  if (!manifest.version) throw new Error("Codex plugin version is missing.");
  return manifest.version;
};

const updatedRuntimeCompatibility = async (
  invocation: RuntimeInvocation,
  pluginRoot: string,
): Promise<{
  compatible: boolean;
  pluginVersion: string;
  runtimeVersion?: string;
}> => {
  const pluginVersion = await codexPluginVersion(pluginRoot);
  if (invocation.source !== "update" || !invocation.installPath)
    return { compatible: false, pluginVersion };
  const manifest = UpdateManifestSchema.parse(
    JSON.parse(
      await readFile(
        path.join(invocation.installPath, "update-manifest.json"),
        "utf8",
      ),
    ),
  );
  return {
    pluginVersion,
    runtimeVersion: manifest.version,
    compatible:
      compareSemver(pluginVersion, manifest.compatibility.plugin.min) >= 0 &&
      compareSemver(pluginVersion, manifest.compatibility.plugin.max) <= 0 &&
      RUNTIME_API_VERSION >= manifest.compatibility.runtimeApi.min &&
      RUNTIME_API_VERSION <= manifest.compatibility.runtimeApi.max &&
      WORKSPACE_SCHEMA_VERSION >= manifest.compatibility.workspaceSchema.min &&
      WORKSPACE_SCHEMA_VERSION <= manifest.compatibility.workspaceSchema.max,
  };
};

const run = async (
  invocation: RuntimeInvocation,
  arguments_: string[],
  options: { cwd?: string; timeout?: number } = {},
): Promise<string> => {
  const result = await executeFile(
    invocation.command,
    [...invocation.prefix, ...arguments_],
    {
      cwd: options.cwd,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: options.timeout ?? 120_000,
    },
  );
  return result.stdout.trim();
};

const parseLastJsonLine = (output: string): Record<string, unknown> => {
  for (const line of output.split("\n").reverse()) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    } catch {
      // Ignore package-manager progress and other non-JSON lines.
    }
  }
  throw new Error(
    `Runtime command did not return JSON.${output ? `\n${output}` : ""}`,
  );
};

export const runtimePrerequisites = async (
  pluginRoot: string,
): Promise<Record<string, unknown>> => {
  const invocation = await runtimeInvocation();
  const integrity = await bundledRuntimeIntegrity(pluginRoot);
  const configuredRuntime = Boolean(
    process.env.ADR_RUNTIME_CLI_PATH || process.env.ADR_RUNTIME_COMMAND,
  );
  const updateCompatibility = invocation
    ? await updatedRuntimeCompatibility(invocation, pluginRoot).catch(() => ({
        compatible: false,
        pluginVersion: "unknown",
        runtimeVersion: undefined,
      }))
    : {
        compatible: false,
        pluginVersion: await codexPluginVersion(pluginRoot),
        runtimeVersion: undefined,
      };
  let runtimeVersion: string | undefined;
  if (
    invocation &&
    (invocation.source !== "update" || updateCompatibility.compatible)
  )
    runtimeVersion = await run(invocation, ["--version"], {
      timeout: 10_000,
    }).catch(() => undefined);
  else if (invocation?.source === "update")
    runtimeVersion = updateCompatibility.runtimeVersion;
  return {
    pluginVersion: updateCompatibility.pluginVersion,
    connectorVersion: AGENT_PLUGIN_VERSION,
    runtimeApiVersion: RUNTIME_API_VERSION,
    workspaceSchemaVersion: WORKSPACE_SCHEMA_VERSION,
    runtimeInstalled:
      (configuredRuntime && Boolean(runtimeVersion)) ||
      (invocation?.source === "update" && updateCompatibility.compatible) ||
      (runtimeVersion === AGENT_PLUGIN_VERSION && integrity.matches),
    runtimeVersion,
    runtimeArchivePresent: integrity.archivePresent,
    runtimeArchiveSha256: integrity.archiveSha256,
    installedRuntimeArchiveSha256: integrity.installedArchiveSha256,
    runtimeArchiveVerified:
      configuredRuntime ||
      integrity.matches ||
      (invocation?.source === "update" && updateCompatibility.compatible),
    updateRuntimeActive: invocation?.source === "update",
    updateRuntimePluginCompatible: updateCompatibility.compatible,
    splitBrain:
      invocation?.source === "update" && !updateCompatibility.compatible,
    runtimeInstallRoot: installRoot(),
    chromium: "verified-and-installed-during-workspace-ensure",
  };
};

export const runRuntimeUpdate = async (
  action: "check" | "fetch" | "apply" | "rollback",
): Promise<Record<string, unknown>> => {
  const invocation = await runtimeInvocation();
  if (!invocation)
    throw new Error(
      "No verified ADR runtime is installed. Install the current bundled runtime before checking for updates.",
    );
  try {
    return parseLastJsonLine(
      await run(invocation, ["update", action], {
        timeout: action === "fetch" || action === "apply" ? 300_000 : 60_000,
      }),
    );
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr: unknown }).stderr)
        : "";
    let updateMessage: string | undefined;
    try {
      const envelope = parseLastJsonLine(stderr) as {
        error?: { code?: string; message?: string };
      };
      if (envelope.error)
        updateMessage = `${envelope.error.code ?? "UPDATE_FAILED"}: ${envelope.error.message ?? "Update command failed."}`;
    } catch {
      // Preserve the original process failure when stderr has no update envelope.
    }
    if (updateMessage) throw new Error(updateMessage, { cause: error });
    throw error;
  }
};

const ensureRuntimeInstalled = async (
  pluginRoot: string,
  installBrowser: boolean,
): Promise<RuntimeInvocation> => {
  let invocation = await runtimeInvocation();
  const configuredRuntime = Boolean(
    process.env.ADR_RUNTIME_CLI_PATH || process.env.ADR_RUNTIME_COMMAND,
  );
  if (invocation?.source === "update") {
    const compatibility = await updatedRuntimeCompatibility(
      invocation,
      pluginRoot,
    );
    if (!compatibility.compatible)
      throw new Error(
        "Updated runtime and installed Codex plugin are incompatible. Roll back the runtime or install a separately verified compatible plugin in a new task.",
      );
  }
  const version = invocation
    ? await run(invocation, ["--version"], { timeout: 10_000 }).catch(
        () => undefined,
      )
    : undefined;
  if (configuredRuntime) {
    if (version !== AGENT_PLUGIN_VERSION)
      throw new Error(
        `Configured runtime returned ${version ?? "no version"}; ${AGENT_PLUGIN_VERSION} is required.`,
      );
  } else if (invocation?.source !== "update") {
    const integrity = await bundledRuntimeIntegrity(pluginRoot);
    if (!integrity.archivePresent || !integrity.archiveSha256)
      throw new Error(
        `The plugin runtime archive is missing at ${integrity.archive}. Rebuild or reinstall the plugin.`,
      );
    if (version !== AGENT_PLUGIN_VERSION || !integrity.matches) {
      await mkdir(installRoot(), { recursive: true, mode: 0o700 });
      const packagePath = path.join(installRoot(), "package.json");
      await writeFile(
        packagePath,
        `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
        { mode: 0o600 },
      );
      await executeFile(
        "pnpm",
        [
          "add",
          "--force",
          "--save-exact",
          "--ignore-workspace",
          integrity.archive,
        ],
        {
          cwd: installRoot(),
          env: process.env,
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
          timeout: 300_000,
        },
      );
      await writeFile(
        installedRuntimeArchiveDigest(),
        `${integrity.archiveSha256}\n`,
        { mode: 0o600 },
      );
      invocation = await runtimeInvocation();
    }
  }
  if (!invocation)
    throw new Error("The bundled runtime installation did not produce a CLI.");

  if (installBrowser && !process.env.ADR_SKIP_BROWSER_INSTALL) {
    const playwright = path.join(
      installRoot(),
      "node_modules",
      ".bin",
      "playwright",
    );
    if (
      await access(playwright, constants.X_OK)
        .then(() => true)
        .catch(() => false)
    )
      await executeFile(playwright, ["install", "chromium"], {
        cwd: installRoot(),
        env: process.env,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 300_000,
      });
  }
  return invocation;
};

const validateWorkspaceDirectoryName = (value: string): void => {
  if (
    !value ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  )
    throw new Error(
      "workspaceDirectory must be one direct child directory name.",
    );
};

export const ensureDesignWorkspace = async (input: {
  pluginRoot: string;
  clientRoot: string;
  workspaceDirectory?: string;
  openStudio?: boolean;
  installBrowser?: boolean;
}): Promise<Record<string, unknown>> => {
  const clientRoot = await realpath(input.clientRoot);
  const clientInfo = await stat(clientRoot);
  if (!clientInfo.isDirectory())
    throw new Error("clientRoot must identify an existing directory.");
  await access(clientRoot, constants.R_OK | constants.W_OK);
  const workspaceDirectory = input.workspaceDirectory ?? "design-runtime";
  validateWorkspaceDirectoryName(workspaceDirectory);
  const workspacePath = path.join(clientRoot, workspaceDirectory);
  const workspaceExisted = await stat(workspacePath)
    .then((entry) => entry.isDirectory())
    .catch(() => false);
  const invocation = await ensureRuntimeInstalled(
    input.pluginRoot,
    input.installBrowser ?? true,
  );
  const output = await run(
    invocation,
    [
      "start",
      workspacePath,
      ...(input.openStudio ? [] : ["--no-open"]),
      "--port",
      "auto",
    ],
    { timeout: 120_000 },
  );
  return {
    ...parseLastJsonLine(output),
    clientRoot,
    workspacePath: await realpath(workspacePath),
    createdWorkspace: !workspaceExisted,
  };
};

export const runRuntimeLifecycle = async (
  workspacePath: string,
  command: "status" | "studio" | "stop",
): Promise<Record<string, unknown>> => {
  const canonical = await realpath(workspacePath);
  let descriptor: Descriptor;
  try {
    descriptor = await descriptorForWorkspace(canonical);
  } catch (error) {
    if (command === "status")
      return { status: "stopped", workspacePath: canonical };
    throw error;
  }

  if (command === "status") {
    const { client } = await clientForWorkspace(canonical);
    return client.getRuntime();
  }
  if (command === "studio") {
    const { client } = await clientForWorkspace(canonical);
    return client.openStudio();
  }

  const { client } = await clientForWorkspace(canonical);
  await client.stopRuntime();
  const descriptorPath = path.join(
    descriptorDirectory(),
    `${descriptor.runtimeId}.json`,
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const descriptorPresent = await stat(descriptorPath)
      .then((entry) => entry.isFile())
      .catch(() => false);
    if (!descriptorPresent)
      return {
        status: "stopped",
        workspacePath: canonical,
        runtimeId: descriptor.runtimeId,
      };
    await wait(100);
  }
  throw new Error(
    `Runtime ${descriptor.runtimeId} did not stop cleanly within 10 seconds.`,
  );
};

export const listActiveWorkspaces = async (): Promise<
  Array<Omit<Descriptor, "capabilityToken">>
> => {
  const directory = descriptorDirectory();
  const descriptors: Array<Omit<Descriptor, "capabilityToken">> = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const descriptorPath = path.join(directory, entry.name);
    const info = await stat(descriptorPath).catch(() => undefined);
    if (!info?.isFile() || (info.mode & 0o077) !== 0) continue;
    const descriptor = await readFile(descriptorPath, "utf8")
      .then((value) => JSON.parse(value) as Descriptor)
      .catch(() => undefined);
    if (
      !descriptor ||
      descriptor.schemaVersion !== 1 ||
      !processExists(descriptor.pid)
    )
      continue;
    descriptors.push({
      schemaVersion: descriptor.schemaVersion,
      runtimeId: descriptor.runtimeId,
      workspaceId: descriptor.workspaceId,
      workspacePath: descriptor.workspacePath,
      baseUrl: descriptor.baseUrl,
      pid: descriptor.pid,
      startedAt: descriptor.startedAt,
    });
  }
  return descriptors.sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
};

const descriptorForWorkspace = async (
  workspacePath: string,
): Promise<Descriptor> => {
  const requested = await realpath(workspacePath);
  const directory = descriptorDirectory();
  const matches: Descriptor[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const descriptorPath = path.join(directory, entry.name);
    const info = await stat(descriptorPath).catch(() => undefined);
    if (!info?.isFile() || (info.mode & 0o077) !== 0) continue;
    const descriptor = await readFile(descriptorPath, "utf8")
      .then((value) => JSON.parse(value) as Descriptor)
      .catch(() => undefined);
    if (
      descriptor &&
      descriptor.schemaVersion === 1 &&
      descriptor.workspacePath === requested &&
      processExists(descriptor.pid)
    )
      matches.push(descriptor);
  }
  matches.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const descriptor = matches[0];
  if (!descriptor)
    throw new Error(
      "No active runtime matches this workspace. Call ensure_design_workspace first.",
    );
  return descriptor;
};

export const clientForWorkspace = async (
  workspacePath: string,
): Promise<{ client: DesignRuntimeClient; descriptor: Descriptor }> => {
  const descriptor = await descriptorForWorkspace(workspacePath);
  const client = new DesignRuntimeClient({
    baseUrl: descriptor.baseUrl,
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    capabilityToken: descriptor.capabilityToken,
    clientType: "mcp",
    clientLabel: "Agent plugin MCP",
  });
  const status = await client.getRuntime();
  if (
    status.compatibility.runtimeApiVersion !== RUNTIME_API_VERSION ||
    status.compatibility.workspaceSchemaVersion !== WORKSPACE_SCHEMA_VERSION
  )
    throw new Error(
      `Runtime compatibility mismatch: API ${status.compatibility.runtimeApiVersion}, workspace ${status.compatibility.workspaceSchemaVersion}.`,
    );
  return { client, descriptor };
};
