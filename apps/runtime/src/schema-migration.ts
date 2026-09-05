import { renameWithRetry as rename } from "../../../scripts/platform.mjs";
import { randomUUID } from "node:crypto";
import { cp, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  AssetManifestSchema,
  DesignConfigSchema,
  FontManifestSchema,
  FrameDocumentSchema,
  HistoryEntrySchema,
  ProjectDocumentSchema,
  RuntimeError,
  semanticFrameHash,
  simulateFrameOperations,
  stableStringify,
  type HistoryEntry,
} from "@tva-agentic-design/core";
import {
  assertReadableWritableDirectory,
  ensureDirectory,
  writeFileAtomic,
  writeJsonAtomic,
} from "./fs-safe.js";

type MigrationFingerprint = {
  projectRevisions: Record<string, number>;
  frameRevisions: Record<string, number>;
};

type MigrationMarker = {
  schemaVersion: 1;
  migrationId: string;
  status: "applying" | "complete" | "rolled-back";
  from: 1;
  to: 2;
  workspacePath: string;
  createdAt: string;
  backupProjectsPath: string;
  backupConfigPath: string;
  fingerprint?: MigrationFingerprint;
};

const json = async (file: string): Promise<unknown> =>
  JSON.parse(await readFile(file, "utf8"));

const projectDirectories = async (projectsRoot: string): Promise<string[]> =>
  (await readdir(projectsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(projectsRoot, entry.name));

const readHistory = async (file: string): Promise<HistoryEntry[]> =>
  (await readFile(file, "utf8"))
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => HistoryEntrySchema.parse(JSON.parse(line)));

const writeHistory = async (
  file: string,
  entries: readonly HistoryEntry[],
): Promise<void> =>
  writeFileAtomic(
    file,
    `${entries.map((entry) => stableStringify(entry).trim()).join("\n")}\n`,
  ).then(() => undefined);

const migrateProject = async (directory: string): Promise<void> => {
  const projectPath = path.join(directory, "project.json");
  const assetsPath = path.join(directory, "assets", "assets.json");
  const fontsPath = path.join(directory, "fonts", "fonts.json");
  const historyPath = path.join(directory, "history", "operations.jsonl");
  const project = ProjectDocumentSchema.parse(await json(projectPath));
  const assets = AssetManifestSchema.parse(await json(assetsPath));
  const fonts = FontManifestSchema.parse(await json(fontsPath));
  const history = await readHistory(historyPath);
  project.schemaVersion = 2;
  assets.schemaVersion = 2;
  fonts.schemaVersion = 2;

  const frameFiles = (
    await readdir(path.join(directory, "frames"), {
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, "frames", entry.name));
  const frames = new Map(
    await Promise.all(
      frameFiles.map(async (file) => {
        const frame = FrameDocumentSchema.parse(await json(file));
        frame.schemaVersion = 2;
        return [frame.id, { file, frame }] as const;
      }),
    ),
  );

  for (const { frame } of frames.values()) {
    const entries = history
      .filter((entry) => entry.scope === "frame" && entry.frameId === frame.id)
      .sort((left, right) => left.revision - right.revision);
    const baseline = entries.find(
      (entry) => entry.kind === "baseline" && entry.revision === 0,
    );
    if (!baseline?.baseline)
      throw new RuntimeError(
        "HISTORY_RECOVERY_REQUIRED",
        `Frame ${frame.id} has no migration-safe baseline.`,
      );
    baseline.baseline.schemaVersion = 2;
    let current = structuredClone(baseline.baseline);
    let currentHash = await semanticFrameHash(current);
    baseline.beforeHash = currentHash;
    baseline.afterHash = currentHash;
    for (const entry of entries.filter((candidate) => candidate.revision > 0)) {
      entry.beforeHash = currentHash;
      current = simulateFrameOperations(current, entry.operations, {
        validation: { assets: assets.assets, fonts: fonts.fonts },
        nextRevision: entry.revision,
        now: entry.timestamp,
      }).frame;
      current.schemaVersion = 2;
      currentHash = await semanticFrameHash(current);
      entry.afterHash = currentHash;
    }
    if ((await semanticFrameHash(frame)) !== currentHash)
      throw new RuntimeError(
        "HISTORY_HASH_MISMATCH",
        `Frame ${frame.id} did not reproduce after schema migration.`,
      );
  }

  await Promise.all([
    writeJsonAtomic(projectPath, project),
    writeJsonAtomic(assetsPath, assets),
    writeJsonAtomic(fontsPath, fonts),
    writeHistory(historyPath, history),
    ...[...frames.values()].map(({ file, frame }) =>
      writeJsonAtomic(file, frame),
    ),
  ]);
};

const fingerprint = async (
  projectsRoot: string,
): Promise<MigrationFingerprint> => {
  const result: MigrationFingerprint = {
    projectRevisions: {},
    frameRevisions: {},
  };
  for (const directory of await projectDirectories(projectsRoot)) {
    const project = ProjectDocumentSchema.parse(
      await json(path.join(directory, "project.json")),
    );
    result.projectRevisions[project.id] = project.revision;
    for (const entry of await readdir(path.join(directory, "frames"), {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const frame = FrameDocumentSchema.parse(
        await json(path.join(directory, "frames", entry.name)),
      );
      result.frameRevisions[frame.id] = frame.revision;
    }
  }
  return result;
};

const equalFingerprint = (
  left: MigrationFingerprint,
  right: MigrationFingerprint,
): boolean => stableStringify(left) === stableStringify(right);

const ensureStopped = async (root: string): Promise<void> => {
  if (
    await stat(path.join(root, ".design-runtime", "runtime.lock"))
      .then(() => true)
      .catch(() => false)
  )
    throw new RuntimeError(
      "WORKSPACE_IN_USE",
      "Stop the ADR runtime before schema migration or rollback.",
    );
};

export const inspectWorkspaceMigration = async (workspacePath: string) => {
  const root = await assertReadableWritableDirectory(workspacePath);
  const config = DesignConfigSchema.parse(
    await json(path.join(root, "design.config.json")),
  );
  const projects = await projectDirectories(path.join(root, "projects"));
  return {
    workspacePath: root,
    currentSchemaVersion: config.schemaVersion,
    targetSchemaVersion: 2,
    migrationRequired: config.schemaVersion === 1,
    projectCount: projects.length,
  };
};

export const commitWorkspaceMigration = async (workspacePath: string) => {
  const inspection = await inspectWorkspaceMigration(workspacePath);
  if (!inspection.migrationRequired)
    return { status: "already-current", ...inspection };
  const root = inspection.workspacePath;
  await ensureStopped(root);
  const migrationId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const migrationRoot = path.join(
    root,
    ".design-runtime",
    "migrations",
    migrationId,
  );
  const stagedProjects = path.join(migrationRoot, "staged-projects");
  const backupProjects = path.join(migrationRoot, "backup-projects");
  const backupConfig = path.join(migrationRoot, "design.config.v1.json");
  await ensureDirectory(migrationRoot);
  await cp(path.join(root, "projects"), stagedProjects, { recursive: true });
  await cp(path.join(root, "design.config.json"), backupConfig);
  for (const directory of await projectDirectories(stagedProjects))
    await migrateProject(directory);
  const marker: MigrationMarker = {
    schemaVersion: 1,
    migrationId,
    status: "applying",
    from: 1,
    to: 2,
    workspacePath: root,
    createdAt: new Date().toISOString(),
    backupProjectsPath: backupProjects,
    backupConfigPath: backupConfig,
  };
  const markerPath = path.join(migrationRoot, "migration.json");
  await writeJsonAtomic(markerPath, marker);
  try {
    await rename(path.join(root, "projects"), backupProjects);
    await rename(stagedProjects, path.join(root, "projects"));
    const config = DesignConfigSchema.parse(
      await json(path.join(root, "design.config.json")),
    );
    config.schemaVersion = 2;
    await writeJsonAtomic(path.join(root, "design.config.json"), config);
    marker.status = "complete";
    marker.fingerprint = await fingerprint(path.join(root, "projects"));
    await writeJsonAtomic(markerPath, marker);
    await writeJsonAtomic(
      path.join(root, ".design-runtime", "migrations", "latest.json"),
      { migrationId, markerPath },
    );
    return { status: "migrated", ...inspection, migrationId, markerPath };
  } catch (error) {
    if (
      await stat(backupProjects)
        .then(() => true)
        .catch(() => false)
    ) {
      await rm(path.join(root, "projects"), { recursive: true, force: true });
      await rename(backupProjects, path.join(root, "projects"));
      await cp(backupConfig, path.join(root, "design.config.json"));
    }
    throw error;
  }
};

export const rollbackWorkspaceMigration = async (workspacePath: string) => {
  const root = await assertReadableWritableDirectory(workspacePath);
  await ensureStopped(root);
  const latest = (await json(
    path.join(root, ".design-runtime", "migrations", "latest.json"),
  )) as { markerPath?: string };
  if (!latest.markerPath)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "No completed workspace migration is available to roll back.",
    );
  const marker = (await json(latest.markerPath)) as MigrationMarker;
  if (marker.status !== "complete" || !marker.fingerprint)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "The latest migration is not rollback-ready.",
    );
  const current = await fingerprint(path.join(root, "projects"));
  if (!equalFingerprint(current, marker.fingerprint))
    throw new RuntimeError(
      "UPDATE_MIGRATION_REQUIRED",
      "Schema-2 canonical revisions changed after migration; restore into a separate workspace instead of overwriting them.",
    );
  const currentProjects = path.join(
    path.dirname(latest.markerPath),
    "pre-rollback-schema2-projects",
  );
  await rename(path.join(root, "projects"), currentProjects);
  await rename(marker.backupProjectsPath, path.join(root, "projects"));
  await cp(marker.backupConfigPath, path.join(root, "design.config.json"));
  marker.status = "rolled-back";
  await writeJsonAtomic(latest.markerPath, marker);
  return {
    status: "rolled-back",
    workspacePath: root,
    migrationId: marker.migrationId,
    retainedSchema2Projects: currentProjects,
  };
};
