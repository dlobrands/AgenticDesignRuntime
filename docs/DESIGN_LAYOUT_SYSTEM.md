# DesignPlan Layout and Reflow

AgenticDesignRuntime compiles explicit DesignPlan layout intent into ordinary frame operations. It does not add an auto-layout document, a responsive scene model, or another mutation authority. Every result is an expiring canonical preview that a human or agent must inspect and explicitly commit or discard.

## Apply a layout system

`apply_layout_system` reads all semantic roles in one exact DesignPlan, its normalized layout regions and anchors, the target frame, and the single global safe area when present. It may emit only:

- one `setCanvas` for a non-protected global safe area; and
- stable-ID `updateNode/transform` operations for bound, unlocked roles with explicit anchors.

Normalized region coordinates and offsets are multiplied by the current exact canvas dimensions, then rounded to three decimal places. Start, center, end, and stretch anchors are deterministic. A region-scoped safe area remains inspectable intent because schema 1 has one canonical canvas safe area and never silently flattens multiple region contracts.

## Reflow selected content

`reflow_content` requires one or more unique stable role IDs. It re-applies only those roles' explicit anchors after copy, asset, or size changes. It never changes the canvas safe area and never moves an unselected role. A selected role without an anchor returns an `UNSUPPORTED_INTENT` warning instead of inferred coordinates.

Both tools preserve node IDs, hierarchy, copy, assets, crop, paint, typography, effects, Brand bindings, visibility, and unrelated transforms. They do not resize the frame or execute free-form constraint descriptions.

## Review, protection, and failure behavior

Both tools are preview-only. HTTP and MCP callers provide the current frame revision; stale requests fail before compilation. Studio exposes “Preview layout system” and “Reflow selected roles,” then uses the existing exact diff, rendered preview, commit, and discard controls.

Locked nodes produce warnings and no operation. Position, node, or role protected decisions preserve matching node transforms. A global position protection preserves the canvas safe area. Missing frames, Plans, roles, nodes, regions, non-positive stretch results, or ambiguous global safe areas are explicit warnings or request failures; none trigger fallback placement or regeneration.

Approval remains descriptive. A draft or proposed Plan produces a visible warning but does not block preview, and a preview never implies approval.

## API parity

- `POST /api/projects/:projectId/frames/:frameId/design-plans/:planId/layout-system/preview`
- `POST /api/projects/:projectId/frames/:frameId/design-plans/:planId/reflow/preview`

The typed client exposes `applyLayoutSystem` and `reflowContent`. Direct MCP and workspace-aware plugin MCP expose `apply_layout_system` and `reflow_content` with the same legal inputs. The general `preview_design_plan` compiler and specialized layout compiler are covered by operation-parity tests for shared safe-area and anchor intent.

## Compatibility and rollback

This slice adds no canonical field, operation kind, migration, dependency, product-version change, runtime API-version change, or workspace-schema change. Older clients simply lack the convenience routes/tools. Discarding a preview changes nothing. A committed preview uses the existing frame history and exact inverse operations, so undo restores the prior canvas and transforms.
