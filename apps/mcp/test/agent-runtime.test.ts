import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256, stableStringify } from "@agentic-design/core";
import {
  AGENT_PLUGIN_VERSION,
  bundledRuntimeIntegrity,
  runtimePrerequisites,
} from "../src/agent-runtime.js";

const roots: string[] = [];
const originalInstallRoot = process.env.ADR_AGENT_INSTALL_ROOT;
const originalUpdateRoot = process.env.ADR_UPDATE_ROOT;

afterEach(async () => {
  if (originalInstallRoot === undefined)
    delete process.env.ADR_AGENT_INSTALL_ROOT;
  else process.env.ADR_AGENT_INSTALL_ROOT = originalInstallRoot;
  if (originalUpdateRoot === undefined) delete process.env.ADR_UPDATE_ROOT;
  else process.env.ADR_UPDATE_ROOT = originalUpdateRoot;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("agent runtime archive integrity", () => {
  it("does not treat a same-version runtime with a different archive hash as current", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-runtime-integrity-"));
    roots.push(root);
    const pluginRoot = path.join(root, "plugin");
    const installRoot = path.join(root, "install");
    await mkdir(path.join(pluginRoot, "packages"), { recursive: true });
    await mkdir(installRoot, { recursive: true });
    await writeFile(
      path.join(
        pluginRoot,
        "packages",
        `agentic-design-runtime-${AGENT_PLUGIN_VERSION}.tgz`,
      ),
      "new verified runtime archive",
    );
    await writeFile(
      path.join(installRoot, ".runtime-archive.sha256"),
      `${"0".repeat(64)}\n`,
    );
    process.env.ADR_AGENT_INSTALL_ROOT = installRoot;

    const stale = await bundledRuntimeIntegrity(pluginRoot);
    expect(stale.matches).toBe(false);
    expect(stale.installedArchiveSha256).toBe("0".repeat(64));

    await writeFile(
      path.join(installRoot, ".runtime-archive.sha256"),
      `${stale.archiveSha256}\n`,
    );
    const current = await bundledRuntimeIntegrity(pluginRoot);
    expect(current.matches).toBe(true);
  });

  it("detects an updated runtime and Codex plugin split-brain", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-runtime-split-"));
    roots.push(root);
    const pluginRoot = path.join(root, "plugin");
    const updateRoot = path.join(root, "updates");
    const installPath = path.join(updateRoot, "installs", "1.1.0-release-1");
    await mkdir(path.join(pluginRoot, "packages"), { recursive: true });
    await mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
    await mkdir(path.join(installPath, "bin"), { recursive: true });
    await writeFile(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ version: "0.0.1" }),
    );
    const executable = path.join(installPath, "bin", "design-runtime");
    await writeFile(executable, "#!/bin/sh\necho '1.1.0'\n");
    await chmod(executable, 0o700);
    const updateManifest = {
      schemaVersion: 1,
      product: "Agentic Design Runtime",
      releaseId: "release-1",
      sequence: 1,
      channel: "stable",
      version: "1.1.0",
      publishedAt: "2026-08-08T12:00:00.000Z",
      officialOrigin: "https://updates.example.test/adr/",
      platform: process.platform,
      architecture: process.arch,
      compatibility: {
        runtimeApi: { min: 1, max: 1 },
        workspaceSchema: { min: 1, max: 1 },
        plugin: { min: "1.0.0", max: "1.0.0" },
      },
      artifact: {
        url: "https://updates.example.test/adr/runtime.tgz",
        format: "adr-runtime-bundle-v1",
        sha256: `sha256:${"a".repeat(64)}`,
        sizeBytes: 1,
        entrypoint: "bin/design-runtime",
      },
      provenance: {
        predicateType: "https://slsa.dev/provenance/v1",
        builderId: "https://github.com/example/adr/release.yml",
        sourceRepository: "https://github.com/example/adr",
        sourceRevision: "a".repeat(40),
        artifactSha256: `sha256:${"a".repeat(64)}`,
      },
      signature: {
        algorithm: "ed25519",
        keyId: "release",
        value: "a".repeat(40),
      },
      releaseNotes: "Fixture",
      migration: {
        required: false,
        fromWorkspaceSchema: 1,
        toWorkspaceSchema: 1,
        reversible: false,
      },
    };
    await writeFile(
      path.join(installPath, "update-manifest.json"),
      JSON.stringify(updateManifest),
    );
    await writeFile(
      path.join(updateRoot, "state.json"),
      JSON.stringify({
        schemaVersion: 1,
        highestSequence: 1,
        current: {
          version: "1.1.0",
          releaseId: "release-1",
          installPath,
          sequence: 1,
          entrypoint: "bin/design-runtime",
          invocation: "executable",
          manifestHash: await sha256(stableStringify(updateManifest)),
        },
      }),
    );
    process.env.ADR_UPDATE_ROOT = updateRoot;
    const status = await runtimePrerequisites(pluginRoot);
    expect(status).toMatchObject({
      pluginVersion: "0.0.1",
      runtimeVersion: "1.1.0",
      updateRuntimeActive: true,
      updateRuntimePluginCompatible: false,
      splitBrain: true,
      runtimeInstalled: false,
    });
  });
});
