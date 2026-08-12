# Visual QA

Inspect the actual PNG returned by `render_preview`; do not approve a design from transaction data alone.

Before delivery, verify:

- the composition matches the requested dimensions and platform;
- copy is exact, readable, correctly ordered, and free of overflow;
- hierarchy has one clear primary message and intentional supporting information;
- spacing, alignment, scale, and margins are coherent;
- colors, imagery, logos, and fonts match available client guidance;
- masks, crops, gradients, strokes, effects, and blend modes render as intended;
- no content is accidentally clipped, hidden, locked, or outside the canvas;
- raster assets are suitable for their displayed size;
- unchanged nodes remain semantically unchanged;
- `validate_frame` reports no blocking errors.

Run `audit_visual_quality` after canonical validation. Pass `planId` when a reviewed DesignPlan targets the frame so required roles, exact brief copy, normalized safe areas, and supported bindings are checked against current canonical state. Treat every returned finding as a deterministic measured condition, not a composite quality score. The report's `heuristic` and `modelJudged` entries are explicitly unevaluated; inspect the rendered preview yourself for those concerns and never describe them as automated objective findings.

If the preview is materially weak, revise it without waiting for the user to identify obvious defects. Keep decoration subordinate to communication.
