import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, constants, openSync } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { createServer } from "node:net";

export type RuntimeDescriptor = {
  schemaVersion: 1;
  runtimeId: string;
  workspaceId: string;
  workspacePath: string;
  baseUrl: string;
  pid: number;
  startedAt: string;
  capabilityToken: string;
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const runtimeDescriptorDirectory = (): string =>
  process.env.ADR_DESCRIPTOR_DIRECTORY ??
  path.join(homedir(), ".design-runtime", "runtimes");

const parseDescriptor = async (
  descriptorPath: string,
): Promise<RuntimeDescriptor | undefined> => {
  const info = await stat(descriptorPath).catch(() => undefined);
  if (!info?.isFile() || (info.mode & 0o077) !== 0) return undefined;
  const descriptor = await readFile(descriptorPath, "utf8")
    .then((value) => JSON.parse(value) as RuntimeDescriptor)
    .catch(() => undefined);
  if (
    !descriptor ||
    descriptor.schemaVersion !== 1 ||
    !descriptor.runtimeId ||
    !descriptor.workspaceId ||
    !descriptor.workspacePath ||
    !descriptor.baseUrl ||
    !descriptor.capabilityToken ||
    !Number.isInteger(descriptor.pid) ||
    !processExists(descriptor.pid)
  )
    return undefined;
  return descriptor;
};

export const listActiveDescriptors = async (): Promise<RuntimeDescriptor[]> => {
  const directory = runtimeDescriptorDirectory();
  const descriptors = await Promise.all(
    (await readdir(directory, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => parseDescriptor(path.join(directory, entry.name))),
  );
  return descriptors
    .filter((entry): entry is RuntimeDescriptor => entry !== undefined)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
};

const canonicalWorkspace = async (workspacePath: string): Promise<string> =>
  realpath(workspacePath).catch(() => path.resolve(workspacePath));

export const descriptorForWorkspace = async (
  workspacePath: string,
): Promise<RuntimeDescriptor | undefined> => {
  const requested = await canonicalWorkspace(workspacePath);
  return (await listActiveDescriptors()).find(
    (descriptor) => descriptor.workspacePath === requested,
  );
};

const runtimeHeaders = (descriptor: RuntimeDescriptor): Headers =>
  new Headers({
    authorization: `Bearer ${descriptor.capabilityToken}`,
    "x-design-runtime-id": descriptor.runtimeId,
    "x-design-workspace-id": descriptor.workspaceId,
  });

const runtimeRequest = async <T>(
  descriptor: RuntimeDescriptor,
  route: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await globalThis.fetch(`${descriptor.baseUrl}${route}`, {
    ...init,
    headers: runtimeHeaders(descriptor),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new Error(
      `Runtime request ${route} failed with ${response.status}: ${body}`,
    );
  }
  return response.json() as Promise<T>;
};

export const runtimeStatus = async (
  workspacePath: string,
): Promise<Record<string, unknown>> => {
  const canonical = await canonicalWorkspace(workspacePath);
  const descriptor = await descriptorForWorkspace(canonical);
  if (!descriptor) return { status: "stopped", workspacePath: canonical };
  try {
    return await runtimeRequest<Record<string, unknown>>(
      descriptor,
      "/api/runtime",
    );
  } catch (error) {
    return {
      status: "unreachable",
      workspacePath: canonical,
      runtimeId: descriptor.runtimeId,
      pid: descriptor.pid,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const openRuntimeStudio = async (
  workspacePath: string,
): Promise<{ baseUrl: string }> => {
  const descriptor = await descriptorForWorkspace(workspacePath);
  if (!descriptor) throw new Error("No active runtime matches this workspace.");
  return runtimeRequest(descriptor, "/api/runtime/studio/open", {
    method: "POST",
  });
};

const allocateLoopbackPort = async (): Promise<number> =>
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

const prepareWorkspaceDirectory = async (
  workspacePath: string,
): Promise<string> => {
  const target = path.resolve(workspacePath);
  const existing = await stat(target).catch(() => undefined);
  if (existing && !existing.isDirectory())
    throw new Error("The workspace path exists and is not a directory.");
  if (!existing) {
    const parent = path.dirname(target);
    const parentInfo = await stat(parent).catch(() => undefined);
    if (!parentInfo?.isDirectory())
      throw new Error("The workspace parent directory does not exist.");
    await access(parent, constants.R_OK | constants.W_OK);
    await mkdir(target);
  }
  return realpath(target);
};

const launcherLogPath = async (workspacePath: string): Promise<string> => {
  const directory =
    process.env.ADR_LAUNCHER_LOG_DIRECTORY ??
    path.join(homedir(), ".design-runtime", "launcher-logs");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const key = createHash("sha256")
    .update(workspacePath)
    .digest("hex")
    .slice(0, 16);
  return path.join(directory, `${key}.log`);
};

export const startRuntimeDetached = async (input: {
  workspacePath: string;
  cliPath: string;
  port?: number;
  openStudio?: boolean;
}): Promise<Record<string, unknown>> => {
  const workspacePath = await prepareWorkspaceDirectory(input.workspacePath);
  const existing = await descriptorForWorkspace(workspacePath);
  if (existing) {
    const status = await runtimeStatus(workspacePath);
    if (status.status === "ready") {
      if (input.openStudio) await openRuntimeStudio(workspacePath);
      return { ...status, reused: true };
    }
  }

  const port = input.port ?? (await allocateLoopbackPort());
  const logPath = await launcherLogPath(workspacePath);
  const log = openSync(logPath, "a", 0o600);
  const child = spawn(
    process.execPath,
    [input.cliPath, "dev", workspacePath, "--no-open", "--port", String(port)],
    {
      detached: true,
      env: process.env,
      stdio: ["ignore", log, log],
    },
  );
  child.unref();
  closeSync(log);

  for (let attempt = 0; attempt < 300; attempt += 1) {
    const descriptor = await descriptorForWorkspace(workspacePath);
    if (descriptor && descriptor.pid === child.pid) {
      try {
        const status = await runtimeRequest<Record<string, unknown>>(
          descriptor,
          "/api/runtime",
        );
        if (input.openStudio) await openRuntimeStudio(workspacePath);
        return { ...status, reused: false, logPath };
      } catch {
        // The descriptor is written before the HTTP server is ready.
      }
    }
    if (!child.pid || !processExists(child.pid)) break;
    await wait(100);
  }

  const logTail = await readFile(logPath, "utf8")
    .then((value) => value.slice(-4_000))
    .catch(() => "");
  throw new Error(
    `Runtime did not become ready within 30 seconds.${logTail ? `\n${logTail}` : ""}`,
  );
};

export const stopRuntime = async (
  workspacePath: string,
): Promise<{
  status: "stopped";
  workspacePath: string;
  runtimeId?: string;
}> => {
  const canonical = await canonicalWorkspace(workspacePath);
  const descriptor = await descriptorForWorkspace(canonical);
  if (!descriptor) return { status: "stopped", workspacePath: canonical };
  try {
    await runtimeRequest(descriptor, "/api/runtime/stop", { method: "POST" });
  } catch (error) {
    throw new Error(
      `Runtime ${descriptor.runtimeId} could not be authenticated for shutdown; no process signal was sent. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const active = await descriptorForWorkspace(canonical);
    if (!active || active.runtimeId !== descriptor.runtimeId)
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
