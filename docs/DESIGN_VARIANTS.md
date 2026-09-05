# DesignPlan Variants

`create_design_variants` compiles one exact saved DesignPlan variant rule into an ordinary rendered frame preview. Despite the plural tool name, each request selects one stable `variantRuleId` so its operations, warnings, review, history, and rollback remain bounded and attributable.

## Deterministic contract

The Plan must target the current frame revision. If the rule omits format or declares the current exact canvas dimensions, supported role behaviors are:

- `preserve`: an explicit no-op;
- `hide`: set the bound role node's visibility to false;
- `reflow`: apply that role's explicit normalized anchor through the existing layout compiler; and
- `resize`: apply an explicit anchor only when at least one axis uses `stretch`.

Reflow and resize use the current exact frame dimensions and existing layout regions/offsets. They do not infer hierarchy, copy priority, subject focus, breakpoints, or responsive constraints. Stable node IDs, content, paint, assets, effects, hierarchy, and every unrelated node remain unchanged.

## Format safety

When a rule declares different canvas dimensions, v2 requires a current project revision plus caller-generated target frame ID, slug, and name. One project-scoped preview duplicates and constraint-resizes the source, retargets the Plan compiler to the duplicate, applies only declared role behavior, and preserves the source frame. Any unresolved required role, node, anchor, protection, or resize intent rejects the whole preview; no partial frame is created.

## Protection and review

Locked nodes emit no operation. Node or role protections preserve hide behavior; position, node, or role protections preserve reflow/resize behavior. Missing rules, roles, bindings, nodes, anchors, regions, or required stretch intent return structured warnings instead of guesses.

Same-format results use existing `updateNode/transform` and `updateNode/visibility` operations. Cross-format results use one extended `duplicateFrame` project operation that deterministically compiles the same bounded frame operations before its revision-zero baseline is written. Plan approval remains descriptive and never commits automatically.

## API parity

- `POST /api/projects/:projectId/frames/:frameId/design-plans/:planId/variants/:variantRuleId/preview`

The typed client exposes `createDesignVariant`. Direct MCP and workspace-aware plugin MCP expose `create_design_variants` with matching inputs.

## Compatibility and rollback

The cross-format contract belongs to Runtime API/workspace schema 2. Discard changes nothing. Commit creates one new revision-zero frame and one project revision; undo removes that duplicate through the existing exact inverse.
