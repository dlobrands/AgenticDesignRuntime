import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { homedir } from "node:os";
import { open, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  AssetManifestSchema,
  DEFAULT_CONFIG,
  DesignConfigSchema,
  FontManifestSchema,
  FrameDocumentSchema,
  HistoryEntrySchema,
  ProjectDocumentSchema,
  RuntimeError,
  reconstructRevision,
  semanticFrameHash,
  validateFrame,
  type RuntimeCapabilities,
} from "@agentic-design/core";
import {
  assertReadableWritableDirectory,
  ensureDirectory,
  readJson,
  readJsonLines,
  resolveInside,
  writeJsonAtomic,
} from "./fs-safe.js";
import type {
  ProjectState,
  RuntimeDescriptor,
  WorkspaceState,
} from "./types.js";

const runtimeDirectories = [
  "transactions",
  "recovery",
  "logs",
  "metrics",
  "cache",
] as const;

const forEachConcurrent = async <T>(
  values: readonly T[],
  concurrency: number,
  work: (value: T) => Promise<void>,
): Promise<void> => {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (index < values.length) {
        const current = values[index++];
        if (current !== undefined) await work(current);
      }
    }),
  );
};

export const sha256File = async (file: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
};

export const resolveRegisteredFile = async (
  project: Pick<ProjectState, "directory">,
  registered: { id: string; path: string; hash: string },
  kind: "asset" | "font" = "asset",
): Promise<string> => {
  let target: string;
  let actual: string;
  try {
    target = await resolveInside(project.directory, registered.path);
    actual = await sha256File(target);
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError(
      kind === "asset" ? "ASSET_HASH_MISMATCH" : "FONT_HASH_MISMATCH",
      `Imported ${kind} ${registered.id} is missing or unreadable.`,
      { [`${kind}Id`]: registered.id, path: registered.path },
    );
  }
  if (actual !== registered.hash)
    throw new RuntimeError(
      kind === "asset" ? "ASSET_HASH_MISMATCH" : "FONT_HASH_MISMATCH",
      `Imported ${kind} ${registered.id} does not match its registered SHA-256 hash.`,
      { [`${kind}Id`]: registered.id, path: registered.path },
    );
  return target;
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const acquireWorkspaceLock = async (
  lockPath: string,
  runtimeId: string,
): Promise<void> => {
  await ensureDirectory(path.dirname(lockPath));
  try {
    const handle = await open(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(
      `${JSON.stringify({ runtimeId, pid: process.pid, startedAt: new Date().toISOString() })}\n`,
    );
    await handle.sync();
    await handle.close();
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const existing = (await readJson(lockPath).catch(() => undefined)) as
    { runtimeId?: string; pid?: number } | undefined;
  if (existing?.pid && processExists(existing.pid)) {
    throw new RuntimeError(
      "WORKSPACE_IN_USE",
      `Workspace is already open by process ${existing.pid}.`,
      {
        pid: existing.pid,
        runtimeId: existing.runtimeId,
      },
      409,
    );
  }
  await rm(lockPath, { force: true });
  return acquireWorkspaceLock(lockPath, runtimeId);
};

const initializeIfEmpty = async (root: string): Promise<void> => {
  const configPath = path.join(root, "design.config.json");
  const exists = await stat(configPath)
    .then(() => true)
    .catch(() => false);
  if (exists) return;
  const entries = await readdir(root);
  if (entries.length > 0) {
    throw new RuntimeError(
      "WORKSPACE_NOT_INITIALIZED",
      "The directory is not empty and does not contain design.config.json.",
      { path: root, entries: entries.slice(0, 20) },
      409,
    );
  }
  await ensureDirectory(path.join(root, "projects"));
  await ensureDirectory(path.join(root, ".design-runtime"));
  for (const directory of runtimeDirectories)
    await ensureDirectory(path.join(root, ".design-runtime", directory));
  await writeJsonAtomic(configPath, DEFAULT_CONFIG(randomUUID()));
};

const loadProject = async (directory: string): Promise<ProjectState> => {
  const document = ProjectDocumentSchema.parse(
    await readJson(path.join(directory, "project.json")),
  );
  const assets = AssetManifestSchema.parse(
    await readJson(path.join(directory, "assets", "assets.json")),
  );
  const fonts = FontManifestSchema.parse(
    await readJson(path.join(directory, "fonts", "fonts.json")),
  );
  const registeredFiles = [
    ...assets.assets.map((asset) => ({ ...asset, kind: "asset" as const })),
    ...fonts.fonts.map((font) => ({ ...font, kind: "font" as const })),
  ];
  await forEachConcurrent(registeredFiles, 4, async (registered) => {
    await resolveRegisteredFile({ directory }, registered, registered.kind);
  });
  const history = await readJsonLines(
    path.join(directory, "history", "operations.jsonl"),
    (input) => HistoryEntrySchema.parse(input),
  );
  const frames = new Map();
  const blockedFrames: ProjectState["blockedFrames"] = new Map();
  for (const reference of document.frames) {
    const frame = FrameDocumentSchema.parse(
      await readJson(await resolveInside(directory, reference.path)),
    );
    const report = validateFrame(frame, {
      assets: assets.assets,
      fonts: fonts.fonts,
    });
    if (!report.valid) {
      blockedFrames.set(frame.id, {
        code: "FRAME_VALIDATION_FAILED",
        message: report.errors.map((issue) => issue.message).join(" "),
      });
    }
    const canonicalHash = await semanticFrameHash(frame);
    try {
      const reconstructed = await reconstructRevision(
        history,
        frame.id,
        frame.revision,
        { assets: assets.assets, fonts: fonts.fonts },
      );
      const reconstructedHash = await semanticFrameHash(reconstructed);
      if (canonicalHash !== reconstructedHash)
        throw new RuntimeError(
          "HISTORY_HASH_MISMATCH",
          "Canonical frame content does not match its revision history.",
          { canonicalHash, reconstructedHash },
        );
    } catch (error) {
      const workspaceRoot = path.resolve(directory, "..", "..");
      const recoveryDirectory = path.join(
        workspaceRoot,
        ".design-runtime",
        "recovery",
      );
      await ensureDirectory(recoveryDirectory);
      const recoveryFile = path.join(
        recoveryDirectory,
        `history-${document.id}-${frame.id}-r${frame.revision}-${canonicalHash.slice(7, 23)}.json`,
      );
      const reason =
        error instanceof Error
          ? error.message
          : "History reconstruction failed.";
      await writeJsonAtomic(recoveryFile, {
        schemaVersion: 1,
        code: "HISTORY_RECOVERY_REQUIRED",
        timestamp: new Date().toISOString(),
        projectId: document.id,
        frameId: frame.id,
        revision: frame.revision,
        reason,
        canonical: frame,
        history: history.filter(
          (entry) => entry.scope === "frame" && entry.frameId === frame.id,
        ),
      });
      blockedFrames.set(frame.id, {
        code: "HISTORY_RECOVERY_REQUIRED",
        message:
          "This frame's saved content does not match its revision history. The canonical file was preserved; recovery is required before editing.",
        recoveryPath: path.relative(workspaceRoot, recoveryFile),
      });
    }
    frames.set(frame.id, frame);
  }
  const framesDirectory = path.join(directory, "frames");
  for (const entry of await readdir(framesDirectory, {
    withFileTypes: true,
  }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const frame = FrameDocumentSchema.parse(
      await readJson(await resolveInside(directory, `frames/${entry.name}`)),
    );
    if (frames.has(frame.id)) continue;
    const report = validateFrame(frame, {
      assets: assets.assets,
      fonts: fonts.fonts,
    });
    if (!report.valid)
      blockedFrames.set(frame.id, {
        code: "FRAME_VALIDATION_FAILED",
        message: report.errors.map((issue) => issue.message).join(" "),
      });
    frames.set(frame.id, frame);
  }
  return {
    directory,
    document,
    frames,
    assets,
    fonts,
    history,
    blockedFrames,
    externalConflicts: new Map(),
  };
};

const provisionalCapabilities = (
  config: ReturnType<typeof DesignConfigSchema.parse>,
): RuntimeCapabilities => {
  const configured = config.rasterLimits;
  return {
    maxTextureSize: configured.maxDimension,
    maxRenderbufferSize: configured.maxDimension,
    maxCanvasDimension: configured.maxDimension,
    effectiveRasterLimits: {
      ...configured,
      maxDecodedMegapixels: Math.min(configured.maxDecodedMegapixels, 64),
      maxDecodedMemoryMb: Math.min(configured.maxDecodedMemoryMb, 512),
    },
  };
};

export const applyRendererCapabilities = (
  workspace: WorkspaceState,
  detected: Pick<
    RuntimeCapabilities,
    "maxTextureSize" | "maxRenderbufferSize" | "maxCanvasDimension"
  >,
): void => {
  const maximum = Math.min(
    detected.maxTextureSize,
    detected.maxRenderbufferSize,
    detected.maxCanvasDimension,
  );
  if (!Number.isInteger(maximum) || maximum < 1)
    throw new RuntimeError(
      "RENDER_CAPABILITY_EXCEEDED",
      "The renderer returned invalid hardware limits.",
      { detected },
    );
  const configured = workspace.config.rasterLimits;
  if (
    configured.maxDimension > maximum &&
    configured.capabilityMode === "strict"
  )
    throw new RuntimeError(
      "RENDER_CAPABILITY_EXCEEDED",
      `Configured raster dimension exceeds the detected ${maximum}px ceiling.`,
      { configured: configured.maxDimension, detected: maximum },
    );
  workspace.capabilities = {
    ...detected,
    maxCanvasDimension: maximum,
    effectiveRasterLimits: {
      ...configured,
      maxDimension: Math.min(configured.maxDimension, maximum),
      maxDecodedMegapixels: Math.min(configured.maxDecodedMegapixels, 64),
      maxDecodedMemoryMb: Math.min(configured.maxDecodedMemoryMb, 512),
    },
  };
  for (const project of workspace.projects.values()) {
    for (const frame of project.frames.values()) {
      const existing = project.blockedFrames.get(frame.id);
      if (existing?.code === "HISTORY_RECOVERY_REQUIRED") continue;
      const report = validateFrame(frame, {
        assets: project.assets.assets,
        fonts: project.fonts.fonts,
        capabilities: workspace.capabilities,
      });
      if (!report.valid)
        project.blockedFrames.set(frame.id, {
          code: "FRAME_VALIDATION_FAILED",
          message: report.errors.map((issue) => issue.message).join(" "),
        });
      else project.blockedFrames.delete(frame.id);
    }
  }
};

export const openWorkspace = async (
  inputPath: string,
  options: {
    port?: number;
    logLevel?: "debug" | "info" | "warn" | "error" | "fatal";
    recover?: (root: string) => Promise<void>;
    descriptorDirectory?: string;
  } = {},
): Promise<WorkspaceState> => {
  const root = await assertReadableWritableDirectory(inputPath);
  await initializeIfEmpty(root);
  const runtimeId = randomUUID();
  const lockPath = path.join(root, ".design-runtime", "runtime.lock");
  await acquireWorkspaceLock(lockPath, runtimeId);

  try {
    for (const directory of runtimeDirectories)
      await ensureDirectory(path.join(root, ".design-runtime", directory));
    if (options.recover) await options.recover(root);
    const rawConfig = DesignConfigSchema.parse(
      await readJson(path.join(root, "design.config.json")),
    );
    const config = {
      ...rawConfig,
      server: {
        ...rawConfig.server,
        ...(options.port ? { port: options.port } : {}),
      },
      logging: {
        ...rawConfig.logging,
        ...(options.logLevel ? { level: options.logLevel } : {}),
      },
    };
    const capabilities = provisionalCapabilities(config);
    const projects = new Map<string, ProjectState>();
    const projectsRoot = path.join(root, "projects");
    await ensureDirectory(projectsRoot);
    for (const entry of await readdir(projectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const project = await loadProject(path.join(projectsRoot, entry.name));
      projects.set(project.document.id, project);
    }

    const capabilityToken = randomBytes(32).toString("base64url");
    const startedAt = new Date().toISOString();
    const descriptorDirectory =
      options.descriptorDirectory ??
      path.join(homedir(), ".design-runtime", "runtimes");
    await ensureDirectory(descriptorDirectory);
    const descriptorPath = path.join(descriptorDirectory, `${runtimeId}.json`);
    const descriptor: RuntimeDescriptor = {
      schemaVersion: 1,
      runtimeId,
      workspaceId: config.workspaceId,
      workspacePath: root,
      baseUrl: `http://${config.server.host}:${config.server.port}`,
      pid: process.pid,
      startedAt,
      capabilityToken,
    };
    await writeJsonAtomic(descriptorPath, descriptor, 0o600);
    const workspace: WorkspaceState = {
      root,
      runtimeId,
      capabilityToken,
      config,
      capabilities,
      projects,
      brandKits: new Map(),
      descriptorPath,
      lockPath,
      startedAt,
    };
    return workspace;
  } catch (error) {
    await rm(lockPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

export const closeWorkspace = async (
  workspace: WorkspaceState,
): Promise<void> => {
  const lock = await readFile(workspace.lockPath, "utf8")
    .then((value) => JSON.parse(value) as { runtimeId?: string })
    .catch(() => undefined);
  if (lock?.runtimeId === workspace.runtimeId)
    await rm(workspace.lockPath, { force: true });
  await rm(workspace.descriptorPath, { force: true });
};

export const requireProject = (
  workspace: WorkspaceState,
  projectId: string,
): ProjectState => {
  const project = workspace.projects.get(projectId);
  if (!project)
    throw new RuntimeError(
      "PROJECT_FILE_INVALID",
      `Project ${projectId} was not found.`,
      { projectId },
      404,
    );
  return project;
};

export const requireFrame = (project: ProjectState, frameId: string) => {
  if (!project.document.frames.some((reference) => reference.id === frameId)) {
    throw new RuntimeError(
      "FRAME_FILE_INVALID",
      `Frame ${frameId} is not active in the project manifest.`,
      { frameId },
      404,
    );
  }
  const frame = project.frames.get(frameId);
  if (!frame)
    throw new RuntimeError(
      "FRAME_FILE_INVALID",
      `Frame ${frameId} was not found.`,
      { frameId },
      404,
    );
  const blocked = project.blockedFrames.get(frameId);
  if (blocked)
    throw new RuntimeError(
      blocked.code,
      blocked.message,
      { frameId, recoveryPath: blocked.recoveryPath },
      409,
    );
  return frame;
};
