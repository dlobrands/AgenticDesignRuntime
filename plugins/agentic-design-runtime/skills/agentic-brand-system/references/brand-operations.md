# Brand operation contract

## Kit lifecycle

Use `list_brand_kits` and `get_brand_kit` to inspect exact immutable revisions. `create_brand_kit` may reference only assets and fonts already verified in its source project. Preview `pin_brand_kit` before committing the same exact kit revision and current project revision. `unpin_brand_kit` detaches governance without changing existing nodes.

Use `apply_brand` in preview mode for palette, type, logo, component, or template changes, then commit the exact returned preview. Resources resolve through the project's exact pin, and reusable definitions expand into ordinary nodes with a complete caller-generated UUID map.

## Live bindings and components

Use `bind_live_palette_token`, `bind_live_typography_role`, `bind_live_effect_style`, `bind_live_radius_token`, or `bind_live_spacing_token` only with a stable binding ID, exact canonical target, and token or role key from the pinned immutable kit. Never supply a replacement visual value. Explicit unbind operations preserve appearance; direct property edits detach only the affected relationship.

Use `apply_live_variable_mode` to materialize one declared palette mode across compatible bindings in one frame. Passing `null` restores base palette values. It never changes unbound values, fonts, effects, radius, spacing, or another frame.

Use `switch_brand_component_variant` only for a compatible definition in the same declared variant group. It preserves instance node IDs, hierarchy, and active supported overrides. Use `detach_brand_component` before unsupported hierarchy or property changes; detach removes metadata only.

## Audit and migration

`audit_brand_system` reports deterministic exact-pin integrity, organization, duplicate-label, and exact unbound-token findings without mutation.

Use `migrate_brand_kit_revision` with an explicit target revision in the current kit lineage. Missing vocabulary, resources, compatible component structure, or unlocked affected nodes blocks the whole migration. Review the project pin and every affected binding/component before commit. Use `rollback_brand_kit_migration` only immediately afterward so the normal exact inverse restores prior materialized values.
