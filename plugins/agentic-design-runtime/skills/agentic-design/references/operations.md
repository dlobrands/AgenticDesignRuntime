# Typed operation workflow

## Scope and revision rules

- Use workspace scope only for `createProject`; its base revision is `null`.
- Use project scope for project metadata, frame lifecycle, assets, and fonts; use the current project revision.
- Use frame scope for canvas and scene changes; use the current frame revision.
- Keep every batch inside one scope and one frame.
- Generate UUIDs once and preserve them across previews, commits, later edits, and layer references.

## Mutation sequence

Inspect the target first. Prefer `search_nodes` over guessing IDs. Use `preview_batch` for every semantic change, review its diff and warnings, then use `commit_preview`. A committed batch creates exactly one revision.

Use `explain_proposed_changes` and `preview_proposal` when the review needs an attributed, human-readable proposal view. Both reference the exact existing preview; `proposalId` equals `previewId`. Commit with `commit_proposal` only after review. It is an alias of canonical preview commit, not a durable branch or alternate transaction path. Expired, consumed, stale, or conflicting previews must be recreated or explicitly resolved through normal canonical rules, never silently regenerated.

Use only operation shapes accepted by the MCP tool schema. Do not send JSON Patch, free-form property merges, renderer commands, scripts, or filesystem instructions.

Persistent layout guides and safe-area insets are frame canvas metadata. Change the complete guide list or safe area through a reviewed frame-scope `setCanvas` operation. Preserve guide IDs when moving them. Guide lines, safe-area boundaries, snap lines, canvas-center lines, and spacing labels never render or export; do not create scene nodes to imitate these Studio aids.

Optional node `resizeConstraints` are canonical layout intent. Change them through `updateNode` with property group `resizeConstraints` and `{ constraints: { horizontal, vertical } }`, or use `null` to restore left/top defaults. Existing-frame resize must remain one frame transaction with `setCanvas` plus explicit affected transform updates. Project-scope `duplicateFrame` may include `resize: { width, height, strategy }`, where strategy is `canvasOnly`, `scale`, or `constraints`; use the current project revision and preserve all source node IDs inside the new frame.

Named export presets are canonical project metadata. Create or replace one with project-scope `setExportPreset`; remove one with `removeExportPreset`. Preserve preset IDs when revising them and preview the project transaction before commit. Presets store format, 0.25×–4× scale, optional JPEG/WebP quality, and optional JPEG matte; they never store frame selection. Use `export_frame` or `export_project` only after committed-state validation. PNG has no quality setting, JPEG always flattens transparency to its matte, and only transparent-canvas PNG/WebP output retains alpha.

Project templates are canonical project metadata changed with project-scope `setProjectTemplate` and `removeProjectTemplate`. A definition contains normal source nodes and bounded semantic slots (`headline`, `supportingCopy`, `heroImage`, `logo`, `cta`, `background`, `badge`, `legalCopy`). Use `list_project_templates`, then `apply_project_template` in preview mode. Application allocates fresh stable IDs and compiles to one normal frame `createNode`; it does not establish a parallel state model or implicit live update. Use `detach_project_template` to remove metadata only while preserving node IDs and visible content.

Design briefs are non-executable canonical project intent. Use `list_design_briefs` before creating a new one, then call `create_design_brief` in its default preview mode and commit only after reviewing the exact objective, audience, copy, brand and asset requirements, hierarchy, mood, constraints, accessibility, and export intent. Use `remove_design_brief` through the same preview contract. Brief changes never mutate frames or run code; do not treat a brief as a DesignPlan or bypass the transaction engine to apply it.

Design plans are non-executable canonical project planning records. Use `list_design_plans`, then call `create_design_plan` in preview mode with stable semantic-role IDs, valid brief/copy/frame/node/asset references, normalized regions/safe areas, explicit constraints, bindings, variants, protected human decisions, and truthful approval state. Use `remove_design_plan` through the same review contract. Call `preview_design_plan` with the current target-frame revision and an optional selected role/variant set. Review its ordinary operations, structured warnings, and protected-decision IDs, then commit only the returned canonical preview. Creating or approving a plan never mutates a frame automatically.

Inspect exact binding health with `inspect_design_plan` and `inspect_design_roles`. Change one existing binding with preview-first `assign_semantic_role`; use a canonical target-frame node ID or `null` to detach. The tool compiles to one project `setDesignPlan`, preserves unrelated plan/frame state and stable IDs, respects role/copy protections, and returns prior approval to draft. Never submit a reconstructed whole plan when this bounded tool satisfies the request.

Call `apply_layout_system` for a reviewed preview of every explicit normalized anchor and the single supported global safe area. Call `reflow_content` with unique stable role IDs to re-apply only those anchors without changing canvas metadata. Both emit ordinary stable-ID frame operations, respect locks and position/node/role protections, and reject stale frame revisions. Roles without anchors remain unchanged with a warning; do not calculate guessed coordinates or commit automatically.

Call `replace_role_asset` with an exact Plan role after confirming its canonical asset assignment. It emits only the declared `replaceAsset` and optional crop-reset operations, preserves stable IDs and unrelated state, respects node/role/crop protections, and rejects stale revisions. The tool deliberately accepts no replacement asset argument; update and review Plan intent first instead of silently diverging artwork.

Call `bind_brand_tokens` after confirming the canonical Plan bindings and exact project Brand Kit pin. Optionally select stable role IDs. It emits only supported declared fill, stroke, text-color, and typography operations, preserves stable IDs and unrelated state, respects node/role/Brand protections, and rejects stale revisions. It accepts no token/value override and never selects a newer kit revision implicitly; unsupported effect, spacing, and radius intent remains a visible warning until Phase 5 defines those live-token contracts.

Call `create_design_variants` with one exact canonical `variantRuleId`. Same-format `hide`, anchored `reflow`, and stretch-anchored `resize` behaviors compile into ordinary visibility/transform operations; `preserve` is an explicit no-op. A format mismatch returns a warning and no partial preview. Respect locks and node/role/position protections, review rendered output, and never infer coordinates or resize the current frame implicitly.

`audit_visual_quality` is read-only. Omit `planId` for frame-only deterministic checks or pass an exact compatible DesignPlan for role, brief-copy, safe-area, and supported pinned-Brand checks. It creates no preview or revision. Findings are deterministic facts; `heuristic` and `modelJudged` entries are explicitly unevaluated and must not be presented as scores.

## Scene construction

Create back-to-front layer order intentionally. Keep descriptive layer names. Use groups for meaningful visual units, masks only for actual clipping/compositing, and adjustments at root with stable target IDs.

Keep text transform dimensions synchronized with the intended text box. Let the runtime resolve auto-sized text before commit. Import a project font before referring to its ID.

## Existing designs

Read the current frame and revision immediately before previewing. Preserve IDs, order, transforms, and unaffected properties. Use revision comparison when the requested change could alter unrelated nodes.

## Brand Library workflow

Use `list_brand_kits` and `get_brand_kit` to inspect exact immutable revisions. `create_brand_kit` may reference only assets and fonts already verified in its source project. Preview `pin_brand_kit` before committing the same exact kit revision and current project revision; do not assume a newer kit should replace an existing pin. `unpin_brand_kit` detaches governance without changing existing nodes.

Use `apply_brand` in preview mode for palette, type, logo, component, or template changes, then commit the returned preview. Logo and font IDs resolve through the project's exact pin, and reusable definitions expand into ordinary nodes with a complete caller-generated UUID replacement map. Never rewrite a frame merely because a newer Brand Kit revision exists.

Use `bind_live_palette_token` for a persistent fill, stroke, or text-color relationship. Generate and retain one stable binding ID, target an exact canonical node, and pass only a token key from the project's pinned immutable kit. The runtime materializes the exact token color and stores binding metadata in the same reviewed frame transaction. Use `unbind_live_palette_token` to detach one relationship without changing its visible value. Direct property edits also detach only that binding; undo restores it. Never change or remove the project pin while bindings remain, and never rewrite values from the newest kit without a separate exact-revision migration proposal.

Use `bind_live_typography_role` for a persistent paragraph-style relationship on one canonical text node. Generate and retain a stable binding ID and pass only the exact saved type-role key. The runtime resolves the role's immutable font through the project's pinned resource map, materializes font ID/size/weight/style/line-height/tracking and optional role color, and stores metadata through ordinary reviewed frame operations. `unbind_live_typography_role` preserves appearance. Direct paragraph edits detach the role; rich-text spans remain untouched. Never supply alternate font/style values or follow a newer kit revision implicitly.

Use `bind_live_effect_style` for a persistent ordered effect-stack relationship. Generate and retain a stable binding ID and pass only one named style key from the exact pinned immutable kit. The runtime materializes the complete bounded effect stack through ordinary frame operations. `unbind_live_effect_style` preserves pixels; direct effect edits detach the relationship and undo restores it. Never submit a caller-authored replacement stack or follow a newer revision implicitly.

Use `bind_live_radius_token` for a persistent uniform corner-radius relationship on one canonical rectangle. Generate a stable binding ID and pass only the exact pinned token key. The runtime materializes the value across all four corners; explicit detach preserves appearance and any direct asymmetric corner edit detaches automatically. Never supply raw radius values or follow a newer kit revision implicitly.

Use `bind_live_spacing_token` for a persistent uniform canvas safe-area relationship. Generate a stable binding ID and pass only the exact pinned token key. The runtime materializes all four insets through the ordinary canvas transaction; explicit detach preserves the safe area and any direct inset edit detaches automatically. Never treat this bounded V1 margin contract as arbitrary object gaps, padding, or auto layout.

Use `apply_live_variable_mode` to materialize one declared exact-pin palette mode across every compatible live binding in one canonical frame transaction. Pass `null` to return to immutable base palette values. Inspect the rendered preview and exact frame mode identity before commit. Never infer a mode, change another frame silently, or claim that effects, radius, spacing, or fonts changed.

Component definitions may declare bounded per-source-node overrides and compatible named variants. Supply a fresh `instanceId` when applying a component. Use `switch_brand_component_variant` in preview mode to preserve instance node IDs, hierarchy, and compatible active overrides while updating only unoverridden materialized values from the exact pin. Use `detach_brand_component` before unsupported property or hierarchy changes; detach removes metadata only. Never regenerate or flatten an instance to switch variants, silently discard overrides, or resolve from the newest revision.

Use `audit_brand_system` to inspect deterministic exact-pin integrity errors, generic or duplicate organization names, and unbound canonical values that exactly match palette tokens. It is read-only. Informational matches may be intentional and must not be auto-bound without a separate preview and review.

Use `migrate_brand_kit_revision` to preview or commit one explicit immutable revision change across the project pin, every live token/style/mode binding, and compatible component instance in one journaled project transaction. The target must remain in the same kit lineage; keys, resources, component structure, and active overrides must be compatible. Review before commit. Use `rollback_brand_kit_migration` only immediately after the migration so the normal exact project inverse restores the prior pin and materialized values. Never choose latest implicitly or sequence per-frame commits manually.

## Runtime update workflow

Use `update_check` to inspect only the configured official signed release. Use `update_fetch` to verify and stage it without activation. Before `update_apply` or `update_rollback`, finish or cancel design work, export if requested, and stop every ADR runtime. Apply and rollback require a new Codex task or connector restart before further design operations.

Never supply a URL, invoke `git pull`, execute a downloaded script, install remote plugin content, or bypass origin/signature/provenance/compatibility failures. A runtime/plugin split-brain report requires rollback or a separately authorized verified plugin installation.
