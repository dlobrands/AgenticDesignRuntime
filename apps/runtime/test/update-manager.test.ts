import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  stableStringify,
  unsignedUpdateManifest,
  type TrustedUpdateConfiguration,
  type UpdateManifest,
} from "@tva-agentic-design/core";
import {
  UpdateManager,
  inspectRuntimeArchive,
  runExplicitWorkspaceMigration,
  type UpdateTransport,
} from "../src/update-manager.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const octal = (value: number, length: number): Buffer =>
  Buffer.from(`${value.toString(8).padStart(length - 1, "0")}\0`);

const tar = (
  entries: Array<{
    name: string;
    data?: Buffer | string;
    type?: "0" | "2";
    mode?: number;
  }>,
): Buffer => {
  const output: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data ?? "");
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, "utf8");
    octal(entry.mode ?? 0o644, 8).copy(header, 100);
    octal(0, 8).copy(header, 108);
    octal(0, 8).copy(header, 116);
    octal(data.byteLength, 12).copy(header, 124);
    octal(0, 12).copy(header, 136);
    header.fill(0x20, 148, 156);
    header.write(entry.type ?? "0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, value) => sum + value, 0);
    Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `).copy(
      header,
      148,
    );
    output.push(header, data);
    const padding = (512 - (data.byteLength % 512)) % 512;
    if (padding) output.push(Buffer.alloc(padding));
  }
  output.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(output));
};

const executableBundle = (version = "1.1.0"): Buffer =>
  tar([
    {
      name: "bin/design-runtime",
      mode: 0o755,
      data: `#!/bin/sh\nif [ "$1" = "--version" ]; then echo '${version}'; elif [ "$1" = "health" ]; then echo '{"status":"healthy","renderVerified":true}'; else exit 2; fi\n`,
    },
  ]);

const fixture = async (overrides: Partial<UpdateManifest> = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), "adr-update-test-"));
  roots.push(root);
  const baseline = path.join(root, "baseline");
  await mkdir(baseline);
  await writeFile(path.join(baseline, "design-runtime"), "known-good");
  const archive = executableBundle();
  const artifactHash = `sha256:${createHash("sha256")
    .update(archive)
    .digest("hex")}`;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const configuration: TrustedUpdateConfiguration = {
    schemaVersion: 1,
    officialOrigin: "https://updates.example.test/adr/",
    manifestUrl: "https://updates.example.test/adr/stable/manifest.json",
    channel: "stable",
    publicKeys: {
      release: publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
    },
    requiredPredicateType: "https://slsa.dev/provenance/v1",
    requiredBuilderId:
      "https://github.com/example/adr/.github/workflows/release.yml",
    sourceRepository: "https://github.com/example/adr",
  };
  const unsigned: Omit<UpdateManifest, "signature"> = {
    schemaVersion: 1,
    product: "Agentic Design Runtime",
    releaseId: "release-1",
    sequence: 1,
    channel: "stable",
    version: "1.1.0",
    publishedAt: "2026-08-08T12:00:00.000Z",
    officialOrigin: configuration.officialOrigin,
    platform: process.platform as "darwin",
    architecture: process.arch as "arm64",
    compatibility: {
      runtimeApi: { min: 1, max: 1 },
      workspaceSchema: { min: 1, max: 1 },
      plugin: { min: "0.0.1", max: "0.0.1" },
    },
    artifact: {
      url: "https://updates.example.test/adr/stable/runtime.tgz",
      format: "adr-runtime-bundle-v1",
      sha256: artifactHash,
      sizeBytes: archive.byteLength,
      entrypoint: "bin/design-runtime",
    },
    provenance: {
      predicateType: configuration.requiredPredicateType,
      builderId: configuration.requiredBuilderId,
      sourceRepository: configuration.sourceRepository,
      sourceRevision: "a".repeat(40),
      artifactSha256: artifactHash,
    },
    releaseNotes: "Trusted fixture release.",
    migration: {
      required: false,
      fromWorkspaceSchema: 1,
      toWorkspaceSchema: 1,
      reversible: false,
    },
    ...overrides,
  };
  const signed = (
    input: Omit<UpdateManifest, "signature">,
  ): UpdateManifest => ({
    ...input,
    signature: {
      algorithm: "ed25519",
      keyId: "release",
      value: sign(
        null,
        Buffer.from(stableStringify(input)),
        privateKey,
      ).toString("base64"),
    },
  });
  const manifest = signed(unsigned);
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const sources = new Map([
    [configuration.manifestUrl, manifestBytes],
    [manifest.artifact.url, archive],
  ]);
  const calls: string[] = [];
  const transport: UpdateTransport = {
    async get(url, maximumBytes) {
      calls.push(url);
      const value = sources.get(url);
      if (!value) throw new Error(`Unexpected fixture URL ${url}`);
      if (value.byteLength > maximumBytes) throw new Error("fixture too large");
      return Buffer.from(value);
    },
  };
  const manager = (
    options: ConstructorParameters<typeof UpdateManager>[0] = {},
  ) =>
    new UpdateManager({
      root: path.join(root, "updates"),
      configuration,
      pluginVersion: "0.0.1",
      transport,
      baseline: {
        installPath: baseline,
        entrypoint: "design-runtime",
        invocation: "executable",
      },
      assertNotRunning: async () => undefined,
      ...options,
    });
  return {
    root,
    baseline,
    archive,
    configuration,
    manifest,
    manifestBytes,
    sources,
    calls,
    transport,
    manager,
    signed,
  };
};

describe("trusted runtime updates", () => {
  it("checks read-only, stages without activation, applies atomically, and rolls back", async () => {
    const setup = await fixture();
    const manager = setup.manager();
    await expect(manager.check()).resolves.toMatchObject({
      status: "available",
      version: "1.1.0",
      pluginVersion: "0.0.1",
    });
    expect(
      await stat(path.join(setup.root, "updates")).catch(() => undefined),
    ).toBeUndefined();
    expect(setup.calls).toEqual([setup.configuration.manifestUrl]);

    await expect(manager.fetch()).resolves.toMatchObject({
      status: "staged",
      activated: false,
    });
    expect((await manager.state()).current?.version).toBe("1.0.1");
    expect((await manager.state()).staged?.version).toBe("1.1.0");
    await expect(manager.apply()).resolves.toMatchObject({
      status: "applied",
      version: "1.1.0",
      restartRequired: true,
      pluginContentChanged: false,
    });
    const applied = await manager.state();
    expect(applied.current?.version).toBe("1.1.0");
    expect(applied.previous?.version).toBe("1.0.1");
    expect(applied.staged).toBeUndefined();
    expect(
      await readFile(
        path.join(applied.current!.installPath, "update-manifest.json"),
        "utf8",
      ),
    ).toContain('"releaseId": "release-1"');
    await expect(manager.rollback()).resolves.toMatchObject({
      status: "rolled-back",
      version: "1.0.1",
      restartRequired: true,
    });
    expect((await manager.state()).current?.installPath).toBe(setup.baseline);
  });

  it("rejects an unconfigured or wrong origin and never accepts a generic URL", async () => {
    const setup = await fixture();
    const unconfigured = new UpdateManager({
      root: path.join(setup.root, "unconfigured"),
      configurationPath: path.join(setup.root, "missing.json"),
    });
    await expect(unconfigured.check()).rejects.toMatchObject({
      code: "UPDATE_NOT_CONFIGURED",
    });
    setup.configuration.manifestUrl =
      "https://attacker.example.test/adr/manifest.json";
    await expect(setup.manager().check()).rejects.toMatchObject({
      code: "UPDATE_ORIGIN_REJECTED",
    });
  });

  it("rejects bad signatures, provenance, hashes, platform, API, schema, and replay", async () => {
    const badSignature = await fixture();
    const parsed = JSON.parse(badSignature.manifestBytes.toString("utf8"));
    parsed.signature.value = Buffer.alloc(64, 1).toString("base64");
    badSignature.sources.set(
      badSignature.configuration.manifestUrl,
      Buffer.from(JSON.stringify(parsed)),
    );
    await expect(badSignature.manager().check()).rejects.toMatchObject({
      code: "UPDATE_SIGNATURE_INVALID",
    });

    const badProvenance = await fixture();
    const unsigned = unsignedUpdateManifest(badProvenance.manifest);
    unsigned.provenance.builderId = "https://github.com/attacker/build";
    badProvenance.sources.set(
      badProvenance.configuration.manifestUrl,
      Buffer.from(JSON.stringify(badProvenance.signed(unsigned))),
    );
    await expect(badProvenance.manager().check()).rejects.toMatchObject({
      code: "UPDATE_SIGNATURE_INVALID",
    });

    const tampered = await fixture();
    const tamperedArchive = Buffer.from(tampered.archive);
    tamperedArchive[tamperedArchive.byteLength - 1] =
      tamperedArchive[tamperedArchive.byteLength - 1]! ^ 1;
    tampered.sources.set(tampered.manifest.artifact.url, tamperedArchive);
    await expect(tampered.manager().fetch()).rejects.toMatchObject({
      code: "UPDATE_ARTIFACT_INVALID",
    });

    for (const modify of [
      (manifest: Omit<UpdateManifest, "signature">) => {
        manifest.platform = process.platform === "darwin" ? "linux" : "darwin";
      },
      (manifest: Omit<UpdateManifest, "signature">) => {
        manifest.compatibility.runtimeApi = { min: 2, max: 2 };
      },
      (manifest: Omit<UpdateManifest, "signature">) => {
        manifest.compatibility.workspaceSchema = { min: 2, max: 2 };
      },
    ]) {
      const incompatible = await fixture();
      const candidate = unsignedUpdateManifest(incompatible.manifest);
      modify(candidate);
      incompatible.sources.set(
        incompatible.configuration.manifestUrl,
        Buffer.from(JSON.stringify(incompatible.signed(candidate))),
      );
      await expect(incompatible.manager().check()).rejects.toMatchObject({
        code: "UPDATE_INCOMPATIBLE",
      });
    }

    const replay = await fixture();
    const updateDirectory = path.join(replay.root, "updates");
    await mkdir(updateDirectory, { recursive: true });
    await writeFile(
      path.join(updateDirectory, "state.json"),
      JSON.stringify({
        schemaVersion: 1,
        highestSequence: 1,
        current: {
          version: "1.1.0",
          releaseId: "release-1",
          installPath: path.join(
            updateDirectory,
            "installs",
            "1.1.0-release-1",
          ),
          sequence: 1,
          entrypoint: "design-runtime",
          invocation: "executable",
        },
      }),
    );
    await expect(replay.manager().check()).rejects.toMatchObject({
      code: "UPDATE_REPLAY_REJECTED",
    });
  });

  it("rejects archive traversal and links before staging", async () => {
    for (const archive of [
      tar([{ name: "../escape", data: "x" }]),
      tar([{ name: "bin/design-runtime", type: "2" }]),
    ])
      expect(() => inspectRuntimeArchive(archive)).toThrowError(
        expect.objectContaining({ code: "UPDATE_ARTIFACT_INVALID" }),
      );
  });

  it("preserves the current pointer and cleans interrupted or unhealthy installs", async () => {
    for (const healthCheck of [
      async () => ({ healthy: false, renderVerified: false }),
      async () => {
        throw new Error("interrupted health probe");
      },
    ]) {
      const setup = await fixture();
      const manager = setup.manager({ healthCheck });
      await manager.fetch();
      await expect(manager.apply()).rejects.toBeTruthy();
      expect((await manager.state()).current?.version).toBe("1.0.1");
      const installs = await readdir(
        path.join(setup.root, "updates", "installs"),
      ).catch(() => []);
      expect(installs).toEqual([]);
    }
  });

  it("refuses running-runtime replacement", async () => {
    const setup = await fixture();
    const manager = setup.manager({
      assertNotRunning: async () => {
        throw Object.assign(new Error("running"), { code: "UPDATE_RUNNING" });
      },
    });
    await manager.fetch();
    await expect(manager.apply()).rejects.toMatchObject({
      code: "UPDATE_RUNNING",
    });
  });

  it("backs up explicit reversible migrations and rolls back failed migration", async () => {
    const setup = await fixture();
    const workspace = path.join(setup.root, "workspace");
    await mkdir(workspace);
    await writeFile(path.join(workspace, "design.config.json"), "original");
    const manifest = setup.signed({
      ...unsignedUpdateManifest(setup.manifest),
      migration: {
        required: true,
        fromWorkspaceSchema: 1,
        toWorkspaceSchema: 2,
        reversible: true,
        migratorId: "workspace-v1-v2",
      },
    });
    await expect(
      runExplicitWorkspaceMigration({
        workspacePath: workspace,
        manifest,
        confirm: false,
        migrators: [],
      }),
    ).rejects.toMatchObject({ code: "UPDATE_MIGRATION_REQUIRED" });
    await expect(
      runExplicitWorkspaceMigration({
        workspacePath: workspace,
        manifest,
        confirm: true,
        migrators: [
          {
            id: "workspace-v1-v2",
            from: 1,
            to: 2,
            reversible: true,
            async migrate(target) {
              await writeFile(
                path.join(target, "design.config.json"),
                "changed",
              );
              throw new Error("migration interrupted");
            },
            async rollback(target, backup) {
              await rm(target, { recursive: true, force: true });
              await mkdir(target);
              for (const entry of await readdir(backup))
                await writeFile(
                  path.join(target, entry),
                  await readFile(path.join(backup, entry)),
                );
            },
          },
        ],
      }),
    ).rejects.toThrow("migration interrupted");
    expect(
      await readFile(path.join(workspace, "design.config.json"), "utf8"),
    ).toBe("original");
  });
});
