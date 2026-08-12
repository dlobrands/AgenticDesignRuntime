# Export contract

AgenticDesignRuntime exports committed canonical frame revisions. Encoding is a derived artifact operation: it never changes a frame, project revision, scene node, or stable ID.

## Formats and dimensions

Supported raster formats are PNG, JPEG, and WebP. Export scale is bounded to 0.25×–4×. The pinned Pixi renderer extracts the canonical scene directly at the requested resolution; vector, text, paint, mask, and effect semantics are rendered at that resolution rather than upscaling a 1× bitmap. Output dimensions are exactly `round(canvas width × scale)` by `round(canvas height × scale)`. A request is blocked before rendering when either dimension exceeds the detected WebGL texture, renderbuffer, or configured canvas limit.

PNG is lossless and does not accept a quality value. JPEG and WebP accept integer quality 1–100 and default to 90. JPEG has no alpha channel; transparent canonical pixels are flattened against `matteColor`, defaulting to `#FFFFFF`. PNG and WebP retain alpha only when the canonical canvas background is transparent. The Studio states this eligibility before export.

After rendering and encoding, the runtime reopens the bytes and verifies format, dimensions, and required alpha behavior before an owner-only atomic write. The default 1× PNG remains byte-identical to `render-preview`.

## Artifact paths and collision behavior

The backward-compatible default path remains:

```text
exports/<frame-slug>-r<revision>.png
```

Scaled and lossy variants encode every setting that can change bytes:

```text
exports/<slug>-r<revision>-<scale>x-q<quality>.webp
exports/<slug>-r<revision>-<scale>x-q<quality>-m<rrggbb>.jpg
```

The `-<scale>x` segment is omitted at 1×. Repeating the exact same canonical revision and settings intentionally replaces the same derived artifact atomically. Different formats, scales, quality values, and JPEG mattes cannot silently collide.

## Named presets

Named presets are optional canonical project metadata under `exportPresets`. Each preset has a stable UUID, unique human-readable name, format, scale, optional lossy quality, and optional JPEG matte. `setExportPreset` and `removeExportPreset` are project-scope operations with normal validation, history, inverse operations, revision checks, trusted actor provenance, HTTP/MCP parity, and Studio controls. Existing schema-1 projects without the field load unchanged; no eager migration is required.

Presets contain encoding settings only. Frame selection is intentionally per export so a saved preset cannot begin exporting newly added frames without an explicit choice.

## HTTP and typed client

Single-frame export remains backward compatible:

```http
POST /api/projects/:projectId/frames/:frameId/export
{}
```

The optional body accepts `format`, `scale`, `quality`, and `matteColor`. Omitting the body preserves exact 1× PNG behavior.

Multi-frame export uses:

```http
POST /api/projects/:projectId/export
{
  "frameIds": ["..."],
  "settings": { "format": "webp", "scale": 2, "quality": 86 }
}
```

Frame IDs must be unique. The runtime validates every frame and every scaled output limit before rendering begins. A validation or capacity failure writes no artifact. If an environmental render or filesystem failure occurs after earlier frames finish, the error reports the exact completed artifacts; canonical design state remains unchanged and retry is safe.

The typed client exposes `exportFrame(projectId, frameId, settings?)` and `exportProject(projectId, frameIds, settings?)`. MCP exposes matching `export_frame` and `export_project` tools.

## Deferred formats

SVG export is deferred until the runtime can reject or faithfully express every participating scene semantic; it will not label a rasterized scene as editable SVG. PDF remains deferred until a document, pagination, font embedding, and color-management contract is defined.
