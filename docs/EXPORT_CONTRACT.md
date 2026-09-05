# Export contract

ADR exports derived artifacts from committed canonical frames without mutating artwork. Every export is revision-bound, collision-safe, owner-only, and written atomically after format-specific validation.

## Raster formats

PNG, JPEG, and WebP render the canonical Pixi scene directly at 0.25x-4x. PNG is lossless. JPEG and WebP accept quality 1-100 and default to 90. JPEG always flattens transparency against the explicit/default matte; PNG and WebP retain alpha only for transparent canonical canvases. Encoded bytes are reopened to verify format, dimensions, and alpha.

## SVG

SVG export has two explicit modes:

- `vectorOnly` emits native groups, solid shapes, plain unwrapped text, and bounded ADR vector paths. It fails before writing when raster layers, imported SVG layers, masks, adjustments, effects, non-normal blending, rich text, wrapping, or unsupported paints would make the document unfaithful.
- `hybrid` finds the highest unsupported root layer, embeds one exact raster of that layer and everything behind it, then emits every safe higher layer natively. It reports every rasterized node ID and whether the result is fully rasterized. This preserves compositing fidelity without mislabeling fallback content as editable vectors.

SVG output rejects scripts, external references, arbitrary CSS, unsafe filters, and unbounded executable content. Quadratic curves, elliptical arcs, and nonzero/even-odd fill intent round-trip through ADR's declared safe path subset.

## Generic CMYK PDF

PDF export produces one flattened process-CMYK page. It requires an explicitly imported project ICC profile verified by hash and ICC header/color-space checks. The runtime renders at 72-600 DPI, converts through the selected profile, embeds the four-channel ICCBased image, and writes exact MediaBox, TrimBox, BleedBox, profile ID/hash, optional 0-25 mm bleed, and optional crop marks.

This output is not PDF/X. ADR does not claim spot colors, overprint, separations, total-ink limits, editable PDF vectors, font embedding, printer-specific proofing, or guaranteed physical color match. Those unsupported conditions must be handed to the printer or a dedicated prepress workflow.

## Presets and API

Project export presets store stable ID, unique name, format, scale, and only the settings valid for that format. PDF presets additionally store DPI, ICC profile ID, bleed, and crop-mark intent; SVG presets store mode. Changing presets uses normal project transactions, history, inverses, and revision checks.

Single-frame and batch HTTP, typed-client, direct-MCP, plugin-MCP, and Studio routes share `ExportSettings`. Batch export preflights every selected frame and renderer limit. Environmental failure after a previous derived artifact finishes is reported precisely; canonical state never changes, and retrying identical settings is idempotent.

Artifact names include revision plus non-default scale/quality/matte, SVG mode, or PDF DPI/CMYK suffixes so byte-distinct settings cannot silently collide. The backward-compatible bodyless route remains the exact 1x PNG path.
