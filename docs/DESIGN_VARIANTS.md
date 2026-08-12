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

When a rule declares different canvas dimensions, the compiler returns a visible warning and no operations or preview. It never applies hide/reflow/resize partially to the wrong format and never resizes the current frame implicitly. The existing explicit frame duplicate/resize workflow remains the canonical format-changing contract; updating or cloning Plan intent for a resized target is a separate reviewable project transaction.

## Protection and review

Locked nodes emit no operation. Node or role protections preserve hide behavior; position, node, or role protections preserve reflow/resize behavior. Missing rules, roles, bindings, nodes, anchors, regions, or required stretch intent return structured warnings instead of guesses.

Every non-empty result uses only existing `updateNode/transform` and `updateNode/visibility` operations through the authenticated transaction engine. Studio exposes the exact operations, warnings, rendered preview, commit, and discard controls. Plan approval remains descriptive and never commits automatically. Stale revisions fail before compilation.

## API parity

- `POST /api/projects/:projectId/frames/:frameId/design-plans/:planId/variants/:variantRuleId/preview`

The typed client exposes `createDesignVariant`. Direct MCP and workspace-aware plugin MCP expose `create_design_variants` with matching inputs.

## Compatibility and rollback

This slice adds no canonical field, warning code, operation kind, dependency, migration, product-version change, runtime API-version change, or workspace-schema change. Older clients retain the same Plan, layout, frame, preview, and history contracts but lack the convenience route/tool. Discard changes nothing. Commit and undo use existing exact frame history and inverses.
