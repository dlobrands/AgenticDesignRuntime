import { execFile } from "node:child_process";
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import {
  RuntimeError,
  TrustedUpdateConfigurationSchema,
  UpdateManifestSchema,
  UpdateStateSchema,
  compareSemver,
  sha256,
  stableStringify,
  unsignedUpdateManifest,
  type TrustedUpdateConfiguration,
  type UpdateManifest,
  type UpdateState,
} from "@tva-agentic-design/core";
import {
  ensureDirectory,
  readJson,
  resolveInside,
  writeJsonAtomic,
} from "./fs-safe.js";
import {
  PRODUCT_VERSION,
  PLUGIN_VERSION,
  RUNTIME_API_VERSION,
  WORKSPACE_SCHEMA_VERSION,
} from "./version.js";

const executeFile = promisify(execFile);
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;

export type UpdateTransport = {
  get(url: string, maximumBytes: number): Promise<Buffer>;
};

export type UpdateHealthCheck = (
  installPath: string,
  manifest: UpdateManifest,
) => Promise<{ healthy: boolean; renderVerified: boolean; details?: string }>;

export type SignatureVerifier = (
  manifest: UpdateManifest,
  configuration: TrustedUpdateConfiguration,
) => Promise<void>;

export type UpdateManagerOptions = {
  configuration?: TrustedUpdateConfiguration;
  configurationPath?: string;
  root?: string;
  pluginVersion?: string;
  transport?: UpdateTransport;
  verifySignature?: SignatureVerifier;
  healthCheck?: UpdateHealthCheck;
  assertNotRunning?: () => Promise<void>;
  baseline?: {
    installPath: string;
    entrypoint: string;
    invocation: "node" | "executable";
  };
};

const updateRoot = (): string =>
  process.env.ADR_UPDATE_ROOT ??
  path.join(homedir(), ".design-runtime", "updates");
const updateConfigurationPath = (): string =>
  process.env.ADR_UPDATE_CONFIG_PATH ??
  path.join(homedir(), ".design-runtime", "update-trust.json");

const digest = (value: Buffer): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const assertTrustedUrl = (
  value: string,
  configuration: TrustedUpdateConfiguration,
): void => {
  const requested = new URL(value);
  const official = new URL(configuration.officialOrigin);
  if (
    requested.protocol !== "https:" ||
    requested.origin !== official.origin ||
    !requested.pathname.startsWith(
      official.pathname.endsWith("/")
        ? official.pathname
        : `${official.pathname}/`,
    ) ||
    requested.username ||
    requested.password
  )
    throw new RuntimeError(
      "UPDATE_ORIGIN_REJECTED",
      "Update URL is outside the configured official HTTPS release origin.",
      { url: value },
    );
};

export const httpsUpdateTransport: UpdateTransport = {
  async get(url, maximumBytes) {
    const response = await fetch(url, {
      redirect: "error",
      headers: { accept: "application/octet-stream, application/json" },
    });
    if (!response.ok)
      throw new RuntimeError(
        "UPDATE_ARTIFACT_INVALID",
        `Official update request failed with HTTP ${response.status}.`,
      );
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maximumBytes)
      throw new RuntimeError(
        "UPDATE_ARTIFACT_INVALID",
        "Official update response exceeds its permitted size.",
      );
    if (!response.body)
      throw new RuntimeError(
        "UPDATE_ARTIFACT_INVALID",
        "Official update response did not contain a body.",
      );
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RuntimeError(
          "UPDATE_ARTIFACT_INVALID",
          "Official update response exceeds its permitted size.",
        );
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, received);
  },
};

export const verifyEd25519Manifest: SignatureVerifier = async (
  manifest,
  configuration,
) => {
  const encodedKey = configuration.publicKeys[manifest.signature.keyId];
  if (!encodedKey)
    throw new RuntimeError(
      "UPDATE_SIGNATURE_INVALID",
      "Update manifest uses an untrusted signing key.",
    );
  let valid: boolean;
  try {
    valid = verify(
      null,
      Buffer.from(stableStringify(unsignedUpdateManifest(manifest))),
      createPublicKey({
        key: Buffer.from(encodedKey, "base64"),
        format: "der",
        type: "spki",
      }),
      Buffer.from(manifest.signature.value, "base64"),
    );
  } catch {
    valid = false;
  }
  if (!valid)
    throw new RuntimeError(
      "UPDATE_SIGNATURE_INVALID",
      "Update manifest signature verification failed.",
    );
};

const defaultHealthCheck: UpdateHealthCheck = async (installPath, manifest) => {
  const executable = await resolveInside(
    installPath,
    manifest.artifact.entrypoint,
  );
  await chmod(executable, 0o700);
  try {
    const version = (
      await executeFile(executable, ["--version"], {
        timeout: 15_000,
        encoding: "utf8",
      })
    ).stdout.trim();
    const health = JSON.parse(
      (
        await executeFile(executable, ["health", "--json"], {
          timeout: 60_000,
          encoding: "utf8",
        })
      ).stdout,
    ) as { status?: string; renderVerified?: boolean };
    return {
      healthy: version === manifest.version && health.status === "healthy",
      renderVerified: health.renderVerified === true,
      details: `version=${version}; status=${health.status ?? "missing"}`,
    };
  } catch (error) {
    return {
      healthy: false,
      renderVerified: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const assertNoActiveRuntime = async (): Promise<void> => {
  const directory =
    process.env.ADR_DESCRIPTOR_DIRECTORY ??
    path.join(homedir(), ".design-runtime", "runtimes");
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const descriptor = await readJson(path.join(directory, entry.name)).catch(
      () => undefined,
    );
    const pid =
      descriptor && typeof descriptor === "object" && "pid" in descriptor
        ? Number((descriptor as { pid: unknown }).pid)
        : NaN;
    if (Number.isInteger(pid) && processExists(pid))
      throw new RuntimeError(
        "UPDATE_RUNNING",
        "Stop all ADR runtimes before applying or rolling back an update.",
        undefined,
        409,
      );
  }
};

const tarString = (buffer: Buffer, start: number, length: number): string =>
  buffer
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/s, "");
const tarNumber = (buffer: Buffer, start: number, length: number): number => {
  const value = tarString(buffer, start, length).trim();
  if (!/^[0-7]*$/.test(value)) throw new Error("Invalid tar numeric field.");
  return value ? Number.parseInt(value, 8) : 0;
};

type SafeArchiveEntry = {
  path: string;
  type: "file" | "directory";
  mode: number;
  data: Buffer;
};

export const inspectRuntimeArchive = (archive: Buffer): SafeArchiveEntry[] => {
  let expanded: Buffer;
  try {
    expanded = gunzipSync(archive, { maxOutputLength: MAX_EXTRACTED_BYTES });
  } catch (error) {
    throw new RuntimeError(
      "UPDATE_ARTIFACT_INVALID",
      `Update archive could not be safely decompressed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const entries: SafeArchiveEntry[] = [];
  const paths = new Set<string>();
  let offset = 0;
  let totalBytes = 0;
  while (offset + 512 <= expanded.byteLength) {
    const header = expanded.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const storedChecksum = tarNumber(header, 148, 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const calculatedChecksum = checksumHeader.reduce(
      (sum, value) => sum + value,
      0,
    );
    if (storedChecksum !== calculatedChecksum)
      throw new RuntimeError(
        "UPDATE_ARTIFACT_INVALID",
        "Update archive contains an invalid tar header checksum.",
      );
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const normalized = path.posix.normalize(entryPath);
    if (
      !entryPath ||
      entryPath.includes("\\") ||
      entryPath.startsWith("/") ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      normalized !== entryPath.replace(/\/$/, "")
    )
      throw new RuntimeError(
        "UPDATE_ARTIFACT_INVALID",
        "Update archive contains an unsafe path.",
        { path: entryPath },
      );
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const type =
      typeFlag === "\0" || typeFlag === "0"
        ? "file"
        : typeFlag === "5"
          ? "directory"
          : undefined;
    if (!type)
      throw new RuntimeError(
        "UPDATE_ARTIFACT_INVALID",
        "Update archive links and special entries are not allowed.",
        { path: entryPath, typeFlag },
      );
    if (paths.has(normalized))
      throw new RuntimeError(
        "UPDATE_ARTIFACT_INVALID",
        "Update archive contains a duplicate path.",
        { path: normalized },
      );
    paths.add(normalized);
    const size = tarNumber(header, 124, 12);
    const mode = tarNumber(header, 100, 8);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > expanded.byteLength)
      throw new RuntimeError(
        "UPDATE_ARTIFACT_INVALID",
        "Update archive entry exceeds the archive boundary.",
      );
    totalBytes += size;
    if (
      totalBytes > MAX_EXTRACTED_BYTES ||
      entries.length >= MAX_ARCHIVE_ENTRIES
    )
      throw new RuntimeError(
        "UPDATE_ARTIFACT_INVALID",
        "Update archive exceeds extraction limits.",
      );
    entries.push({
      path: normalized,
      type,
      mode,
      data:
        type === "file"
          ? expanded.subarray(dataStart, dataEnd)
          : Buffer.alloc(0),
    });
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
};

const extractRuntimeArchive = async (
  archive: Buffer,
  target: string,
  entrypoint: string,
): Promise<void> => {
  const entries = inspectRuntimeArchive(archive);
  if (entries.some((entry) => entry.path === "update-manifest.json"))
    throw new RuntimeError(
      "UPDATE_ARTIFACT_INVALID",
      "Update bundle may not supply runtime-owned verification metadata.",
    );
  if (
    !entries.some((entry) => entry.type === "file" && entry.path === entrypoint)
  )
    throw new RuntimeError(
      "UPDATE_ARTIFACT_INVALID",
      "Update bundle is missing its declared runtime entrypoint.",
    );
  await ensureDirectory(target);
  for (const entry of entries) {
    await ensureDirectory(path.join(target, path.dirname(entry.path)));
    const destination = await resolveInside(target, entry.path, false);
    if (entry.type === "directory")
      await mkdir(destination, { recursive: true, mode: 0o700 });
    else {
      await ensureDirectory(path.dirname(destination));
      await writeFile(destination, entry.data, {
        flag: "wx",
        mode:
          entry.path === entrypoint
            ? 0o700
            : entry.mode & 0o111
              ? 0o700
              : 0o600,
      });
    }
  }
};

export class UpdateManager {
  readonly root: string;
  readonly pluginVersion: string;
  readonly #configuration?: TrustedUpdateConfiguration;
  readonly #configurationPath: string;
  readonly #transport: UpdateTransport;
  readonly #verifySignature: SignatureVerifier;
  readonly #healthCheck: UpdateHealthCheck;
  readonly #assertNotRunning: () => Promise<void>;
  readonly #baseline: NonNullable<UpdateManagerOptions["baseline"]>;

  constructor(options: UpdateManagerOptions = {}) {
    this.root = options.root ?? updateRoot();
    this.pluginVersion = options.pluginVersion ?? PLUGIN_VERSION;
    this.#configuration = options.configuration;
    this.#configurationPath =
      options.configurationPath ?? updateConfigurationPath();
    this.#transport = options.transport ?? httpsUpdateTransport;
    this.#verifySignature = options.verifySignature ?? verifyEd25519Manifest;
    this.#healthCheck = options.healthCheck ?? defaultHealthCheck;
    this.#assertNotRunning = options.assertNotRunning ?? assertNoActiveRuntime;
    this.#baseline =
      options.baseline ??
      (() => {
        const packageRoot = path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
        );
        return {
          installPath: packageRoot,
          entrypoint: "dist/cli.js",
          invocation: "node" as const,
        };
      })();
  }

  async configuration(): Promise<TrustedUpdateConfiguration> {
    if (!this.#configuration) {
      const metadata = await stat(this.#configurationPath).catch(
        () => undefined,
      );
      if (metadata && (!metadata.isFile() || (metadata.mode & 0o077) !== 0))
        throw new RuntimeError(
          "UPDATE_NOT_CONFIGURED",
          "Update trust configuration must be a private owner-only file.",
          { configurationPath: this.#configurationPath },
          409,
        );
    }
    const raw =
      this.#configuration ??
      (await readJson(this.#configurationPath).catch(() => undefined));
    if (!raw)
      throw new RuntimeError(
        "UPDATE_NOT_CONFIGURED",
        "Official ADR update origin and signing identity are not configured.",
        { configurationPath: this.#configurationPath },
        409,
      );
    return TrustedUpdateConfigurationSchema.parse(raw);
  }

  async state(): Promise<UpdateState> {
    const raw = await readJson(path.join(this.root, "state.json")).catch(
      () => undefined,
    );
    const state: UpdateState = raw
      ? UpdateStateSchema.parse(raw)
      : {
          schemaVersion: 1,
          highestSequence: 0,
          current: {
            version: PRODUCT_VERSION,
            releaseId: `bundled-${PRODUCT_VERSION}`,
            installPath: this.#baseline.installPath,
            sequence: 0,
            entrypoint: this.#baseline.entrypoint,
            invocation: this.#baseline.invocation,
          },
        };
    for (const pointer of [state.current, state.previous]) {
      if (!pointer) continue;
      const expected =
        pointer.sequence === 0
          ? path.resolve(this.#baseline.installPath)
          : path.resolve(
              this.root,
              "installs",
              `${pointer.version}-${pointer.releaseId}`,
            );
      if (path.resolve(pointer.installPath) !== expected)
        throw new RuntimeError(
          "UPDATE_ARTIFACT_INVALID",
          "Update state contains a runtime pointer outside its immutable install location.",
        );
    }
    return state;
  }

  async #manifest(): Promise<{
    manifest: UpdateManifest;
    manifestBytes: Buffer;
    manifestHash: string;
    configuration: TrustedUpdateConfiguration;
  }> {
    const configuration = await this.configuration();
    assertTrustedUrl(configuration.manifestUrl, configuration);
    const manifestBytes = await this.#transport.get(
      configuration.manifestUrl,
      MAX_MANIFEST_BYTES,
    );
    let manifest: UpdateManifest;
    try {
      manifest = UpdateManifestSchema.parse(
        JSON.parse(manifestBytes.toString("utf8")),
      );
    } catch (error) {
      throw new RuntimeError(
        "UPDATE_MANIFEST_INVALID",
        error instanceof Error ? error.message : String(error),
      );
    }
    this.#assertManifestTrust(manifest, configuration);
    await this.#verifySignature(manifest, configuration);
    return {
      manifest,
      manifestBytes,
      manifestHash: await sha256(stableStringify(manifest)),
      configuration,
    };
  }

  #assertManifestTrust(
    manifest: UpdateManifest,
    configuration: TrustedUpdateConfiguration,
  ): void {
    if (
      manifest.officialOrigin !== configuration.officialOrigin ||
      manifest.channel !== configuration.channel
    )
      throw new RuntimeError(
        "UPDATE_ORIGIN_REJECTED",
        "Update manifest origin or channel does not match trusted configuration.",
      );
    assertTrustedUrl(manifest.artifact.url, configuration);
    if (
      manifest.provenance.predicateType !==
        configuration.requiredPredicateType ||
      manifest.provenance.builderId !== configuration.requiredBuilderId ||
      manifest.provenance.sourceRepository !== configuration.sourceRepository
    )
      throw new RuntimeError(
        "UPDATE_SIGNATURE_INVALID",
        "Update provenance does not match the configured official builder and source.",
      );
  }

  #assertCompatible(manifest: UpdateManifest, state: UpdateState): void {
    const includes = (range: { min: number; max: number }, value: number) =>
      value >= range.min && value <= range.max;
    if (
      manifest.platform !== process.platform ||
      manifest.architecture !== process.arch ||
      !includes(manifest.compatibility.runtimeApi, RUNTIME_API_VERSION) ||
      !includes(
        manifest.compatibility.workspaceSchema,
        WORKSPACE_SCHEMA_VERSION,
      ) ||
      compareSemver(this.pluginVersion, manifest.compatibility.plugin.min) <
        0 ||
      compareSemver(this.pluginVersion, manifest.compatibility.plugin.max) > 0
    )
      throw new RuntimeError(
        "UPDATE_INCOMPATIBLE",
        "Update is incompatible with this platform, runtime API, workspace schema, or plugin version.",
      );
    if (
      manifest.sequence <= state.highestSequence ||
      (state.current &&
        compareSemver(manifest.version, state.current.version) <= 0)
    )
      throw new RuntimeError(
        "UPDATE_REPLAY_REJECTED",
        "Update is a replay, duplicate, or downgrade. Use explicit rollback for a known-good release.",
      );
  }

  async check(): Promise<Record<string, unknown>> {
    const state = await this.state();
    const { manifest, manifestHash } = await this.#manifest();
    this.#assertCompatible(manifest, state);
    return {
      status: "available",
      currentVersion: state.current?.version ?? PRODUCT_VERSION,
      version: manifest.version,
      releaseId: manifest.releaseId,
      sequence: manifest.sequence,
      channel: manifest.channel,
      releaseNotes: manifest.releaseNotes,
      manifestHash,
      pluginVersion: this.pluginVersion,
      restartRequiredAfterApply: true,
    };
  }

  async fetch(): Promise<Record<string, unknown>> {
    const state = await this.state();
    const { manifest, manifestBytes, manifestHash, configuration } =
      await this.#manifest();
    this.#assertCompatible(manifest, state);
    assertTrustedUrl(manifest.artifact.url, configuration);
    const archive = await this.#transport.get(
      manifest.artifact.url,
      Math.min(manifest.artifact.sizeBytes, MAX_ARCHIVE_BYTES),
    );
    if (
      archive.byteLength !== manifest.artifact.sizeBytes ||
      digest(archive) !== manifest.artifact.sha256
    )
      throw new RuntimeError(
        "UPDATE_ARTIFACT_INVALID",
        "Update artifact size or checksum does not match its signed manifest.",
      );
    inspectRuntimeArchive(archive);
    const stagingPath = path.join(this.root, "staging", manifest.releaseId);
    const temporary = `${stagingPath}.tmp-${randomUUID()}`;
    await rm(temporary, { recursive: true, force: true });
    await ensureDirectory(temporary);
    try {
      await writeFile(path.join(temporary, "artifact.tgz"), archive, {
        flag: "wx",
        mode: 0o600,
      });
      await writeFile(path.join(temporary, "manifest.json"), manifestBytes, {
        flag: "wx",
        mode: 0o600,
      });
      await ensureDirectory(path.dirname(stagingPath));
      await rm(stagingPath, { recursive: true, force: true });
      await rename(temporary, stagingPath);
      const next: UpdateState = {
        ...state,
        staged: {
          version: manifest.version,
          releaseId: manifest.releaseId,
          stagingPath,
          sequence: manifest.sequence,
          manifestHash,
        },
      };
      await writeJsonAtomic(path.join(this.root, "state.json"), next);
      return {
        status: "staged",
        version: manifest.version,
        releaseId: manifest.releaseId,
        stagingPath,
        activated: false,
      };
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
  }

  async #readStaged(state: UpdateState): Promise<{
    manifest: UpdateManifest;
    archive: Buffer;
  }> {
    if (!state.staged)
      throw new RuntimeError(
        "UPDATE_ARTIFACT_INVALID",
        "No verified update is staged. Run update fetch first.",
        undefined,
        409,
      );
    const expectedStagingPath = path.join(
      this.root,
      "staging",
      state.staged.releaseId,
    );
    const [recorded, expected] = await Promise.all([
      realpath(state.staged.stagingPath).catch(() => undefined),
      realpath(expectedStagingPath).catch(() => undefined),
    ]);
    if (!recorded || recorded !== expected)
      throw new RuntimeError(
        "UPDATE_ARTIFACT_INVALID",
        "Staged update path is outside the runtime-owned staging area.",
      );
    const manifest = UpdateManifestSchema.parse(
      await readJson(path.join(expectedStagingPath, "manifest.json")),
    );
    const archive = await readFile(
      path.join(expectedStagingPath, "artifact.tgz"),
    );
    if (
      (await sha256(stableStringify(manifest))) !== state.staged.manifestHash ||
      archive.byteLength !== manifest.artifact.sizeBytes ||
      digest(archive) !== manifest.artifact.sha256
    )
      throw new RuntimeError(
        "UPDATE_ARTIFACT_INVALID",
        "Staged update evidence changed after verification.",
      );
    const configuration = await this.configuration();
    this.#assertManifestTrust(manifest, configuration);
    await this.#verifySignature(manifest, configuration);
    this.#assertCompatible(manifest, state);
    return { manifest, archive };
  }

  async apply(): Promise<Record<string, unknown>> {
    await this.#assertNotRunning();
    const state = await this.state();
    const { manifest, archive } = await this.#readStaged(state);
    if (manifest.migration.required)
      throw new RuntimeError(
        "UPDATE_MIGRATION_REQUIRED",
        "This update requires an explicit reversible workspace migration before activation.",
        { migratorId: manifest.migration.migratorId },
        409,
      );
    const installPath = path.join(
      this.root,
      "installs",
      `${manifest.version}-${manifest.releaseId}`,
    );
    const temporary = `${installPath}.installing-${randomUUID()}`;
    await ensureDirectory(path.dirname(installPath));
    for (const entry of await readdir(path.dirname(installPath)).catch(
      () => [],
    ))
      if (entry.startsWith(`${path.basename(installPath)}.installing-`))
        await rm(path.join(path.dirname(installPath), entry), {
          recursive: true,
          force: true,
        });
    await rm(temporary, { recursive: true, force: true });
    try {
      await extractRuntimeArchive(
        archive,
        temporary,
        manifest.artifact.entrypoint,
      );
      await writeJsonAtomic(
        path.join(temporary, "update-manifest.json"),
        manifest,
      );
      const health = await this.#healthCheck(temporary, manifest);
      if (!health.healthy || !health.renderVerified)
        throw new RuntimeError(
          "UPDATE_HEALTH_FAILED",
          "Staged runtime failed its version, runtime, or render health check.",
          { details: health.details },
        );
      await ensureDirectory(path.dirname(installPath));
      if (await stat(installPath).catch(() => undefined))
        throw new RuntimeError(
          "UPDATE_REPLAY_REJECTED",
          "This immutable update install already exists.",
        );
      await rename(temporary, installPath);
      const current = {
        version: manifest.version,
        releaseId: manifest.releaseId,
        installPath,
        sequence: manifest.sequence,
        entrypoint: manifest.artifact.entrypoint,
        invocation: "executable" as const,
        manifestHash: await sha256(stableStringify(manifest)),
      };
      const next: UpdateState = {
        schemaVersion: 1,
        highestSequence: Math.max(state.highestSequence, manifest.sequence),
        ...(state.current ? { previous: state.current } : {}),
        current,
      };
      await writeJsonAtomic(path.join(this.root, "state.json"), next);
      return {
        status: "applied",
        ...current,
        restartRequired: true,
        handoff:
          "Start a new Codex task or restart the agent connector before using this runtime.",
        pluginContentChanged: false,
      };
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
  }

  async rollback(): Promise<Record<string, unknown>> {
    await this.#assertNotRunning();
    const state = await this.state();
    if (!state.previous || !state.current)
      throw new RuntimeError(
        "UPDATE_ROLLBACK_UNAVAILABLE",
        "No retained known-good runtime is available for rollback.",
        undefined,
        409,
      );
    const previousManifestPath = path.join(
      state.previous.installPath,
      "update-manifest.json",
    );
    const fallbackManifest = await readJson(previousManifestPath).catch(
      () => undefined,
    );
    if (fallbackManifest) {
      const manifest = UpdateManifestSchema.parse(fallbackManifest);
      const health = await this.#healthCheck(
        state.previous.installPath,
        manifest,
      );
      if (!health.healthy || !health.renderVerified)
        throw new RuntimeError(
          "UPDATE_HEALTH_FAILED",
          "Retained runtime failed health verification; rollback was not activated.",
        );
    } else if (!(await stat(state.previous.installPath).catch(() => undefined)))
      throw new RuntimeError(
        "UPDATE_ROLLBACK_UNAVAILABLE",
        "Retained known-good runtime directory is missing.",
      );
    const next: UpdateState = {
      schemaVersion: 1,
      highestSequence: state.highestSequence,
      current: state.previous,
      previous: state.current,
    };
    await writeJsonAtomic(path.join(this.root, "state.json"), next);
    return {
      status: "rolled-back",
      ...next.current,
      restartRequired: true,
      handoff:
        "Start a new Codex task or restart the agent connector before using the restored runtime.",
    };
  }
}

export type WorkspaceMigrator = {
  id: string;
  from: number;
  to: number;
  reversible: true;
  migrate(workspacePath: string): Promise<void>;
  rollback(workspacePath: string, backupPath: string): Promise<void>;
};

export const runExplicitWorkspaceMigration = async (input: {
  workspacePath: string;
  manifest: UpdateManifest;
  migrators: readonly WorkspaceMigrator[];
  confirm: boolean;
}): Promise<{ status: "migrated"; backupPath: string; migratorId: string }> => {
  if (!input.confirm)
    throw new RuntimeError(
      "UPDATE_MIGRATION_REQUIRED",
      "Workspace migration requires explicit confirmation.",
      undefined,
      409,
    );
  const migration = input.manifest.migration;
  const migrator = input.migrators.find(
    (candidate) =>
      candidate.id === migration.migratorId &&
      candidate.from === migration.fromWorkspaceSchema &&
      candidate.to === migration.toWorkspaceSchema &&
      candidate.reversible,
  );
  if (!migration.required || !migration.reversible || !migrator)
    throw new RuntimeError(
      "UPDATE_INCOMPATIBLE",
      "No approved reversible migrator matches this update.",
    );
  const workspacePath = await realpath(input.workspacePath);
  const backupPath = `${workspacePath}.pre-update-${Date.now()}-${randomUUID()}`;
  await cp(workspacePath, backupPath, { recursive: true, errorOnExist: true });
  try {
    await migrator.migrate(workspacePath);
    return { status: "migrated", backupPath, migratorId: migrator.id };
  } catch (error) {
    await migrator.rollback(workspacePath, backupPath);
    throw error;
  }
};
