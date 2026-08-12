# Changelog

This project follows semantic versioning. Release entries describe user-visible behavior and migration requirements; unreleased work remains under `Unreleased` until a release is approved.

## Unreleased

### Added

- Canonical project-wide mutation serialization, verified import receipts, exact journal recovery, and startup history integrity checks.
- Real-time Studio color, movement, scaling, and rotation gestures with one canonical transaction on release, cancellation on Escape, and drag-marquee multi-selection.
- Immutable workspace Brand Kit revisions with deterministic project pinning, verified palette/type/logo resources, bounded reusable components/templates, Studio controls, and typed HTTP/MCP workflows.
- Trusted runtime update check/fetch/apply/rollback with signed pinned-origin manifests, inactive verified staging, atomic version switching, health-gated activation, known-good rollback, split-brain detection, reversible migration contracts, SBOM, and provenance scaffolding.
- Accessible direct on-canvas text editing with one canonical revision, fixed/auto-size feedback, and reviewed peer rebase/conflict behavior.
- Optional bounded rich-text spans with deterministic V1 compatibility, range formatting, stable span identities, shared Pixi measurement/rendering, and exact preview/export parity.
- Bounded canonical vector paths with stable command IDs, accessible point editing, exact compatible SVG-path conversion, shared paint/stroke semantics, and preview/export parity.
- Ordered stable-ID non-destructive effect stacks with shadows, blur, glows, color/gradient overlays, full Studio editing, and reversible legacy single-shadow migration.
- Professional on-canvas raster crop mode with local pan/zoom drafts, keyboard control, cancel-without-mutation, one-revision apply, resolution warnings, and preserved normalized focus on asset replacement.
- Persistent stable-ID frame guides and safe-area insets, draggable/keyboard-accessible rulers and guide controls, canvas/object/guide snapping, equal-gap feedback, and metadata-free render/export overlays.
- Exact static-marketing frame presets, optional per-layer resize constraints, one-revision canvas/reflow resizing, and one-operation duplicate-to-format variations.
- Canonical project-scoped export presets plus validated PNG, JPEG, and WebP single/multi-frame export with direct 0.25×–4× rendering, explicit alpha/JPEG matte semantics, collision-safe artifact names, typed HTTP/client/MCP parity, and Studio management.
- Canonical project templates with bounded semantic slots, stable-ID ordinary-node application, exact metadata-only detach, project history/inverses, typed HTTP/client/MCP parity, and accessible Studio capture and management.
- Canonical non-executable project DesignBriefs with bounded objective, audience, format, copy, brand, asset, hierarchy, mood, constraint, accessibility, and export intent; exact project history/rollback; typed HTTP/client/MCP parity; and complete read-only Studio inspection.
- Canonical non-executable DesignPlans with stable semantic roles, hierarchy, normalized layout regions and safe areas, constraints, brand/asset/effect intent, variant rules, protected human decisions, approvals, exact reference validation/history, typed HTTP/client/MCP parity, and full read-only Studio inspection.
- A preview-only DesignPlan intent compiler that translates selected actionable roles into ordinary stable-ID frame operations, preserves protected human decisions, exposes structured warnings in Studio/MCP/typed clients, and commits only through the existing canonical preview contract.
- Read-only deterministic visual QA with exact frame, Plan, Brief, and pinned-Brand findings; typed HTTP/client/MCP/Studio parity; and explicit separation from unevaluated heuristic and model-judged checks.
- High-level semantic role inspection and preview-first assignment/detach with stable IDs, binding-health diagnostics, protected-decision enforcement, approval invalidation, typed HTTP/client/MCP/Studio parity, and exact project history/rollback.
- Preview-only DesignPlan layout-system and selected-role reflow tools that compile explicit normalized anchors and the supported global safe area into ordinary protected stable-ID frame operations across HTTP/client/MCP/Studio.
- Preview-only role-asset replacement that applies an exact canonical DesignPlan assignment through ordinary asset/crop operations with protection, stable-ID, history, inverse, HTTP/client/MCP/Studio, and packed-plugin parity.
- Preview-only Plan-declared Brand binding that resolves only the exact pinned immutable Brand Kit revision into ordinary fill/stroke/typography operations with protection, stable-ID, history, inverse, HTTP/client/MCP/Studio, and packed-plugin parity.
- Preview-only DesignPlan variant application with deterministic preserve/hide/anchored-reflow/stretch-resize behavior, no-partial format mismatch handling, protection, stable-ID, history, inverse, HTTP/client/MCP/Studio, and packed-plugin parity.
- Ephemeral proposal explanation, rendered review, and commit tools that reference the exact canonical preview ID/hash/operations/provenance, preserve `commit_preview` compatibility, and add no second state or mutation authority.
- Optional stable-ID live palette bindings for fill, stroke, and text color, with exact immutable-pin resolution, materialized canonical values, direct-edit detach, inverse/history safety, pin-change rejection, and HTTP/client/MCP/Studio parity.
- Optional stable-ID live typography-role bindings with exact pinned font-resource resolution, materialized paragraph styles, direct-edit detach, appearance-preserving explicit detach, inverse/history safety, and HTTP/client/MCP/Studio parity.
- Optional named immutable Brand effect styles and stable-ID live effect-stack bindings with old-hash compatibility, exact-pin materialization, direct-edit detach, inverse/history safety, and HTTP/client/MCP/Studio parity.
- Optional named immutable radius tokens and stable-ID uniform rectangle-radius bindings with old-hash compatibility, asymmetric direct-edit detach, exact inverses, and HTTP/client/MCP/Studio parity.
- Optional named immutable spacing tokens and stable-ID uniform canvas safe-area bindings with old-hash compatibility, direct-inset detach, exact inverses, and HTTP/client/MCP/Studio parity.
- Optional exact-pin named palette variable modes with frame-scoped canonical identity, atomic bound-color materialization, base restoration, exact inverses, and HTTP/client/MCP/Studio parity.

### Changed

- Studio operational details are available on demand as support details instead of occupying the everyday interface.

### Fixed

- Color-picker revision conflicts, imported project-font activation, explicit texture initialization, stale Studio loads, mask bounds, adjustment targeting, and unused-font removal.

## 1.0.0

- Initial structured local design runtime, Studio, CLI, MCP server, renderer, and personal Codex plugin release candidate.
