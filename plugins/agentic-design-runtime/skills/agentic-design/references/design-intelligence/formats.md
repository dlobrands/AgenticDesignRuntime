# Format-Specific Design

Use this reference when context, platform, viewing distance, print use, or aspect-ratio adaptation changes the design decision.

## State the production context

Record exact pixel dimensions, aspect ratio, orientation, viewing duration and distance, likely device or material, safe areas and overlays, supported export format, alpha or matte intent, compression, and any authoritative provider specification.

Platform specifications and UI overlays can change. Verify current requirements when they affect delivery; do not rely on course defaults as current facts.

## ADR output boundary

ADR exports canonical PNG, JPEG, WebP, bounded SVG, and flattened generic ICC-managed process-CMYK PDF files. It does not certify PDF/X, spot colors, overprint, separations, editable PDF vectors, printer-specific proofing, live responsive behavior, keyboard access, or interactive target sizes.

ADR may create artwork intended for later print placement, but final print production must use the printer's specification and an appropriate prepress workflow. Do not label ADR's generic CMYK PDF “PDF/X certified” or claim unsupported production proof.

## Social feed graphics

Optimize for fast recognition at small mobile size:

- one dominant message;
- a strong large-mass silhouette;
- short display copy;
- subject and headline cooperation;
- conservative edge placement;
- consistent campaign identity.

Inspect inside the likely viewing context when available.

## Video thumbnails

Communicate the premise before title or description is read. Prefer one dominant face, object, or symbolic action; decisive foreground/background separation; and minimal high-impact text only when needed.

Avoid many equal-size subjects, sentence-length copy, tiny screenshots, unrelated effects, and textured low-contrast text. Evaluate at actual browse size.

## Digital advertisements

A common hierarchy is attention, value, proof, action, attribution. Verify claims, offer terms, CTA clarity, Brand attribution, placement-specific safe areas, file limits, and continuity with the destination.

Attention that misrepresents the offer is a failure.

## Presentation visuals

Use one primary point per frame, large type, strong contrast, limited copy, consistent recurring anchors, and simple data emphasis. Test at the expected room distance or video-call size.

Do not shrink a report page into a slide.

## Posters and signage

Prioritize distance recognition, a large-scale focal point, clear event or action information, high contrast, and simplified secondary detail. A desktop full-screen preview can exaggerate readability; inspect a reduced physical-size approximation.

## Editorial and sequential graphics

For carousels, explainers, or brochure-like sequences, maintain navigation, recurring anchors, image-caption relationships, page rhythm, and a narrative that progresses rather than repeats. Review the series as a system and each frame in isolation.

## Print-bound artwork

Before exporting raster artwork for placement into a print workflow, confirm the target physical size, effective PPI, bleed intent, safe area, and requested color handling. Common starting points such as 300 PPI or 3 mm bleed never override the provider specification.

Report what ADR verified and what remains for prepress. Never infer a profile, ink limit, dieline, fold, barcode requirement, or PDF standard.

## Recompose across formats

Preserve:

- primary message;
- Brand signature;
- focal subject;
- factual copy;
- essential action and attribution;
- type-role relationships.

Reconsider:

- crop and focal coordinates;
- line breaks;
- group order;
- image-to-copy proportion;
- density and optional P3 content;
- motif placement and safe zones.

Use explicit frame duplication/resizing and review updated Plan intent. Do not uniformly scale or silently resize the current frame.

## Format gate

- Exact dimensions and orientation are verified.
- Hierarchy fits the expected viewing duration and size.
- Critical content respects current safe areas and overlays.
- Every ratio is intentionally recomposed.
- Compression preserves text and edges.
- Export format, scale, alpha, quality, and matte intent are explicit.
- Unsupported print or interface checks are clearly handed off rather than claimed.
