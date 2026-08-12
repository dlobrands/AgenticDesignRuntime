# DesignPlan Intent Compiler

The DesignPlan intent compiler is a pure, bounded translation layer above the existing frame operation vocabulary. It reads canonical project intent and current canonical frame state, then returns inspectable ordinary operations, structured changes, warnings, and protected-decision evidence. It does not own state, execute arbitrary instructions, commit automatically, or bypass `TransactionEngine`.

## Review contract

The runtime route and typed client accept an exact project, frame, plan, and current frame revision. Callers may select a bounded role subset for a small revision or an optional variant rule. The runtime rejects stale revisions before compilation, derives trusted actor provenance, resolves the exact pinned Brand Kit where available, and submits non-empty output only as a normal frame preview. A zero-operation result returns warnings without creating a preview.

Direct and workspace-aware MCP expose `preview_design_plan`. Studio exposes **Preview actionable intent** on the plan's target frame. Humans see the ordered changes and all warnings before choosing **Commit reviewed preview** or **Discard preview**. Commit uses the existing expiring preview, validation, journal, history, recovery, event, and conflict boundaries.

## Deterministic actionable intent

The compiler currently translates only intent with complete deterministic parameters:

- brief copy into a bound text node, preserving compatible rich-span styling through the existing text operation;
- exact project asset assignment and fit for a bound raster/SVG node;
- explicit crop reset when `preserveCrop` is false;
- normalized layout-region anchors and offsets into ordinary transform updates;
- one unambiguous global normalized safe area into canvas pixel insets;
- concrete palette fill/stroke/text-color and pinned typography tokens;
- explicit variant `hide` behavior.

Role selection limits compilation to those role-bound nodes and omits global canvas intent. Existing node IDs are always retained. The compiler never creates a replacement scene or rebuilds unrelated roles for a small request.

## Protection and warnings

`node` and `role` protected decisions apply broadly to matching actions. `copy`, `crop`, `position`, and `brandBinding` decisions protect their corresponding property intent. Protected actions emit `PROTECTED_DECISION` with the exact decision IDs and no operation.

The compiler emits structured warnings for unapproved plans, absent/mismatched target frames, missing roles/nodes/copy, locked nodes or ancestry, incompatible node types, invalid layout, unavailable Brand Kits/tokens, unsupported intent, and missing variants. Draft/proposed plans may be previewed for review, but `PLAN_NOT_APPROVED` remains visible and approval never authorizes a commit.

Effect descriptions, free-form constraints, region-scoped safe areas, implicit hierarchy changes, format-changing variants, and future spacing/radius/effect token bindings remain inspectable warnings until they have complete deterministic contracts. The compiler does not guess parameters from prose.

## Compatibility and failure behavior

No product, runtime API, workspace schema, operation schema, or project migration is introduced. Compiler output uses existing schema-1 frame operations. Older clients do not know the preview route/tool but can continue reading projects and frames under the DesignPlan compatibility rules.

Compilation does not change canonical state. Discard leaves pixels and revisions unchanged. A successful commit creates one normal frame revision with exact inverses and trusted provenance. If validation, locking, revision, security, or preview-expiry checks fail, the canonical state remains unchanged.

## Rejected alternatives

- Executing plan descriptions, prompts, scripts, CSS, or model output.
- Creating a plan-owned scene graph or mutation path.
- Applying a plan when it is approved, created, opened, or listed.
- Silently skipping protected human decisions.
- Guessing missing effects, hierarchy, token, crop, or layout parameters.
- Rebuilding the frame to satisfy one selected role.
- Committing without a separately reviewed canonical preview.
