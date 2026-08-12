# Live Brand Bindings

Live Brand bindings keep a stable node or canvas property associated with one declared token or role from the project's exact immutable Brand Kit pin. Binding metadata is ordinary additive canonical state; resolved values are also materialized so reopen, history reconstruction, renderer preview, export, and visual QA never depend on mutable or external token lookup.

## V1 palette contract

A binding has a stable ID, target property (`fill`, `stroke`, or `textColor`), exact kit ID/revision/content hash, and token key. A node may have at most one binding per property. The property must be compatible and use a solid paint where applicable.

`bind_live_palette_token` accepts the current frame revision, stable binding/node IDs, property, and token key. The runtime resolves only the project's current exact pin and emits ordinary `updateNode` operations for the materialized value and binding metadata. `unbind_live_palette_token` removes only one binding and preserves the current visible value. Both default to preview in direct and workspace-aware MCP; Studio always previews and offers explicit commit/discard. The typed client exposes `bindPaletteToken` and `unbindPaletteToken`.

The caller cannot provide a kit revision, content hash, or color. Creating a newer immutable kit revision never changes a project or bound node automatically.

## V1 typography contract

A typography binding targets one text node and one exact type-role key. `bind_live_typography_role` resolves the role's immutable Brand font through the project's pinned `resourceMap`, then materializes the project font ID, font size, font weight, font style, line height, letter spacing, and optional palette-backed role color. Alignment, vertical alignment, paragraph opacity, text content, text-box behavior, and rich-text span overrides remain unchanged.

`unbind_live_typography_role` removes only the binding metadata and preserves the current rendered typography. Both direct and workspace-aware MCP default to preview; Studio provides explicit preview, commit, discard, metadata inspection, and detach. The typed client exposes `bindTypographyRole` and `unbindTypographyRole`.

The caller cannot supply a font ID, type values, color, kit revision, or resource mapping. A direct paragraph-typography edit detaches the typography binding. Because text color is part of the paragraph typography operation group, a direct color edit also detaches an independent text-color binding. Rich-text span editing does not rewrite or detach the paragraph role in this V1 slice.

## V1 effect-style contract

New immutable Brand Kit revisions may optionally define up to 32 named effect styles. Each style contains the existing bounded ordered non-destructive effect stack; old kit records omit `effectStyles` and retain their original content hash because loading does not insert a default field.

`bind_live_effect_style` resolves only one style from the project's exact pin and materializes the complete ordered stack through an ordinary `updateNode/effects` operation plus stable binding metadata. `unbind_live_effect_style` removes only metadata and preserves rendered appearance. Direct effect-stack edits detach the binding; undo restores the prior stack and identity. Studio exposes exact style names, binding metadata, preview, commit, discard, and detach. Effect-style authoring remains agent/API-only until Studio has a named organization workflow that avoids permanently generating anonymous “Effect 1” tokens.

## V1 radius-token contract

New immutable Brand Kit revisions may optionally define up to 64 named non-negative radius tokens. Old kit hashes remain unchanged when the optional field is absent. `bind_live_radius_token` applies one exact value to all four canonical corners of a rectangle and stores stable exact-pin binding metadata. Non-rectangles are rejected; callers cannot supply corner values or a kit revision.

`unbind_live_radius_token` removes metadata without changing the four materialized radii. Any direct corner-radius edit detaches the binding in the same canonical transaction, including an intentionally asymmetric edit; undo restores both the prior uniform value and stable identity. Studio supports inspection, preview, commit, discard, and detach. Radius-token authoring remains agent/API-only pending named organization UX.

## V1 spacing-token contract

New immutable Brand Kit revisions may optionally define up to 64 named non-negative spacing tokens. V1 binds one token only to the canvas safe area as a uniform top/right/bottom/left inset. This is a real canonical relational margin used by Studio layout overlays and deterministic visual QA; it does not silently move artwork or pretend that arbitrary gaps and padding are live.

`bind_live_spacing_token` rejects a token that would leave no positive canvas interior, materializes all four exact insets through the existing `setCanvas` transaction, and stores one stable exact-pin canvas binding. `unbind_live_spacing_token` removes only the binding and preserves the safe area. Any direct safe-area edit detaches the relationship in the same transaction; undo restores both exact insets and identity. Studio supports inspection, preview, commit, discard, and detach. Spacing-token authoring remains agent/API-only pending named organization UX. Per-edge tokens, object gaps, padding, and auto-layout containers require separate complete layout contracts.

## Direct edits and pin safety

A direct canonical edit to a bound fill, stroke, text color, paragraph typography, effects, rectangle radii, or canvas safe area detaches that property's binding in the same transaction. Other bindings and every unrelated node remain unchanged except for the explicit text-color/paragraph-group relationship described above. History records exact inverses, so undo restores both the prior materialized value and its stable binding.

Every frame transaction verifies that each retained binding matches the exact project pin, that the token, type role, effect style, radius token, or spacing token exists, that typography resolves through the exact pinned font resource map, and that every materialized bound value equals its immutable source. Project pin/unpin transactions are rejected while existing bindings would become invalid. A later exact-revision Brand migration proposal must update the pin and affected bindings through an explicit reviewed workflow; the runtime never silently follows the newest revision.

## V1 palette variable modes

New immutable kit revisions may optionally declare up to 16 named modes, each with one or more exact overrides for existing palette tokens. This bounded vocabulary supports light/dark and campaign palette modes without treating arbitrary values as executable logic. A mode belongs to the same exact immutable kit revision and cannot reference a missing base token.

`apply_live_variable_mode` applies one mode to one frame through an ordinary reviewed frame transaction. It stores exact kit/mode identity on the frame and materializes every compatible live fill, stroke, text-color, and palette-backed typography-role color. Passing `null` clears the frame mode and restores immutable base palette values. New palette/typography bindings resolve through the active frame mode. Effects, radius, spacing, fonts, and unbound values are unchanged. The runtime never performs a cross-frame partial switch or render-time token lookup; callers may submit separately reviewed frame transactions for a multi-frame campaign.

## Compatibility and scope

Bindings are optional schema-1 node or canvas metadata and use the existing frame `updateNode`/`setCanvas`, preview, validation, journal, history, recovery, conflict, renderer, and event pipeline. Existing frames, nodes, and projects require no eager migration. Older strict binaries may reject or lose the additive fields and must not rewrite bound workspaces.

This contract covers palette fill, stroke, text color, paragraph typography roles, ordered effect styles, uniform rectangle radius tokens, uniform canvas safe-area spacing tokens, and frame-scoped named palette modes. Gradient stops, rich-text span bindings, arbitrary gaps/padding, per-edge spacing, non-palette mode overrides, components/instances, controlled overrides, Brand lint, and exact-revision migration proposals remain later Phase 5 slices.
