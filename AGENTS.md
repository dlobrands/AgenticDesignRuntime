# Agentic Design Runtime repository instructions

## Authority and architecture

ADR has one canonical mutation path: Studio, typed clients, and MCP call the authenticated Fastify runtime, which applies typed scoped transactions through the transaction engine and atomically persists workspace state. Never introduce direct canonical JSON edits, filesystem mutation tools, renderer-authored state, JSON Patch, or a second scene/approval database.

`packages/core` owns side-effect-free schemas, operations, simulation, validation, hashes, diffs, inverses, history reconstruction, layout compilers, and export contracts. Studio and both MCP entrypoints must remain clients of the same runtime behavior. Pixi rendering is shared by Studio and export; canonical validation alone is not visual delivery evidence.

## Change discipline

- Preserve stable IDs, unrelated scene state, locks, protected decisions, exact Brand pins, and revision checks.
- Preview every canonical mutation and commit the exact stored preview unless a dedicated typed route explicitly combines preview/commit with the same invariants.
- Keep workspace, project, and frame operations inside one scope. Do not silently rebase, select newest revisions, or choose workspaces by recency.
- Treat `design-runtime/` and other runtime workspaces as user data. Never stage, rewrite, migrate, delete, or package them through repository tooling.
- Preserve unrelated dirty-tree work. Do not use destructive Git commands.

## Validation

Run from the repository root:

```bash
pnpm verify
pnpm test:e2e
pnpm verify:packed
cd release && shasum -a 256 -c SHA256SUMS
```

Run E2E with native loopback permission when a sandbox reports `listen EPERM`; do not change product code to work around a sandbox restriction. Plugin work must additionally pass every bundled skill validator, source/packed tool-surface parity, installed-cache hash comparison, and a new-task tool/skill smoke test.

## Versions, migrations, and release

Keep product, plugin, design-intelligence, runtime API, and workspace schema versions explicit in `product-metadata.json` and generated artifacts. Schema changes require an explicit, backup-producing, validated migration; incompatible runtimes fail closed rather than rewriting unknown state.

Private source is authoritative and public production is a one-way sanitized promotion. Build focused commits and immutable artifacts. Publishing, pushing, tagging, installing the personal plugin, applying trusted updates, or changing production configuration always requires explicit authorization. For an authorized release, hydrate registry bytes with `pnpm pack:release:published` before final GitHub assets and prove private/public/package/checksum/fresh-install/plugin parity.
