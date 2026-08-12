# Trusted ADR updates

ADR updates are an explicit four-step local workflow:

```bash
design-runtime update check
design-runtime update fetch
design-runtime update apply
design-runtime update rollback
```

`check` reads and verifies metadata without writing update state. `fetch` downloads a signed runtime bundle into inactive staging. `apply` is an explicit offline action that refuses while any ADR runtime is active, extracts into a new immutable version directory, runs version/runtime/render health checks, then atomically switches one state pointer. `rollback` explicitly restores the retained known-good pointer. Apply and rollback require restarting the connector or starting a new Codex task; neither replaces a running process in place.

The same actions are exposed through the authenticated runtime API and direct MCP as `update_check`, `update_fetch`, `update_apply`, and `update_rollback`. A running runtime can check or fetch, but apply and rollback deliberately return `UPDATE_RUNNING`. The workspace-aware plugin MCP exposes the same tools without requiring an active design workspace.

## Trust configuration

No production origin or signing identity is committed. The release owner must provision an owner-only JSON file at `~/.design-runtime/update-trust.json` (or `ADR_UPDATE_CONFIG_PATH`) matching `TrustedUpdateConfigurationSchema`:

- exact official HTTPS release origin, including its pinned path prefix;
- exact manifest URL and release channel;
- Ed25519 public key IDs and SPKI DER public keys encoded as base64;
- required SLSA predicate type and exact builder identity;
- official source repository URL.

Commands never accept a URL, git repository, branch, shell fragment, or installer script. Redirects, credentials in URLs, cross-origin paths, unknown signing keys, untrusted builders, and source mismatches are rejected.

Before production activation, Sir Logan must choose:

1. The official GitHub organization/repository and release-origin path.
2. Stable/preview channel policy and monotonic release-sequence authority.
3. Signing custody: an Ed25519 release key or a separately implemented OIDC/Sigstore verifier with an exact identity policy.
4. The protected tag pattern, required reviewers, immutable-release policy, and GitHub Environment approvals.
5. The exact GitHub Actions workflow identity permitted by the provenance verifier.
6. The public license and security contact/response policy.

These are release-configuration blockers only. The local update implementation and fixture-driven verification do not depend on them.

## Manifest and artifact contract

The signed manifest binds product, release ID, monotonic sequence, SemVer, channel, timestamp, exact origin, platform/architecture, runtime API range, workspace schema range, Codex plugin range, release notes, artifact URL/format/size/hash, source revision, builder provenance, and migration requirements. The signature covers the canonical manifest excluding the signature object.

The `adr-runtime-bundle-v1` archive is a gzip-compressed ustar-compatible bundle with `bin/design-runtime`. Extraction accepts regular files and directories only. Absolute paths, traversal, backslashes, duplicate overwrite, symlinks, hard links, devices, PAX/GNU extension records, invalid header checksums, excessive entries, oversized compressed responses, and oversized expansion are rejected. The official builder must materialize dependencies as regular files and avoid archive extensions that weaken the parser contract.

## Compatibility, plugin coordination, and migration

Runtime and Codex plugin versions remain separate. The connector reads the atomic update state, verifies the installed update manifest, and refuses a split-brain runtime whose plugin/API/schema ranges exclude the active connector. Remote update application never installs or executes plugin content. A compatible plugin update remains a separate, explicitly authorized installation in a new task.

Updates never mutate design workspaces. If a signed manifest declares a schema migration, runtime activation refuses with `UPDATE_MIGRATION_REQUIRED`. An explicit reversible migrator must be registered and confirmed separately; it creates a sibling backup before mutation and invokes rollback if migration fails. Incompatible, missing, or irreversible migrators are refused.

## Generic GitHub release scaffolding

`pnpm pack:release` produces checksums plus:

- `sbom.spdx.json`: SPDX 2.3 package inventory;
- `provenance.template.json`: in-toto/SLSA statement with deliberately unbound repository, protected-tag, OIDC builder, and run identity fields;
- `trusted-update-manifest.template.json`: the update contract with unbound origin, artifact, sequence, key, signature, and release approval fields.

The templates are non-active. A future release workflow should run only from protected immutable tags, use least-privilege `contents: write` and `id-token: write` permissions, generate the self-contained runtime bundle, sign/attest after hashing, verify the downloaded release again, and publish only after environment approval. Rollback never rewrites or deletes an immutable GitHub release; it switches the local pointer to retained verified bytes.
