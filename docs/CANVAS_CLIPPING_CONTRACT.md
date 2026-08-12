# Canvas Clipping Contract

## V1 contract

The canonical export rectangle is always exactly `canvas.width × canvas.height`. Studio preview and every raster export use the same exact rectangle. Content that extends beyond it is clipped and cannot expand export dimensions.

`canvas.clipContent: true` is the canonical V1 value.

`canvas.clipContent: false` remains readable so existing workspace-schema-1 frames do not require a migration. It is a deprecated compatibility value and has the same visible semantics as `true`: Studio preview and export clip to the exact canvas. Validation emits `CLIP_CONTENT_DEPRECATED`, Studio explains the behavior, and the **Normalize clipping** action writes `true` through a normal frame transaction.

This is explicit normalization, not an invisible renderer branch. The renderer does not claim to show overflow that its exact-size WebGL target cannot represent.

## Outside-artboard diagnostics

Any node whose world bounds extend even partly beyond the artboard receives `CONTENT_OUTSIDE_ARTBOARD`.

- With `clipContent: true`, the diagnostic states that the content is clipped in Studio and export.
- With legacy `clipContent: false`, the diagnostic states that the compatibility value does not preserve the content and that it remains clipped.

The diagnostic is a warning rather than a validation error because intentional bleed and partially off-canvas composition are valid design techniques. The warning makes export loss reviewable.

## Compatibility and rollback

- Runtime API version remains `1`.
- Workspace schema remains `1`.
- Existing `false` values remain parseable and are not rewritten at load time.
- Normalization creates one ordinary, reversible `setCanvas` revision.
- Undo restores the stored legacy value and its warning; visible output remains exact-canvas clipped.

## Future replacement

A future unclipped Studio pasteboard must introduce an explicit viewport-to-artboard transform, correct hit testing and selection overlays, resource bounds, accessibility behavior, and preview/export distinction. It must not change exact export dimensions or silently reinterpret existing frames. Until that complete contract exists, `false` will not pretend to expose pixels the renderer clips.
