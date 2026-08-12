import { cpus, homedir, platform, arch, release, totalmem } from "node:os";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { DesignConfigSchema, RuntimeError } from "@agentic-design/core";
import {
  assertReadableWritableDirectory,
  ensureDirectory,
  readJson,
  writeFileAtomic,
  writeJsonAtomic,
} from "./fs-safe.js";
import { readPreferences } from "./preferences.js";
import { PRODUCT_VERSION, REFERENCE_VERSIONS } from "./version.js";
import { recentLogLinesFromDirectory } from "./logger.js";

const activeDescriptorWorkspace = async (): Promise<string | undefined> => {
  const directory = path.join(homedir(), ".design-runtime", "runtimes");
  const descriptors = await Promise.all(
    (await readdir(directory, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const file = path.join(directory, entry.name);
        const value = (await readJson(file).catch(() => undefined)) as
          { workspacePath?: unknown; startedAt?: unknown } | undefined;
        return typeof value?.workspacePath === "string"
          ? {
              workspacePath: value.workspacePath,
              startedAt:
                typeof value.startedAt === "string" ? value.startedAt : "",
            }
          : undefined;
      }),
  );
  return descriptors
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0]
    ?.workspacePath;
};

export const resolveDiagnosticsWorkspace = async (
  explicit?: string,
): Promise<string> => {
  const preferences = await readPreferences();
  const candidate =
    explicit ??
    process.env.DESIGN_RUNTIME_WORKSPACE ??
    (await activeDescriptorWorkspace()) ??
    preferences.lastOpenedWorkspace;
  if (!candidate)
    throw new RuntimeError(
      "WORKSPACE_NOT_FOUND",
      "No workspace was provided and no recent or active workspace was found.",
    );
  return assertReadableWritableDirectory(candidate);
};

export const exportDiagnostics = async (workspacePath: string) => {
  const workspace = await assertReadableWritableDirectory(workspacePath);
  const configPath = path.join(workspace, "design.config.json");
  const config = DesignConfigSchema.parse(await readJson(configPath));
  const generatedAt = new Date().toISOString();
  const directory = path.join(
    workspace,
    ".design-runtime",
    "diagnostics",
    `diagnostics-${generatedAt.replaceAll(":", "-")}`,
  );
  await ensureDirectory(directory);
  const projectsDirectory = path.join(workspace, "projects");
  const projectCount = (
    await readdir(projectsDirectory, { withFileTypes: true }).catch(() => [])
  ).filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith("."),
  ).length;
  const logs = await recentLogLinesFromDirectory(
    path.join(workspace, ".design-runtime", "logs"),
  );
  const metrics = await readJson(
    path.join(workspace, ".design-runtime", "metrics", "current-session.json"),
  ).catch(() => null);

  await Promise.all([
    writeJsonAtomic(path.join(directory, "runtime-summary.json"), {
      schemaVersion: 1,
      generatedAt,
      workspaceId: config.workspaceId,
      projectCount,
      server: config.server,
      rasterLimits: config.rasterLimits,
      logging: config.logging,
    }),
    writeFileAtomic(
      path.join(directory, "recent-logs.jsonl"),
      logs.length > 0 ? `${logs.join("\n")}\n` : "",
    ),
    writeJsonAtomic(path.join(directory, "metrics.json"), metrics),
    writeJsonAtomic(path.join(directory, "package-versions.json"), {
      runtime: PRODUCT_VERSION,
      node: process.version,
      referenceNode: REFERENCE_VERSIONS.node,
      pnpm: REFERENCE_VERSIONS.pnpm,
      pixi: REFERENCE_VERSIONS.pixi,
      fastify: REFERENCE_VERSIONS.fastify,
      playwright: REFERENCE_VERSIONS.playwright,
    }),
    writeJsonAtomic(path.join(directory, "system-profile.json"), {
      platform: platform(),
      release: release(),
      architecture: arch(),
      logicalCpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? "unknown",
      totalMemoryBytes: totalmem(),
    }),
    writeJsonAtomic(path.join(directory, "redaction-report.json"), {
      generatedAt,
      logLinesIncluded: logs.length,
      logFieldsRedactedAtWriteTime: true,
      excluded: [
        "project scenes",
        "assets",
        "fonts",
        "user text content",
        "runtime capability tokens",
        "session cookies",
        "authorization headers",
        "arbitrary filesystem contents",
      ],
    }),
  ]);
  return { directory, generatedAt, logLines: logs.length };
};
