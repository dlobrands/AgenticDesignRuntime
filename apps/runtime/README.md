# design-runtime

Local HTTP/WebSocket runtime and production Studio server for Agentic Design Runtime.

```bash
design-runtime dev /absolute/path/to/an/existing-empty-directory
```

The process writes an owner-only descriptor under `~/.design-runtime/runtimes`, opens the Studio by default, and keeps a persistent pinned-Chromium export worker warm.

Agent-managed lifecycle commands create the named workspace only when its existing parent is writable, reuse only an exact workspace match, and never expose browser credentials:

```bash
design-runtime start /absolute/client/design-runtime --no-open --port auto
design-runtime status /absolute/client/design-runtime
design-runtime studio /absolute/client/design-runtime
design-runtime stop /absolute/client/design-runtime
```

`studio` asks the owning runtime to issue and consume a one-time browser nonce internally. `stop` performs a graceful shutdown and waits for the descriptor and workspace lock to disappear.

Layer editing commands are preview-first and require the active runtime plus explicit project, frame, revision, and node IDs:

```bash
design-runtime layer compositing /absolute/client/design-runtime --project PROJECT_ID --frame FRAME_ID --base-revision 4 --nodes NODE_ID --blend-mode multiply --opacity 0.8 --fill-opacity 0.6
design-runtime layer arrange /absolute/client/design-runtime --project PROJECT_ID --frame FRAME_ID --base-revision 4 --nodes NODE_A,NODE_B --action align-left --relative-to key --key-node NODE_B
design-runtime preview commit /absolute/client/design-runtime PREVIEW_ID
```

The first two commands only create a canonical preview. Inspect the returned diff, warnings, affected nodes, and render metadata before committing that exact preview ID.

Runtime 2 opens schema-2 workspaces only. Inspect and migrate a stopped schema-1 workspace explicitly; rollback is allowed only before any schema-2 canonical revision changes:

```bash
design-runtime workspace migration preview /absolute/client/design-runtime
design-runtime workspace migration commit /absolute/client/design-runtime
design-runtime workspace migration rollback /absolute/client/design-runtime
```
