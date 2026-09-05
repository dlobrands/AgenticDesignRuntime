# Runtime operation contract

## Workspace lifecycle

Use `runtime_prerequisites` before installation or compatibility diagnosis. Use `ensure_design_workspace` with an explicit client root and workspace directory to install, start, or reconnect. Use `runtime_status`, `open_studio`, and `stop_runtime` only with the returned absolute workspace path.

Preserve recovery files and the last valid scene. Never bypass workspace locks, path containment, validation, capability authentication, or history-integrity failures. Descriptor disappearance or replacement is authoritative; a PID alone does not prove the runtime is active.

## Trusted updates

Use `update_check` to inspect only the configured signed official release. Use `update_fetch` to verify and stage it without activation. Before `update_apply` or `update_rollback`, finish or cancel design work, export if requested, and stop every ADR runtime.

Never supply a download URL, invoke `git pull`, execute downloaded scripts, install remote plugin content, or bypass origin, signature, provenance, checksum, or compatibility failures. Apply and rollback require a new Codex task or connector restart before further design operations.

## Workspace schema migration

Runtime 2 never edits schema-1 workspaces. Use `inspect_workspace_migration` and `preview_workspace_migration` first, stop every runtime for that workspace, then call `commit_workspace_migration`. The migration stages schema-2 projects, recomputes frame-history hashes, atomically switches the project tree, and retains the complete schema-1 tree. Use `rollback_workspace_migration` only when its stored revision fingerprint proves no schema-2 mutation followed migration.

## Recovery

For stale descriptors, inspect `list_active_workspaces` and the explicit `runtime_status`. For installation, imports, revisions, external edits, rendering, and shutdown failures, preserve the exact error code and read [recovery.md](../../agentic-design/references/recovery.md). Stop when history recovery, incompatible schema, split-brain versions, or failed artifact verification requires owner intervention.
