import { describe, expect, it } from "vitest";
import { UpdateManifestSchema, compareSemver } from "../src/index.js";

describe("trusted update contracts", () => {
  it("orders stable and prerelease SemVer identifiers correctly", () => {
    expect(compareSemver("1.0.0", "1.0.0-preview.10")).toBeGreaterThan(0);
    expect(
      compareSemver("1.0.0-preview.10", "1.0.0-preview.2"),
    ).toBeGreaterThan(0);
    expect(compareSemver("1.1.0", "1.0.99")).toBeGreaterThan(0);
  });

  it("rejects unsigned migration ambiguity and provenance hash divergence", () => {
    const record = {
      schemaVersion: 1,
      product: "Agentic Design Runtime",
      releaseId: "release-1",
      sequence: 1,
      channel: "stable",
      version: "1.1.0",
      publishedAt: "2026-08-08T12:00:00.000Z",
      officialOrigin: "https://updates.example.test/adr/",
      platform: "darwin",
      architecture: "arm64",
      compatibility: {
        runtimeApi: { min: 1, max: 1 },
        workspaceSchema: { min: 1, max: 1 },
        plugin: { min: "0.0.1", max: "0.0.1" },
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
        artifactSha256: `sha256:${"b".repeat(64)}`,
      },
      signature: {
        algorithm: "ed25519",
        keyId: "release",
        value: "a".repeat(40),
      },
      releaseNotes: "Fixture",
      migration: {
        required: true,
        fromWorkspaceSchema: 1,
        toWorkspaceSchema: 2,
        reversible: false,
      },
    };
    expect(() => UpdateManifestSchema.parse(record)).toThrow();
  });

  it("rejects release identifiers that could escape staging roots", () => {
    const record = {
      schemaVersion: 1,
      product: "Agentic Design Runtime",
      releaseId: "..",
      sequence: 1,
      channel: "stable",
      version: "1.1.0",
      publishedAt: "2026-08-08T12:00:00.000Z",
      officialOrigin: "https://updates.example.test/adr/",
      platform: "darwin",
      architecture: "arm64",
      compatibility: {
        runtimeApi: { min: 1, max: 1 },
        workspaceSchema: { min: 1, max: 1 },
        plugin: { min: "0.0.1", max: "0.0.1" },
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
    expect(() => UpdateManifestSchema.parse(record)).toThrow();
  });
});
