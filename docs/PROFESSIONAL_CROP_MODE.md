# Professional Crop Mode

Status: Phase 3 canonical contract, 2026-08-10. Runtime API `1`; workspace schema `1`.

Professional crop mode is a local Studio draft over the existing raster `fit` and normalized `crop` properties. It does not introduce a second document, mutation route, or asset derivative.

## Interaction contract

- Select a visible, unlocked raster layer and choose **Crop** on Canvas or **Crop on canvas** in Inspector.
- The layer bounds remain fixed. Drag the source, use arrow keys, or use Shift+arrow for a larger movement step.
- **Crop zoom** scales the visible source around its current focus. The normalized crop stays inside the imported asset and is bounded to a minimum two-percent source extent.
- **Reset** restores the full source within the fixed bounds. **Cancel** and Escape discard the local draft without a transaction. **Apply crop** submits at most one `updateNode/crop` transaction.
- Applying crop sets raster fit to `cover`. Stable node identity and unrelated properties are preserved.

The Canvas draws a rule-of-thirds grid and center target during the edit. Pointer and keyboard crop controls own their events; global layer shortcuts cannot create revisions while the crop surface has focus.

## Asset replacement and resolution

Crop coordinates are normalized to the source, so replacing an asset preserves the current focus rectangle when possible. Replacement does not silently reset crop or create a second crop revision.

Studio reports the effective cropped source pixels against the displayed layer size both during crop mode and in Inspector. Canonical validation emits `LOW_RESOLUTION_ASSET` using the same 75-percent threshold. The warning is informational; it does not alter the crop.

## Rendering, export, and compatibility

Pixi preview and canonical export use the same normalized crop before the raster fit calculation. Export remains the exact frame size. Phase 3 production coverage compares preview and exported PNG bytes after a crop and after focused asset replacement.

Existing schema-1 raster nodes with no crop remain valid and unchanged on load. Existing raw crop fields and reset remain available in Inspector. No migration or version bump is required. Normal history undo is the rollback path.

## Intentionally bounded behavior

V1 does not rotate crop bounds independently, warp pixels, persist its rule-of-thirds crop overlay, infer a subject, or destructively rewrite source assets. General frame guides are a separate canonical layout-aids contract. Source-focus inference for unrelated replacement aspect ratios remains future semantic-agent work; the current contract preserves normalized focus deterministically.
