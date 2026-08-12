# design-runtime-mcp

Thin MCP stdio adapter for an active local Agentic Design Runtime.

```bash
design-runtime-mcp --workspace /absolute/path/to/workspace
```

The adapter reads an owner-only runtime descriptor and forwards only typed inspection, preview, commit, import, validation, and export requests over the protected local HTTP API. `export_frame` and `export_project` support canonical PNG, JPEG, and WebP artifacts with bounded resolution, lossy quality, and JPEG matte settings; batch validation completes before rendering begins.

Brand Library tools list and inspect immutable workspace kits, create a new revision from runtime-verified project assets/fonts, preview or commit an exact project pin, detach without rewriting artwork, and apply concrete palette, type, logo, component, or template changes. Brand definitions are data-only and expand into normal scene operations; they cannot execute code or link a frame to mutable remote state.

Update tools expose signed-official-manifest check, inactive fetch, explicit stopped-runtime apply, and known-good rollback. They never accept arbitrary URLs, run `git pull`, replace an active runtime, or install remote plugin content. Apply and rollback return a clear new-task/connector-restart handoff.

The packaged Codex plugin uses a separate workspace-aware entry point:

```bash
agentic-design-mcp --plugin-root /absolute/path/to/installed/plugin
```

Its tools require an explicit `workspacePath`. It can install the plugin's exact bundled runtime, start or reconnect `<client-root>/design-runtime`, securely open Studio, return PNG previews, wait for human revisions, export, and gracefully stop the runtime. Runtime API and workspace schema compatibility are checked before any design request.
