# DesignPlan Brand Binding

`bind_brand_tokens` applies only the exact Brand bindings already stored in a canonical DesignPlan. The runtime resolves those bindings against the project's exact immutable Brand Kit pin and verified resource map, then creates an ordinary rendered frame preview. The tool accepts no ad hoc token key, color, font, or value override.

## Supported contract

The default request selects the unique roles that declare `brandBindings`; callers may provide a non-empty unique role subset. Each selected role must exist, bind to a current unlocked node, and target the current frame revision.

Supported bindings are:

- `fill` → a solid palette token on a fill-capable rectangle, ellipse, or vector path;
- `stroke` → a solid palette token on an existing stroke, preserving width, alignment, enabled state, and stroke opacity while applying the token color at paint opacity 1;
- `textColor` → a palette token on text typography; and
- `typography` → an exact pinned type role with its verified project font mapping, size, line height, tracking, and optional palette color.

`effect`, `spacing`, and `radius` bindings remain explicit unsupported intent until Phase 5 defines their live-token and migration contracts. The runtime returns visible warnings and never guesses concrete values.

## Trust and review

Bindings are preview-only. Missing Plans, target frames, roles, nodes, Brand pins, tokens, or font mappings return explicit failures or warnings. Locked nodes and node, role, or Brand-binding protected decisions emit no operation. Stale frame revisions fail before compilation.

Every non-empty result uses only existing `updateNode/fill`, `updateNode/stroke`, or `updateNode/typography` operations through the authenticated transaction engine. Stable node IDs, hierarchy, geometry, content, assets, effects, and unrelated nodes remain unchanged. Studio exposes the exact operations, rendered preview, warnings, commit, and discard controls. Plan approval is descriptive and never commits automatically.

The project pin stays on the same exact immutable kit revision. A newer kit revision is never selected implicitly. Changing Plan intent, changing the project pin, and applying bindings are separate reviewable transactions.

## API parity

- `POST /api/projects/:projectId/frames/:frameId/design-plans/:planId/brand-bindings/preview`

The typed client exposes `bindBrandTokens`. Direct MCP and workspace-aware plugin MCP expose `bind_brand_tokens` with matching inputs.

## Compatibility and rollback

This slice adds one compilation warning code but no canonical field, operation kind, dependency, migration, product-version change, runtime API-version change, or workspace-schema change. Older clients retain the same Plan, Brand Kit pin, frame, and history contracts but lack the convenience route/tool. Discard changes nothing. Commit and undo use existing exact frame history and inverses.
