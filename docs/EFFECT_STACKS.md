# Ordered Effect Stacks

Status: Phase 3 public contract, 2026-08-10. Runtime API `1`; workspace schema `1`.

ADR nodes may contain a bounded ordered stack of non-destructive effects. Effects are normal canonical scene properties: Studio, HTTP, MCP, history, semantic conflict analysis, preview, and export all use the existing `updateNode` transaction path. The stack does not introduce another mutation authority or a parallel render document.

## Canonical shape

```json
{
  "effects": {
    "items": [
      {
        "id": "campaign-shadow",
        "type": "outerShadow",
        "enabled": true,
        "offsetX": 0,
        "offsetY": 12,
        "blur": 24,
        "spread": 0,
        "color": "#000000",
        "opacity": 0.35
      }
    ]
  }
}
```

- A stack contains 1–16 effects. Removing the final effect removes `effects` from the node.
- Every effect has a stable, portable ID unique within its stack. IDs are the agent and Studio addressing contract; reordering does not change them.
- `enabled` is non-destructive. Disabled effects remain canonical and inspectable but do not render.
- Array order is compositing order. Earlier outer effects sit farther behind the source; inner effects and overlays are added over the source in order. Blur is a bounded filter over the node's composited content, so moving it does not change which canonical content it owns.
- Reorder, duplicate, remove, enable/disable, and field edits each submit one reversible canonical transaction.
- The entire effects property is one conservative semantic conflict footprint. Concurrent effects edits require review instead of field-level last-writer-wins behavior.

## Supported effects

| Type              | Canonical controls                                 |
| ----------------- | -------------------------------------------------- |
| `outerShadow`     | offset, blur, spread, color, opacity               |
| `innerShadow`     | offset, blur, spread, color, opacity               |
| `blur`            | radius                                             |
| `innerGlow`       | blur, spread, color, opacity                       |
| `outerGlow`       | blur, spread, color, opacity                       |
| `colorOverlay`    | solid paint and effect opacity                     |
| `gradientOverlay` | linear or radial gradient paint and effect opacity |

Studio fully presents and edits every stable field. Gradient overlay stops retain their normal stable IDs and full public gradient semantics.

## Legacy compatibility and migration

Schema-1 nodes using the original single-shadow shape remain valid and unchanged on disk:

```json
{
  "effects": {
    "outerShadow": {
      "enabled": true,
      "offsetX": 0,
      "offsetY": 12,
      "blur": 24,
      "spread": 0,
      "color": "#000000",
      "opacity": 0.35
    }
  }
}
```

Core and renderer project that value as one effect with the reserved ID `legacy-outer-shadow`. Merely opening, rendering, exporting, or inspecting the node never migrates it. The first explicit effects edit serializes the projected shadow and the requested edit as a normal ordered stack. Undo restores the exact legacy value. No workspace migration, API-version change, or destructive rewrite is required.

Older clients may continue reading and writing the legacy single-shadow form. They cannot safely edit a stack they do not understand and must preserve it rather than flattening it. Current strict schemas reject mixed legacy/stack shapes and duplicate effect IDs.

## Renderer and resource contract

- Preview and export use the same Pixi implementation and exact canvas dimensions.
- The Chromium worker stays persistent, while each canonical preview/export uses an isolated WebGL renderer. This prevents one frame's filter resources from altering later output and keeps repeated golden renders deterministic.
- Effect intermediates are node-owned generated textures. Reconciliation releases replaced resources deterministically and does not recreate unrelated nodes.
- Inner effects and overlays are clipped by the source alpha; outer effects render behind it.
- Spread and blur are bounded by public schema limits. Outer-only effect changes may use the existing safe-leaf effect reconciliation; alpha-masked inner effects and overlays conservatively rebuild the frame. Unsafe grouped/masked/composited cases retain the proven full-build fallback.
- The renderer never substitutes an unsupported effect or silently drops a stable field.

## Deliberate limits

V1 does not include bevel/emboss, liquify, arbitrary shader code, raster brush effects, blend modes per effect, or cross-node effect references. Color overlay is solid-only; gradient overlay is linear/radial. Adding a new effect type must update the TypeScript union, Zod schema, Studio editor, renderer switch, tests, and documentation; exhaustive switches fail compilation until handling is complete.

## Rollback

Normal frame undo/history restores the preceding stack or exact legacy single-shadow shape. A release rollback needs no workspace downgrade because product `1.0.0`, API `1`, and workspace schema `1` remain unchanged; however, an older client must preserve unknown stack data and should be treated as read-only for affected nodes.
