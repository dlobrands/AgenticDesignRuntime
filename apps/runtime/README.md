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
