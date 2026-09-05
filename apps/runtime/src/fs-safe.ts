import {
  assertWindowsPath,
  assertPortableRelativePath,
  assertLocalWorkspace,
  pathIsInside,
  renameWithRetry,
} from "../../../scripts/platform.mjs";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { RuntimeError, stableStringify } from "@tva-agentic-design/core";

export const ensureDirectory = async (
  directory: string,
  mode = 0o700,
): Promise<void> => {
  if (process.platform === "win32")
    assertWindowsPath(
      path
        .resolve(directory)
        .slice(path.parse(path.resolve(directory)).root.length),
    );
  await mkdir(directory, { recursive: true, mode });
};

export const readJson = async (filePath: string): Promise<unknown> =>
  JSON.parse(await readFile(filePath, "utf8"));

export const syncDirectory = async (directory: string): Promise<void> => {
  // Windows cannot open directories through the Node fs API for fsync.
  // File contents are flushed before rename; journal replay handles interrupted commits.
  if (process.platform === "win32") return;
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export const stageFile = async (
  targetPath: string,
  data: string | Uint8Array,
  temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${randomUUID()}.tmp`,
  ),
  mode = 0o600,
): Promise<string> => {
  if (process.platform === "win32")
    assertWindowsPath(path.basename(targetPath));
  await ensureDirectory(path.dirname(targetPath));
  const handle = await open(
    temporaryPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    mode,
  );
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temporaryPath;
};

export const commitStagedFile = async (
  temporaryPath: string,
  targetPath: string,
): Promise<void> => {
  await renameWithRetry(temporaryPath, targetPath);
  await syncDirectory(path.dirname(targetPath));
};

export const writeFileAtomic = async (
  targetPath: string,
  data: string | Uint8Array,
  options: { mode?: number; keepTemporary?: boolean } = {},
): Promise<{ temporaryPath: string }> => {
  const directory = path.dirname(targetPath);
  await ensureDirectory(directory);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${randomUUID()}.tmp`,
  );
  await stageFile(targetPath, data, temporaryPath, options.mode ?? 0o600).catch(
    async (error) => {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    },
  );
  await commitStagedFile(temporaryPath, targetPath);
  return { temporaryPath };
};

export const writeJsonAtomic = async (
  targetPath: string,
  value: unknown,
  mode = 0o600,
): Promise<void> => {
  await writeFileAtomic(targetPath, stableStringify(value, true), { mode });
};

export const appendJsonLine = async (
  targetPath: string,
  value: unknown,
): Promise<void> => {
  if (process.platform === "win32")
    assertWindowsPath(path.basename(targetPath));
  await ensureDirectory(path.dirname(targetPath));
  const handle = await open(
    targetPath,
    constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY,
    0o600,
  );
  try {
    await handle.write(`${stableStringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export const readJsonLines = async <T>(
  targetPath: string,
  parse: (input: unknown) => T,
): Promise<T[]> => {
  try {
    const contents = await readFile(targetPath, "utf8");
    return contents
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => parse(JSON.parse(line)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

export const assertReadableWritableDirectory = async (
  directory: string,
): Promise<string> => {
  let resolved: string;
  try {
    resolved = await realpath(directory);
    await assertLocalWorkspace(resolved);
    const info = await stat(resolved);
    if (!info.isDirectory()) throw new Error("Not a directory");
    await access(resolved, constants.R_OK | constants.W_OK);
  } catch (error) {
    throw new RuntimeError(
      "WORKSPACE_NOT_FOUND",
      `Workspace ${directory} is unavailable or not writable.`,
      {
        path: directory,
        cause: error instanceof Error ? error.message : String(error),
      },
      404,
    );
  }
  return resolved;
};

export const resolveInside = async (
  root: string,
  relative: string,
  requireExisting = true,
): Promise<string> => {
  try {
    assertPortableRelativePath(relative);
  } catch {
    throw new RuntimeError(
      "PATH_TRAVERSAL_REJECTED",
      "The requested path leaves the workspace.",
      { relative },
    );
  }
  const candidate = path.resolve(root, relative);
  const resolvedRoot = await realpath(root);
  let resolvedCandidate: string;
  if (requireExisting) {
    resolvedCandidate = await realpath(candidate).catch(() => {
      throw new RuntimeError(
        "PATH_OUTSIDE_WORKSPACE",
        "The requested file does not exist inside the workspace.",
        { relative },
      );
    });
  } else {
    const existingParent = await realpath(path.dirname(candidate));
    resolvedCandidate = path.join(existingParent, path.basename(candidate));
  }
  if (!pathIsInside(resolvedRoot, resolvedCandidate)) {
    throw new RuntimeError(
      "PATH_OUTSIDE_WORKSPACE",
      "The requested path escapes the workspace.",
      { relative },
    );
  }
  return resolvedCandidate;
};

export const safeRemoveFile = async (targetPath: string): Promise<void> => {
  await rm(targetPath, { force: true });
};
