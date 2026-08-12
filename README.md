# Agentic Design Runtime

A local, agent-native visual design runtime for creating and revising editable layered graphics through one canonical transaction engine. Designers use the production Studio, agents use MCP or the typed HTTP client, and every accepted mutation becomes one revision with a stable semantic hash.

This repository ships V1 as `1.0.1`; distribution labels are not part of the product architecture.

The public repository is a source-visible proprietary production mirror. The
license permits personal, non-commercial evaluation; it is not an open-source
license. See [Public production releases](./docs/PUBLIC_RELEASES.md),
[support](./SUPPORT.md), and [security reporting](./SECURITY.md).

Public scene and intent contracts include [optional rich-text spans](./docs/RICH_TEXT_SPANS.md), [bounded native vector paths](./docs/VECTOR_PATHS.md), [ordered non-destructive effect stacks](./docs/EFFECT_STACKS.md), [professional non-destructive crop mode](./docs/PROFESSIONAL_CROP_MODE.md), [persistent layout aids with ephemeral snapping](./docs/LAYOUT_AIDS.md), [marketing frame presets with constrained resizing](./docs/FRAME_PRESETS_AND_RESIZING.md), [professional raster export](./docs/EXPORT_CONTRACT.md), [canonical project templates with semantic slots](./docs/PROJECT_TEMPLATES.md), [bounded non-executable DesignBriefs](./docs/DESIGN_BRIEFS.md), [canonical non-executable DesignPlans](./docs/DESIGN_PLANS.md), the [reviewed DesignPlan intent compiler](./docs/INTENT_COMPILER.md), [read-only deterministic visual QA](./docs/VISUAL_QA.md), [preview-first semantic role tools](./docs/SEMANTIC_ROLE_TOOLS.md), [deterministic DesignPlan layout/reflow](./docs/DESIGN_LAYOUT_SYSTEM.md), [Plan-declared role asset replacement](./docs/ROLE_ASSET_REPLACEMENT.md), [exact pinned-Brand binding](./docs/PLAN_BRAND_BINDINGS.md), [deterministic same-format DesignPlan variants](./docs/DESIGN_VARIANTS.md), [ephemeral canonical proposal review](./docs/PROPOSAL_REVIEW_TOOLS.md), and [live exact-pin palette, typography, effect-style, radius, safe-area spacing, and palette variable-mode bindings](./docs/LIVE_BRAND_BINDINGS.md).

## Architecture

```text
Studio (React + Pixi) ─────────┐
Typed client ──────────────────┼─> Fastify runtime ─> transaction engine ─> atomic workspace files
Direct MCP stdio adapter ──────┤          │                       │
Codex plugin + $agentic-design ┘          └─> Chromium/Pixi export worker
```

- `packages/core`: side-effect-free Zod domain schemas, typed operations, simulation, inverses, validation, hashing, diffs, and history reconstruction.
- `packages/renderer-pixi`: the WebGL-only renderer shared by Studio previews and the persistent export worker.
- `packages/client`: typed HTTP and WebSocket contracts.
- `apps/runtime`: workspace ownership, persistence, recovery, protected API, imports, file watching, diagnostics, and export orchestration.
- `apps/studio`: dense keyboard-accessible precision-instrument UI with separate canonical, local UI, and interaction-draft state.
- `apps/mcp`: thin protocol-compliant stdio adapter; it never edits workspace files directly.
- `plugins/agentic-design-runtime`: private Codex plugin with the `$agentic-design` workflow, workspace-aware MCP server, and its exact compatible runtime package.

The locked public contracts and security boundaries are in [blueprint.md](./blueprint.md).

Canvas preview/export clipping is defined in [Canvas Clipping Contract](./docs/CANVAS_CLIPPING_CONTRACT.md). In V1, `clipContent: false` is a warned, backward-compatible legacy value with the same exact-canvas clipping as `true`; Studio can normalize it through a reversible transaction.

The stable property and operation contract is mapped to direct, read-only, or agent/API-only Studio behavior in [Public Schema and Studio Parity](./docs/PUBLIC_SCHEMA_STUDIO_PARITY.md).

Optional inline typography, deterministic V1 migration, direct range editing, conflict semantics, and renderer/export behavior are defined in [Rich Text Span Contract](./docs/RICH_TEXT_SPANS.md).

Canonical PNG/JPEG/WebP encoding, high-resolution scaling, alpha and JPEG matte behavior, multi-frame preflight, artifact naming, and project-scoped named presets are defined in [Export Contract](./docs/EXPORT_CONTRACT.md).

Bounded native paths, stable point identity, exact compatible SVG conversion, accessible editing, and renderer/export behavior are defined in [Native Vector Path Contract](./docs/VECTOR_PATHS.md).

Canonical project intent, strict brief validation, human visibility, agent-first authoring, and rollback behavior are defined in [Canonical Design Briefs](./docs/DESIGN_BRIEFS.md).

Semantic roles, hierarchy, normalized layout intent, protected decisions, approvals, reference validation, and compiler boundaries are defined in [Canonical Design Plans](./docs/DESIGN_PLANS.md).

Deterministic plan-to-operation translation, selected-role revisions, structured warnings, protected-decision behavior, and the preview-only review boundary are defined in [DesignPlan Intent Compiler](./docs/INTENT_COMPILER.md).

Objective current-frame diagnostics, exact Plan/Brief/Brand-aware checks, and the strict separation from heuristic or model-judged quality assessment are defined in [Deterministic Visual QA](./docs/VISUAL_QA.md).

Stable role-binding inspection, preview-first assignment/detach, approval invalidation, protection handling, and exact project history are defined in [Semantic Role Tools](./docs/SEMANTIC_ROLE_TOOLS.md).

Plan-wide explicit anchors, selected-role reflow, normalized safe areas, position protections, and preview-only canonical operations are defined in [DesignPlan Layout and Reflow](./docs/DESIGN_LAYOUT_SYSTEM.md).

Exact Plan-declared asset application, crop preservation/reset, protection behavior, and stable-ID rollback are defined in [DesignPlan Role Asset Replacement](./docs/ROLE_ASSET_REPLACEMENT.md).

Exact immutable-kit palette/typography resolution, supported binding properties, protection behavior, and preview-only application are defined in [DesignPlan Brand Binding](./docs/PLAN_BRAND_BINDINGS.md).

Same-format preserve/hide/reflow/stretch-resize behavior, format-mismatch no-partial safety, and canonical rollback are defined in [DesignPlan Variants](./docs/DESIGN_VARIANTS.md).

Proposal explanation, rendered review, expiry, trusted provenance, and exact-preview commit semantics are defined in [Proposal Review Tools](./docs/PROPOSAL_REVIEW_TOOLS.md).

Stable node/canvas binding metadata, frame-scoped palette modes, exact immutable palette/type-role/effect-style/radius/spacing resolution, pinned font mapping, direct-edit detach, and pin-change safety are defined in [Live Brand Bindings](./docs/LIVE_BRAND_BINDINGS.md).

## Requirements

- macOS on Apple Silicon
- Node.js 24.18.0 reference release (`engines.node` remains `>=22`)
- pnpm 10.34.5
- Playwright 1.61.1 Chromium

## Source checkout

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
```

Create a directory yourself, then start the runtime:

```bash
mkdir /absolute/path/to/design-workspace
pnpm dev -- /absolute/path/to/design-workspace
```

The first run initializes only an existing, writable, genuinely empty directory. Missing paths and non-empty uninitialized directories fail without modifying their contents. Later runs reopen the initialized workspace.

The runtime binds to loopback, creates an owner-only descriptor, opens Studio through a one-time browser nonce, and removes the descriptor on clean shutdown. Use `--no-open`, `--port <number>`, or `--log-level <level>` when needed.

The equivalent optional overrides are `DESIGN_RUNTIME_WORKSPACE`, `DESIGN_RUNTIME_NO_OPEN`, `DESIGN_RUNTIME_PORT`, and `DESIGN_RUNTIME_LOG_LEVEL`. They never hold runtime secrets.

## Public installation

The supported production target is macOS 14+ on Apple Silicon. Install an exact
GitHub Release with its included checksum-verifying installer, or install the
matching npm packages after verifying the release version:

```bash
node install-macos-release.mjs --release /path/to/extracted-release --target "$HOME/.agentic-design-runtime/current"
node doctor-macos.mjs --target "$HOME/.agentic-design-runtime/current"

pnpm add -g @tva-agentic-design/runtime@1.0.1 @tva-agentic-design/mcp@1.0.1
pnpm exec playwright install chromium
```

The bundled installer stages and validates all binaries before switching the
installation target. A prior install is retained as a timestamped backup.
Workspaces remain separate and are never deleted by installation or uninstall.

Connect an MCP host to the active workspace with:

```bash
pnpm --filter @tva-agentic-design/mcp dev -- --workspace /absolute/path/to/design-workspace
```

## Agent-first Codex workflow

Build and install the exact bundled plugin from a source checkout:

```bash
pnpm pack:release
pnpm plugin:install:personal
```

Start a new Codex task in any client repository and invoke `$agentic-design` with the design brief. The agent will:

1. Install the plugin-pinned `1.0.1` runtime and Chromium when absent.
2. Create or reconnect the visible `<client-root>/design-runtime` workspace.
3. Build through typed preview and commit operations, return PNG drafts in the task, and open the local authenticated Studio after the first draft.
4. Accept human Studio edits as new canonical revisions.
5. Validate and export the approved design, return the final PNG, then stop the runtime.

Studio remains loopback-only. The plugin never creates a public URL, edits canonical workspace JSON directly, selects whichever runtime started most recently, or exposes capability tokens and browser nonces.

The plugin and runtime are released together with explicit product, runtime API, and workspace schema versions. Runtime updates that preserve API/schema compatibility can ship as a new exact plugin bundle; incompatible changes require a compatibility-number increment and coordinated plugin update.

## Versioned Brand Libraries

Brand Kits are workspace-owned immutable revisions. Each revision contains named palette tokens, verified font roles, verified logo assets, provenance and license notes, and bounded reusable component/template definitions. Projects pin an exact kit ID, revision, content hash, and project-local resource map, so later kit revisions never alter existing artwork or rendering implicitly.

Studio exposes only the everyday Brand choices. The typed client and MCP add inspection, creation, exact pin/detach, and palette/type/logo/template application. Pin and apply operations support preview or commit; applying a definition expands it into ordinary validated scene nodes with fresh IDs, not executable or live-linked content.

Existing workspaces remain workspace-schema version 1. The optional project pin field is read without rewriting older project files; Brand Library storage is created under `.design-runtime/brand-kits` only when used. Each library revision owns and re-verifies its bytes and hash chain at startup. Creating a revision backs up the prior index, while detaching a project changes only its pin and leaves existing frame content untouched. Rolling back means pinning a known prior immutable revision explicitly.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:visual
pnpm test:performance
pnpm build
pnpm test:e2e
```

The suites cover operation/inverse invariants, Brand Library version/pin/resource isolation, history, crash recovery, external-edit conversion, path and import security, deterministic gradient mapping, fixture performance, the production Studio workflow, exact-size export, preview/export equality, HTTP capability rotation, direct MCP parity, and the workspace-aware agent plugin lifecycle.

Export a redacted support snapshot without project scenes, assets, fonts, or user copy:

```bash
pnpm --filter @tva-agentic-design/runtime exec tsx src/cli.ts diagnostics export /absolute/path/to/design-workspace
```

## Packed release

Build the versioned macOS Apple Silicon bundle and verify all installed binaries plus the self-contained plugin in an isolated project:

```bash
pnpm pack:release
pnpm verify:packed
cd release && shasum -a 256 -c SHA256SUMS
```

The bundle contains the runtime and MCP packages, self-contained Codex plugin, `$agentic-design` skill, production Studio assets, IBM Plex interface fonts, compatibility metadata, checksums, installation doctor, recoverable installer/uninstaller, and a machine-readable release manifest.

## Trusted updates

ADR implements explicit `update check`, `update fetch`, `update apply`, and `update rollback` CLI/API/MCP workflows. Check is read-only, fetch never activates, apply refuses while ADR is running and health-checks a new immutable install before one atomic pointer switch, and rollback restores the retained known-good runtime. Remote plugin content is never installed or executed by this path.

The official origin and signing identity are intentionally unbound until repository ownership, protected-tag governance, signing custody, OIDC builder identity, license, and security contact are approved. See [Trusted ADR updates](./docs/trusted-updates.md) for the contract, threat model, migration behavior, and exact release-configuration decisions.

## Workspace safety model

- Every mutation is a strict single-scope `TransactionRequest`; batches cannot cross frames.
- Frame history starts with revision zero and appends exactly once per accepted mutation.
- Semantic hashes drive history; full-file hashes suppress only known runtime writes.
- Atomic same-directory writes, journals, fsyncs, and startup recovery protect canonical files.
- Deleted frame files and slugs are retained for undo and recovery.
- Browser imports are multipart bytes. MCP local paths are read once and never persisted.
- Raw `importAsset` and `importFont` manifest operations are internal history vocabulary, not public transaction inputs. Remote callers must use the authenticated asset/font import endpoints; the runtime validates bytes, type, path, and hash again inside the project mutation domain before registering a manifest. This pre-public security hardening does not change runtime API or workspace schema version 1.
- Traversal, symlink escape, unsafe SVG, oversized raster, invalid Host/Origin, and unauthorized capability requests are rejected.
