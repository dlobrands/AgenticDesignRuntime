---
name: agentic-design-ops
description: Install, start, reconnect, inspect, update, recover, open, or stop an Agentic Design Runtime workspace. Use for runtime prerequisites, stale descriptors, compatibility failures, Studio launch, trusted updates, or shutdown. Do not use for ordinary artwork creation or design critique.
---

# Agentic Design Operations

Operate one explicit local ADR workspace without exposing capability tokens, browser nonces, descriptors, or user artwork. Only `ensure_design_workspace` may install the plugin-pinned runtime and Chromium. Never use raw localhost URLs, select the most recent workspace implicitly, or edit runtime descriptors and locks.

Read [runtime-operations.md](references/runtime-operations.md) before installation, update, recovery, or shutdown work. For an active workspace, pass the same absolute `workspacePath` to every lifecycle call.

Use `runtime_prerequisites` for read-only compatibility evidence. Use `list_active_workspaces` only to discover safe descriptor metadata; require explicit selection when several workspaces exist. `open_studio` must use the authenticated bootstrap path.

For a schema-1 workspace, call `inspect_workspace_migration` and `preview_workspace_migration` while ADR is stopped. Use `commit_workspace_migration` only after reviewing the exact workspace and backup contract. `rollback_workspace_migration` is allowed only before any schema-2 canonical revision changes; otherwise preserve both versions and restore into a separate workspace.

After update apply, rollback, or personal-plugin reinstall, stop using ADR tools in the current task and tell the user to start a new Codex task. A successful installer or process launch is not readiness evidence until the new task exposes the expected skills and tool surface.
