# Agentic Design Runtime V1 Blueprint

## Product contract

V1 is a local static-design runtime. A human designer and external agent operate on the same structured frame through typed semantic operations. The Fastify service is canonical; Studio and MCP are clients. No client can patch scene JSON, invoke renderer internals, or write arbitrary files.

Reusable project templates remain canonical project metadata and compile into ordinary stable-ID frame operations. Semantic slots add bounded intent labels to normal nodes; application and detach continue through the same transaction, preview, history, validation, and rendering pipeline. Definitions never update existing instances implicitly.

V1 ships only when the full workflow in the specification passes. V2 features are excluded even when they would simplify a demo.

## Dependency boundaries

```text
apps/studio  -> packages/client, packages/core, packages/renderer-pixi
apps/runtime -> packages/core, packages/renderer-pixi
apps/mcp     -> packages/client, packages/core
packages/client -> packages/core
packages/renderer-pixi -> packages/core
packages/core -> zod only
```

`packages/core` is deterministic and side-effect free. It owns schemas, operations, validation, semantic hashing, scene traversal, diffs, inverse operations, and history reconstruction. Filesystem persistence, clocks, random UUID generation, HTTP, and renderer measurement are injected at application boundaries.

Required non-framework dependencies are limited to:

- `zod` for all loaded and transported documents.
- `chokidar` for external-edit observation.
- `sharp` and `file-type` for bounded raster/SVG metadata and decoding.
- `fontkit` for local font metadata.
- `saxes` for strict SVG XML parsing before allow-list sanitation.
- `@modelcontextprotocol/sdk` for protocol-compliant stdio MCP.
- `fast-check` for generated invariant tests.
- Playwright for the pinned Chromium render/export worker and end-to-end tests.

## Canonical scopes and revisions

Transactions have exactly one scope:

- Workspace scope: project creation only, serialized by the workspace lock.
- Project scope: project metadata, frame lifecycle, asset manifests, and font manifests; bound to `project.revision`.
- Frame scope: canvas and scene operations; bound to `frame.revision`.

A batch cannot cross scopes or frames. Preview and commit use the same simulation path. Preview records expire after five minutes and are never rebased.

Frames start at revision zero with a full baseline in history. Every successful frame commit increments the revision by one, appends one history entry, creates one undo step, and emits one committed event. Failed persistence never increments or broadcasts.

Frame deletion removes its manifest entry while retaining the canonical frame file and reserved slug. This makes deletion reversible without asset or history garbage collection.

## Scene invariants

- `root` is a dedicated identity root, not a mutable `GroupNode`.
- All other nodes have UUID IDs unique across normal children and mask sources.
- Node coordinates are parent-local; stacking is back-to-front.
- Adjustment nodes are root children with identity transforms and explicit stable target IDs. Their visual Layers nesting is derived.
- One adjustment may target a node; target cycles are rejected.
- Mask sources participate in ID, depth, asset, and complexity validation but are not visible artwork.
- Group creation calculates tight world bounds and converts children to local coordinates without changing appearance.
- Text `transform.width/height` and `textBox.width/height` are synchronized. Auto-size changes are normalized by renderer measurement before commit.
- Text content remains canonical plain text. Optional bounded rich spans use complete UTF-16 ranges, paragraph-style fallback, deterministic legacy projection/edit reconciliation, and the same transaction/history/renderer/export path.
- Ordinary nodes may carry optional horizontal and vertical resize constraints. Existing-frame format changes compile to explicit canvas and transform operations in one frame transaction; duplicate-to-format remains one project operation and never mutates its source.
- Node limit is 500; depth limit is 32; 300 nodes produces a warning.

## Operation contract

`SemanticOperation` is a discriminated union. `updateNode` contains one approved property group and its exact payload. No free-form objects are merged.

Asset and font manifest registration operations exist only for canonical history and runtime-internal undo. Public transaction requests containing raw `importAsset` or `importFont` records are rejected. Authenticated import endpoints accept bytes, validate and write them, then recheck the registered path and hash while holding the owning project's mutation domain before committing history.

Inverse operations use the same public vocabulary. Deleting a subtree inverts to `createNode` with the complete validated subtree and its original parent/index. Moving and reordering record original parent/index. Asset replacement records the prior asset ID and fit. Grouping records stable group ID and appearance-preserving transforms.

`duplicateFrame` may include an exact target size and one of the bounded canvas-only, proportional-scale, or constraint strategies. The duplicate is created and baselined atomically at project scope. Per-node constraints use the explicit `updateNode/resizeConstraints` property group; resize transforms remain normal `updateNode/transform` operations so semantic conflicts and history never depend on hidden derived mutation.

The semantic state hash is SHA-256 over stable canonical JSON excluding revision and timestamps. The full file hash includes all serialized fields and is used for watcher self-write suppression.

## Persistence order

```text
validate request
simulate and validate result
acquire scope lock
recheck revision
write and fsync journal
write and fsync same-directory temporary document
atomic rename and fsync containing directory
append and fsync history JSONL
mark and fsync journal complete
update memory and self-write suppression
broadcast committed event
remove journal
```

Recovery is phase-aware and runs before mutations are accepted. If canonical state and history cannot be reconciled by hashes, that frame is blocked with `HISTORY_RECOVERY_REQUIRED` while unaffected frames remain available.

## External edits

Only frame JSON receives semantic external-edit conversion. A file replacement is parsed, validated, compared to the last committed frame, converted to typed operations, and submitted through the normal queue. Stale or unrepresentable edits are copied verbatim to recovery storage, the last committed state remains active, and the affected frame enters explicit conflict state until Revert or a valid replacement.

Runtime writes are suppressed by write ID plus expected full-file hash; timing debounce is never the sole signal.

## Renderer contract

Studio and export use the same WebGL-only PixiJS adapter and render profile. The canonical render is resolution 1 in sRGB with antialiasing enabled and `roundPixels` disabled.

- Pixi native primitives are used only where their semantics match the project format.
- Gradient colors interpolate as premultiplied linear-sRGB with frame/node-seeded deterministic dithering.
- Dashed strokes use canonical path origins and one continuous gradient coordinate space.
- Non-pass-through groups render to isolated textures before group opacity/blend/effects.
- Masks render their source to an alpha/luminance texture and composite explicit children.
- Stable-ID effect stacks support ordered outer/inner shadows, blur, inner/outer glows, and color/gradient overlays. Inner effects and overlays clip to source alpha; generated textures remain node-owned and deterministic.
- Adjustments execute brightness, contrast, saturation, hue, and blur in the specified order.
- Unsupported native blend semantics use pinned custom WebGL filters and never fall back to normal.
- Dissolve noise is derived from frame and node IDs, never time.

The export worker is a persistent pinned Chromium context loading the production renderer bundle. Each canonical preview/export uses an isolated WebGL renderer so filter and texture resources cannot contaminate later frames. Missing or hash-mismatched dependencies, unaccepted fixed-box overflow, invalid scenes, or unflushed Studio edits block export.

Raster export supports PNG, JPEG, and WebP at 0.25×–4× direct renderer resolution. Named settings are canonical project metadata changed through project transactions; encoding remains derived and never mutates artwork. Batch export validates every frame and scaled renderer limit before writing. PNG/WebP preserve canonical alpha eligibility, while JPEG requires an explicit or default matte. The runtime reopens encoded bytes to verify exact dimensions, format, and alpha contract before atomic persistence.

## Security boundaries

The server binds to `127.0.0.1` by default. Each start generates a 256-bit capability token and one-time browser nonce. The nonce is exchanged for an in-memory HttpOnly SameSite=Strict session before redirect to a clean URL. Runtime descriptors are mode `0600` and removed on shutdown.

Every API and WebSocket request validates runtime ID, workspace ID, Host, Origin, and session/capability. Browser uploads use multipart bytes. A local source path is accepted only from a capability-authenticated import request, resolved with real paths, and never persisted. All project references remain project-relative and are rejected on traversal, absolute paths, or symlink escape.

The agent plugin is a versioned client, not a second authority. Every design tool requires an explicit canonical workspace path, reads the matching owner-only descriptor, and checks runtime API version 1 plus workspace schema version 1 before use. It may create only one named direct-child workspace under an existing writable client root. It installs the exact runtime archive bundled with plugin version `1.0.0`; runtime and plugin releases move together, while API or workspace incompatibility requires the corresponding compatibility number to increment.

Agent-triggered Studio opening is requested through the authenticated runtime. The runtime generates and consumes the one-time browser nonce internally; the MCP response contains only the clean loopback base URL. Active-workspace inspection redacts capability tokens. The plugin never publishes Studio, persists import source paths, edits canonical files, or chooses a runtime by recency.

SVG is parsed as XML and accepted only when its source satisfies the strict local-only policy. Scripts, handlers, external URLs, HTML, animation, external use, live text, doctypes, processing instructions, and remote references are rejected; accepted source bytes are preserved. Raster metadata limits are checked before decode, including embedded SVG rasters. A safe SVG with exactly one compatible untransformed `M/L/C/Z` path may additionally place as a bounded canonical `vectorPath`; unsupported safe SVGs remain ordinary preserved asset layers without lossy conversion.

## Studio direction

The Studio is a precision instrument: warm graphite surfaces, hairline structure instead of nested cards, cobalt focus/selection, semantic status colors, compact IBM Plex typography, and a persistent revision ledger. The canvas receives the most space; navigation, layers, properties/history, and diagnostics remain visible or one action away.

Canonical server state, local UI state, and temporary pointer/edit state are separate. Pointer-up or the specified debounce commits one semantic transaction. Canvas-only gestures always have a layer-panel or inspector alternative. All controls use native semantics, visible focus, accessible names, and reduced-motion behavior.

Raster crop mode follows the same separation: drag, arrow-key pan, zoom, reset, and resolution feedback remain local until one explicit Apply transaction. Cancel and Escape create no revision. The canonical normalized crop survives compatible asset replacement and drives the same preview/export raster-fit path.

Guides and safe-area insets are optional canonical canvas metadata with stable identities and normal history/conflict semantics. Ruler/guide dragging is local until one `setCanvas` commit. Snap lines, canvas centers, and equal-gap values are ephemeral Studio overlays; they never enter Pixi pixels or export. Move snapping resolves canvas, guide, visible-object, and equal-spacing targets before one normal transform commit.

## Release gates

- All unit, generated invariant, integration, API, WebSocket, watcher, crash-recovery, and MCP parity suites pass.
- The production runtime passes the complete Playwright Studio suite.
- Renderer regression: <= 0.5% differing pixels, channel tolerance 5, SSIM >= 0.995.
- Preview/export parity: <= 0.1% differing pixels, channel tolerance 3, SSIM >= 0.999.
- The five targeted revisions preserve all unrelated IDs and properties.
- Reopen, 250-revision reconstruction, 500-node boundary, and exact 1080 x 1350 export pass.
- Source, packed CLI, and self-contained Codex plugin installations pass on the reference Apple Silicon Mac.
