# Recovery rules

- If the bundled runtime or Chromium is absent, call `ensure_design_workspace` and let it install the pinned dependencies. Surface any approval or network failure exactly.
- If a directory is non-empty but uninitialized, stop. Do not delete, relocate, or overwrite its contents.
- If the workspace is already active, reconnect to its matching descriptor. Never break a live lock.
- On `STALE_REVISION`, reload canonical project or frame state, preserve the user's intent, preview against the new revision, and retry once.
- On an external-edit rejection, keep the last valid scene active. Inspect the stored diff and recovery path; revert only when the user asks or the invalid source is clearly disposable.
- On missing assets, fonts, hash mismatches, unsafe SVG, or oversized raster errors, repair the dependency through normal import operations. Never weaken validation.
- On export failure, keep the runtime active, resolve validation or renderer errors, and export again.
- Stop only after final delivery. If graceful shutdown fails, report the runtime ID and log path; do not force-kill unless explicitly authorized.
