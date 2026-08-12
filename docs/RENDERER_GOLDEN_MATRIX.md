# Renderer Golden Matrix

## Contract

Renderer coverage must prove meaningful visual or semantic outcomes. A test that only checks for a non-empty PNG is smoke coverage, not a golden. Deterministic algorithm fixtures use pinned hashes. Production-browser fixtures pin exact output where platform stability permits and compare preview/export bytes for parity.

No fixture in this matrix requires a committed binary image.

## Current matrix

| Capability                       | Deterministic golden                  | Production render           | Preview/export parity            | Status  |
| -------------------------------- | ------------------------------------- | --------------------------- | -------------------------------- | ------- |
| Solid fills                      | Included in all-blend pinned PNG      | Yes                         | Yes                              | Covered |
| Linear gradients                 | Pinned pixel hash                     | Yes                         | Yes in representative scene      | Covered |
| Radial gradients and focal point | Pinned pixel and production hashes    | Yes                         | Exact bytes                      | Covered |
| Per-stop opacity                 | Pinned pixel and production hashes    | Yes                         | Exact bytes                      | Covered |
| Gradient strokes                 | Pinned combined production PNG        | Yes                         | Exact bytes                      | Covered |
| Dashed strokes, offset, caps     | Pinned combined production PNG        | Yes                         | Exact bytes                      | Covered |
| All supported blend modes        | Pinned combined PNG hash              | Yes                         | Exact bytes                      | Covered |
| Pass-through and isolated groups | Pinned combined production PNG        | Yes                         | Exact bytes                      | Covered |
| Alpha masks                      | Pinned combined production PNG        | Yes                         | Exact bytes                      | Covered |
| Luminance and inverted masks     | Pinned combined production PNG        | Yes                         | Exact bytes                      | Covered |
| Nested masks                     | Pinned combined production PNG        | Yes                         | Exact bytes                      | Covered |
| Raster fit modes and crops       | Pinned combined production PNG        | Yes                         | Exact bytes                      | Covered |
| SVG assets                       | Pinned combined production PNG        | Yes                         | Exact bytes                      | Covered |
| Imported fonts                   | Pinned combined production PNG        | Yes                         | Exact bytes                      | Covered |
| Text wrapping and alignment      | Pinned combined production PNG        | Yes                         | Exact bytes                      | Covered |
| Vertical alignment               | Top/middle/bottom in pinned PNG       | Yes                         | Exact bytes                      | Covered |
| Outer shadow                     | Pinned combined production PNG        | Yes                         | Exact bytes                      | Covered |
| Adjustment combinations          | No pure hash                          | Yes in representative scene | Exact bytes                      | Covered |
| Nested transforms                | Pinned combined production PNG        | Yes                         | Exact bytes                      | Covered |
| Transparent backgrounds          | Pinned RGBA production PNG            | Yes                         | Exact bytes                      | Covered |
| `clipContent`                    | Exact dimensions and byte equivalence | Yes                         | Exact bytes across normalization | Covered |

## Pinned fixtures

### Gradient algorithms

`packages/renderer-pixi/test/gradient.visual.test.ts` pins:

- deterministic dithered linear-gradient raster;
- linear-sRGB interpolation bounds;
- per-stop opacity premultiplication;
- radial focal-point mapping.

### Every supported blend mode

`tests/e2e/studio.spec.ts` creates a stable 840×400 frame with overlapping source/destination pairs for every entry in `SUPPORTED_BLEND_MODES`. It asserts:

- exact canvas dimensions;
- one pinned SHA-256 for the combined PNG;
- byte-identical repeated renders;
- byte-identical preview and canonical export.

This fixture includes the custom registered darker-color, lighter-color, and hue paths and the deterministic dissolve path.

### Representative compositing scene

The production renderer fixture combines a dithered linear gradient, alpha mask, and adjustment layer in one canonical frame. It validates the scene and asserts byte-identical repeated preview and export output.

### Mask modes and transparency

The fixed 640×180 production fixture covers alpha, inverted alpha, luminance, and inverted luminance masks over dithered gradients on an explicitly transparent canvas. It pins the combined PNG SHA-256, asserts RGBA PNG color type, proves repeated renders are byte-identical, and proves canonical export equals preview.

### Professional static-design primitives

The fixed 720×540 production fixture pins SHA-256 `b04234aaf0f6060628929dab06731b2b3b09f473bee8be610f3e3cc5d1a10024`. It combines radial focal-point and per-stop opacity semantics, a gradient stroke, dashed round-cap stroke with offset, isolated and pass-through groups, an outer shadow, nested transforms, nested alpha/luminance masks, all four raster fit modes plus a crop, SVG rendering, and imported-font word wrapping with left/center/right and top/middle/bottom alignment. It asserts semantic validation, repeated-render identity, and canonical preview/export byte parity. Playwright attaches the rendered PNG as test evidence; the repository does not carry a binary snapshot.

## Change discipline

The proportional Phase 2 matrix is complete. Golden changes require an explained renderer-contract change and manual evidence review, not an automatic snapshot update. New renderer capabilities must add proportional semantic and pixel coverage rather than relying on these fixtures by analogy.
