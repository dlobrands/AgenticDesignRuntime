import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(root, "release");
const metadata = JSON.parse(
  await readFile(path.join(root, "product-metadata.json"), "utf8"),
);
const packagePaths = [
  "apps/runtime/package.json",
  "apps/mcp/package.json",
  "apps/studio/package.json",
  "packages/core/package.json",
  "packages/client/package.json",
  "packages/renderer-pixi/package.json",
];
const packages = await Promise.all(
  packagePaths.map(async (relative) => {
    const manifest = JSON.parse(
      await readFile(path.join(root, relative), "utf8"),
    );
    return {
      SPDXID: `SPDXRef-${manifest.name.replace(/[^A-Za-z0-9.-]/g, "-")}`,
      name: manifest.name,
      versionInfo: manifest.version,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      supplier: "NOASSERTION",
    };
  }),
);
const created = new Date().toISOString();
await writeFile(
  path.join(release, "sbom.spdx.json"),
  `${JSON.stringify(
    {
      spdxVersion: "SPDX-2.3",
      dataLicense: "CC0-1.0",
      SPDXID: "SPDXRef-DOCUMENT",
      name: `agentic-design-runtime-${metadata.productVersion}`,
      documentNamespace: `urn:uuid:${randomUUID()}`,
      creationInfo: {
        created,
        creators: ["Tool: Agentic Design Runtime release builder"],
      },
      packages,
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);

const archives = (await readdir(release))
  .filter(
    (name) =>
      name.endsWith(".tgz") && !name.startsWith("agentic-design-runtime-v"),
  )
  .sort();
const subjects = await Promise.all(
  archives.map(async (name) => ({
    name,
    digest: {
      sha256: createHash("sha256")
        .update(await readFile(path.join(release, name)))
        .digest("hex"),
    },
  })),
);
await writeFile(
  path.join(release, "provenance.template.json"),
  `${JSON.stringify(
    {
      _type: "https://in-toto.io/Statement/v1",
      subject: subjects,
      predicateType: "https://slsa.dev/provenance/v1",
      predicate: {
        buildDefinition: {
          buildType: "UNBOUND_OFFICIAL_GITHUB_ACTIONS_BUILD_TYPE",
          externalParameters: {
            sourceRepository: "UNBOUND_OFFICIAL_GITHUB_REPOSITORY",
            sourceRevision: "UNBOUND_PROTECTED_RELEASE_TAG_COMMIT",
          },
          internalParameters: {},
          resolvedDependencies: [],
        },
        runDetails: {
          builder: { id: "UNBOUND_OIDC_VERIFIED_BUILDER_ID" },
          metadata: { invocationId: "UNBOUND_GITHUB_RUN_ID" },
        },
      },
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);

await writeFile(
  path.join(release, "trusted-update-manifest.template.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      product: "Agentic Design Runtime",
      releaseId: "UNBOUND_PROTECTED_RELEASE_ID",
      sequence: "UNBOUND_MONOTONIC_RELEASE_SEQUENCE",
      channel: "stable",
      version: metadata.productVersion,
      publishedAt: "UNBOUND_RELEASE_TIMESTAMP",
      officialOrigin: "UNBOUND_PINNED_HTTPS_RELEASE_ORIGIN",
      platform: "darwin",
      architecture: "arm64",
      compatibility: {
        runtimeApi: {
          min: metadata.runtimeApiVersion,
          max: metadata.runtimeApiVersion,
        },
        workspaceSchema: {
          min: metadata.workspaceSchemaVersion,
          max: metadata.workspaceSchemaVersion,
        },
        plugin: {
          min: metadata.pluginVersion,
          max: metadata.pluginVersion,
        },
      },
      artifact: {
        url: "UNBOUND_PINNED_HTTPS_RUNTIME_BUNDLE_URL",
        format: "adr-runtime-bundle-v1",
        sha256: "UNBOUND_RUNTIME_BUNDLE_SHA256",
        sizeBytes: "UNBOUND_RUNTIME_BUNDLE_SIZE",
        entrypoint: "bin/design-runtime",
      },
      provenance: {
        predicateType: "https://slsa.dev/provenance/v1",
        builderId: "UNBOUND_OIDC_VERIFIED_BUILDER_ID",
        sourceRepository: "UNBOUND_OFFICIAL_GITHUB_REPOSITORY",
        sourceRevision: "UNBOUND_PROTECTED_RELEASE_TAG_COMMIT",
        artifactSha256: "UNBOUND_RUNTIME_BUNDLE_SHA256",
      },
      signature: {
        algorithm: "ed25519",
        keyId: "UNBOUND_RELEASE_SIGNING_KEY_ID",
        value: "UNBOUND_OFFLINE_OR_OIDC_ATTESTED_SIGNATURE",
      },
      releaseNotes: "UNBOUND_APPROVED_RELEASE_NOTES",
      migration: {
        required: false,
        fromWorkspaceSchema: metadata.workspaceSchemaVersion,
        toWorkspaceSchema: metadata.workspaceSchemaVersion,
        reversible: false,
      },
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);

for (const name of [
  "sbom.spdx.json",
  "provenance.template.json",
  "trusted-update-manifest.template.json",
]) {
  if (!(await stat(path.join(release, name))).isFile())
    throw new Error(`Release evidence was not generated: ${name}`);
}

const digest = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const bundleName = `agentic-design-runtime-v${metadata.productVersion}-macos-arm64.tgz`;
const bundleContents = [
  ...archives,
  "release-manifest.json",
  "INSTALL.md",
  "install-personal-plugin.mjs",
  "doctor-macos.mjs",
  "install-macos-release.mjs",
  "uninstall-macos-release.mjs",
  "sbom.spdx.json",
  "provenance.template.json",
  "trusted-update-manifest.template.json",
];
if (
  await Promise.all(
    bundleContents.map((name) =>
      stat(path.join(release, name)).then(
        (entry) => entry.isFile(),
        () => false,
      ),
    ),
  ).then((results) => results.every(Boolean))
) {
  execFileSync(
    "tar",
    ["-czf", path.join(release, bundleName), "-C", release, ...bundleContents],
    { cwd: root, stdio: "inherit" },
  );
  const checksumFiles = [...bundleContents, bundleName];
  const checksums = (
    await Promise.all(
      checksumFiles.map(
        async (name) => `${await digest(path.join(release, name))}  ${name}`,
      ),
    )
  ).join("\n");
  await writeFile(path.join(release, "SHA256SUMS"), `${checksums}\n`, {
    mode: 0o600,
  });
}
