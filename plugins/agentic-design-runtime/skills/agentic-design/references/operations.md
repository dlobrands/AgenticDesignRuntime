# Typed operation workflow

## Scope and revision rules

- Use workspace scope only for `createProject`; its base revision is `null`.
- Use project scope for project metadata, frame lifecycle, assets, and fonts; use the current project revision.
- Use frame scope for canvas and scene changes; use the current frame revision.
- Keep every batch inside one scope and one frame.
- Generate UUIDs once and preserve them across previews, commits, later edits, and layer references.

## Mutation sequence

Inspect the target first. Prefer `search_nodes` over guessing IDs. Use `preview_batch` for every semantic change, review its diff and warnings, then use `commit_preview`. A committed batch creates exactly one revision.

For layer compositing, use `preview_layer_compositing` with explicit node IDs to preview blend mode, overall opacity, and source-only fill opacity. For alignment and equal-gap distribution, use `preview_arrange_layers`; choose `selection`, `canvas`, or an explicit selected key layer as the reference. Both tools compile to ordinary canonical `updateNode` operations and still require `commit_preview` after review.

Use `explain_proposed_changes` and `preview_proposal` when the review needs an attributed, human-readable proposal view. Both reference the exact existing preview; `proposalId` equals `previewId`. Commit with `commit_proposal` only after review. It is an alias of canonical preview commit, not a durable branch or alternate transaction path. Expired, consumed, stale, or conflicting previews must be recreated or explicitly resolved through normal canonical rules, never silently regenerated.

Use only operation shapes accepted by the MCP tool schema. Do not send JSON Patch, free-form property merges, renderer commands, scripts, or filesystem instructions.

Persistent layout guides and safe-area insets are frame canvas metadata. Change the complete guide list or safe area through a reviewed frame-scope `setCanvas` operation. Preserve guide IDs when moving them. Guide lines, safe-area boundaries, snap lines, canvas-center lines, and spacing labels never render or export; do not create scene nodes to imitate these Studio aids.

Optional node `resizeConstraints` are canonical layout intent. Change them through `updateNode` with property group `resizeConstraints` and `{ constraints: { horizontal, vertical } }`, or use `null` to restore left/top defaults. Existing-frame resize must remain one frame transaction with `setCanvas` plus explicit affected transform updates. Project-scope `duplicateFrame` may include `resize: { width, height, strategy }`, where strategy is `canvasOnly`, `scale`, or `constraints`; use the current project revision and preserve all source node IDs inside the new frame.

Named export presets are canonical project metadata. Create or replace one with project-scope `setExportPreset`; remove one with `removeExportPreset`. Preserve preset IDs when revising them and preview the project transaction before commit. Presets store format, 0.25x-4x scale, optional JPEG/WebP quality, and optional JPEG matte; they never store frame selection. Use `export_frame` or `export_project` only after committed-state validation.

Project templates are canonical project metadata changed with project-scope `setProjectTemplate` and `removeProjectTemplate`. Use `list_project_templates`, then `apply_project_template` in preview mode. Application allocates fresh stable IDs and compiles to ordinary nodes; it does not establish a parallel state model or implicit live update. Use `detach_project_template` to remove metadata only while preserving node IDs and visible content.

Design briefs and plans are non-executable project intent. Inspect existing records before `create_design_brief` or `create_design_plan`, preview every project transaction, and commit only the exact reviewed result. Use `preview_design_plan` only to compile declared actionable intent into ordinary operations; a brief or approved plan never mutates artwork automatically.

Inspect binding health with `inspect_design_plan` and `inspect_design_roles`. Use preview-first `assign_semantic_role`, `apply_layout_system`, `reflow_content`, `replace_role_asset`, `bind_brand_tokens`, and `create_design_variants` only against exact saved Plan intent. Preserve stable IDs, locks, protected decisions, unaffected state, and current revisions. Never infer missing anchors, assets, tokens, formats, or approval.

`audit_visual_quality` is read-only. Findings are deterministic facts; heuristic and model-judged entries remain explicitly unevaluated and must not be presented as scores.

## Scene construction

Create back-to-front layer order intentionally. Keep descriptive layer names. Use groups for meaningful visual units, masks only for actual clipping/compositing, and adjustments at root with stable target IDs.

Keep text transform dimensions synchronized with the intended text box. Let the runtime resolve auto-sized text before commit. Import a project font before referring to its ID.

## Existing designs

Read the current frame and revision immediately before previewing. Preserve IDs, order, transforms, and unaffected properties. Use revision comparison when the requested change could alter unrelated nodes.

Brand Library administration belongs to `$agentic-brand-system`; runtime installation, updates, recovery, and shutdown belong to `$agentic-design-ops`. Load those skills instead of duplicating their safety contracts here.
