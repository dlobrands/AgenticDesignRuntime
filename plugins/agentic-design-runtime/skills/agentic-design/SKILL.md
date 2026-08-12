---
name: agentic-design
description: Create, revise, inspect, preview, validate, and export editable layered graphics with the local Agentic Design Runtime. Use for new client graphics, social posts, posters, cards, diagrams, branded compositions, revisions to existing runtime projects, Studio collaboration, asset or font imports, design history, and final PNG, JPEG, or WebP delivery. Also use when asked to install, start, reconnect, open, diagnose, or stop an Agentic Design Runtime workspace.
---

# Agentic Design

Build graphics through the runtime's typed MCP operations. Treat the runtime as the sole authority for design state; never edit its canonical JSON, history, manifests, descriptors, locks, or exports directly.

## Start from workspace state

Apply the first matching case:

1. For a specific inspection, validation, preview, export, Studio-open, or stop request, perform only that operation.
2. For an existing `design-runtime/` directory, call `ensure_design_workspace` with its parent as `clientRoot`, then inspect projects and frames before editing.
3. For a fresh design, call `ensure_design_workspace` with the active client repository as `clientRoot` and `workspaceDirectory: "design-runtime"`.

Always pass the returned absolute `workspacePath` to later tools. Never select a workspace by recency when multiple runtimes exist.

## Capture the brief

Build immediately when the request supplies a clear subject, copy, and output context. Infer standard dimensions from a named platform or format. Ask only when a missing decision would materially change the deliverable, such as an ambiguous format, missing required copy, or unavailable brand asset.

Search the client project for relevant logos, imagery, brand guidance, and fonts before asking for files. Use an available image-generation capability when the brief requires original raster imagery, then import the resulting file normally. Do not introduce a remote AI provider into the runtime.

## Build and revise

Read [operations.md](references/operations.md) before the first mutation in a task.

1. Inspect current project, frame, asset, font, and revision state.
2. Create a project at workspace scope, then create frames at project scope when needed.
3. Import assets and fonts at the current project revision.
4. Submit scene changes with `preview_batch` at the current frame revision.
5. Inspect the structured diff, warnings, affected nodes, and preview hash.
6. Commit with `commit_preview`; do not reconstruct the batch after approval.
7. Call `render_preview` and visually inspect the returned image.
8. Iterate until the design and canonical validation pass.

For a structured proposal review, pass that same preview ID to `explain_proposed_changes` and `preview_proposal`, then use `commit_proposal` only after approval. The proposal ID is the preview ID, and commit uses the exact stored operations and revision checks. Never reconstruct, edit, or silently rebase a proposal response.

For requested quick changes, still preview before commit. Use stable node IDs and preserve unaffected node state. Never cross frame or project scope in one batch.

## Collaborate in Studio

After rendering the first draft of a newly created workspace, call `open_studio`. Do not expose bootstrap nonces or capability tokens. For an existing workspace, open Studio only when requested or when interactive human editing is clearly useful.

When a human changes the design, call `wait_for_frame_change` or reload the frame. Treat the resulting revision as canonical. If a revision conflict occurs, inspect the latest frame, re-plan the intended change, preview again, and commit only against the new revision.

## Review and deliver

Read [visual-qa.md](references/visual-qa.md) before final delivery. Return rendered PNG content in the conversation after each material draft.

When the user accepts the design or explicitly requests final export:

1. Run `validate_frame` and resolve all blocking errors.
2. Run `audit_visual_quality`, passing the reviewed DesignPlan ID when one exists. Resolve deterministic errors and review warnings. Never convert its explicitly unevaluated heuristic/model-judged categories into objective scores.
3. Call `export_frame`, or `export_project` for an explicitly selected frame set, and report every exact path, format, dimensions, revision, alpha state, and warning. Omit settings only for the backward-compatible 1× PNG. Use JPEG matte intentionally when canonical transparency exists.
4. Return the final image in the conversation.
5. Call `stop_runtime` after successful delivery.

For reusable project systems, inspect `list_project_templates`, call `apply_project_template` in its default preview mode, review the generated ordinary-node diff, then commit the preview. Use `detach_project_template` to remove only instance/slot metadata; never flatten or regenerate the visible layers.

When durable campaign intent is useful, inspect `list_design_briefs`, then create a bounded brief through `create_design_brief` in preview mode. Verify required copy, protected constraints, accessibility, Brand Kit/asset references, and export intent before committing. A brief is inspectable project metadata only; it must never be interpreted as permission to mutate artwork without a separately reviewed canonical plan and operation preview.

For structured semantic planning, inspect `list_design_plans`, then create a bounded plan through `create_design_plan` in preview mode. Validate every role, hierarchy, layout region, binding, asset, variant, protected human decision, and approval field. A plan is non-executable project metadata. Use `preview_design_plan` to compile only declared actionable intent into ordinary operations; inspect every change, warning, and protected decision before committing the returned preview. Even an approved plan never mutates artwork automatically.

Use `inspect_design_plan` and `inspect_design_roles` before revising role bindings. Call `assign_semantic_role` in its default preview mode with an exact existing role and canonical target-frame node, review the complete project diff, then commit the returned preview. Pass `nodeId: null` only to detach intentionally. Assignment preserves frame content and stable IDs but invalidates stale approval to draft; never rebuild the whole plan to change one binding.

Use `apply_layout_system` to preview every explicit Plan anchor plus its supported global safe area. Use `reflow_content` with exact role IDs after content changes when only selected roles should return to their declared anchors. Review the ordinary frame operations and rendered preview before commit. Never infer coordinates for roles without anchors, flatten region safe areas, move protected/locked nodes, or treat a preview as approval.

Use `replace_role_asset` only after inspecting the exact canonical Plan assignment for that role. The tool accepts no ad hoc asset ID: it previews the declared asset/fit and optional crop reset through ordinary frame operations. Review rendered focus and resolution before commit. Never bypass node/role/crop protections, substitute another asset, or let artwork diverge silently from Plan intent.

Use `bind_brand_tokens` only after inspecting the canonical Plan bindings and the project's exact immutable Brand Kit pin. The tool accepts no ad hoc token or value: it previews only supported declared palette/typography bindings through ordinary frame operations. Review the exact pinned revision, mapped font resources, rendered output, and warnings before commit. Never substitute the newest kit revision implicitly or treat unsupported effect/spacing/radius intent as applied.

Use `bind_live_palette_token` when a node property should remain explicitly associated with one palette token. Supply a stable binding ID, canonical node ID, `fill`, `stroke`, or `textColor`, and the token key; never supply or infer a color or newer kit revision. Review and commit the returned canonical preview. Use `unbind_live_palette_token` to preserve appearance while intentionally detaching one property. A later direct edit also detaches only that property binding, and pin changes are rejected until an explicit migration proposal exists.

Use `bind_live_typography_role` when a text node's paragraph style should remain associated with one exact type role. Supply a stable binding ID, canonical text-node ID, and role key only. The runtime resolves the font through the exact pinned project resource map and materializes the role values in the canonical frame. Review and commit the preview, and use `unbind_live_typography_role` for appearance-preserving detach. Never supply a font/value override or choose a newer kit revision implicitly. Direct paragraph typography edits detach the role; rich-text span overrides remain separate.

Use `bind_live_effect_style` for one named ordered effect stack from the exact pinned kit. Supply a stable binding ID, canonical node ID, and style key only; never reconstruct or override the stack. Review and commit the canonical preview. Use `unbind_live_effect_style` to preserve appearance while detaching. Direct effect edits detach the style, and a newer kit revision never propagates implicitly.

Use `bind_live_radius_token` for one named uniform rectangle-radius token from the exact pinned kit. Supply a stable binding ID, canonical rectangle ID, and token key only. Review and commit the preview. Use `unbind_live_radius_token` for appearance-preserving detach. Any later direct corner edit detaches the relationship; never supply corner values or infer a newer kit revision.

Use `bind_live_spacing_token` for one named uniform canvas safe-area margin from the exact pinned kit. Supply a stable binding ID and token key only. Review the overlay, exact insets, and canonical preview before commit. Use `unbind_live_spacing_token` for appearance-preserving detach. Any direct safe-area edit detaches the relationship. Never reinterpret the token as arbitrary gaps, padding, or node movement.

Use `apply_live_variable_mode` to preview one named exact-pin palette mode across all compatible live bindings in one frame; pass `null` only to restore base palette values. Review every materialized color and the frame mode identity before commit. It never changes unbound values, fonts, effects, radius, spacing, or another frame implicitly.

For exact-pin component instances, use `switch_brand_component_variant` only with a compatible definition from the same declared variant group. Review the rendered preview and structured operations before commit; the switch preserves stable node IDs and active allowed overrides. Use `detach_brand_component` before unsupported hierarchy or property changes. Detach preserves appearance and IDs.

Use `audit_brand_system` for read-only deterministic Brand integrity, organization-name, duplicate-label, and unbound-token findings. Treat informational unbound matches as review prompts, not objective defects, and never mutate artwork merely to reduce the count.

Use `migrate_brand_kit_revision` only with an explicit target revision in the currently pinned kit lineage. Preview first, inspect the project pin and every affected live binding/component, then commit the same exact target at the unchanged project revision. Missing tokens, modes, resources, incompatible component structure, unsupported active overrides, or locked bound nodes must stop the whole migration. Use `rollback_brand_kit_migration` only as the explicit immediately-following inverse; never simulate rollback by pinning latest or flattening artwork.

Use `create_design_variants` with one exact saved variant rule and current frame revision. Review same-format hide, anchored reflow, and stretch-resize operations before commit. A different declared format must return no partial preview; use the explicit frame duplicate/resize workflow and review updated Plan intent separately. Never infer missing anchors, resize the current canvas implicitly, or present warnings as applied behavior.

Keep the runtime active during review. If the user has not approved or requested final export, do not stop it.

## Recover safely

Read [recovery.md](references/recovery.md) when installation, startup, imports, revisions, external edits, rendering, or shutdown fail. Preserve recovery files and the last valid scene. Never bypass workspace locks, path containment, validation, or capability authentication.
