# Typography, Color, and Accessibility

Use this reference when defining or reviewing the expressive system after spatial structure is sound.

## Define type roles before individual text styling

Typical roles include display, headline, support, body, label, CTA, metadata, caption, and legal. A role may define family, font resource, weight, size, line height, tracking, case, color, maximum measure, and alignment behavior.

Use canonical Brand Kit type roles and live bindings when available. Do not independently style every text node.

## Limit visible roles and families

Most single-frame graphics need roughly three to five visible roles. One family with several real cuts can be complete. Two families can create useful functional contrast. Add more only when the approved Brand system requires them.

Do not count a logo wordmark as a type family. Do not use faux bold, faux italic, horizontal distortion, or early rasterization of editable text.

## Build a type scale, then adjust optically

A restrained modular ratio can establish relationships, but the rendered typeface, content length, and canvas decide the final values. Preserve clear role differences without changing every variable at once.

Display type may use tight leading when glyphs remain clear. Supporting copy generally needs more. Sustained body copy needs the most. Treat numeric ranges as starting points rather than universal mandates.

## Control line shape

For display copy:

- break at phrase or clause boundaries;
- avoid accidental orphan words;
- keep names, dates, numbers, and units intact where meaning requires it;
- inspect the complete text block as a visual mass.

For left-aligned text, inspect the rag. Avoid repetitive stairs and alternating extreme line lengths. Change box width, size, or intentional breaks before distorting or over-tracking the type.

## Match alignment to reading behavior

- Left alignment is reliable for multi-line left-to-right reading.
- Centering suits short singular or ceremonial statements but weakens long copy.
- Right alignment can counter an image edge but needs careful rag control.
- Justification requires sufficient measure and spacing control.

Do not center everything by default.

## Handle utility text exactly

Verify punctuation, capitalization, names, dates, currency, decimals, phone numbers, URLs, legal symbols, and glyph availability. Use appropriate numeral behavior for data or display work. Canonical copy fidelity overrides typographic convenience.

## Treat color as roles

Define roles such as surface, primary text, secondary text, Brand primary, Brand secondary, accent, border, and semantic states. Use exact pinned Brand tokens and live bindings when available.

Build essential hierarchy in luminance before depending on hue. A compact palette often needs a dominant field, primary and secondary text values, one Brand color, and a controlled accent. This is a starting architecture, not a mandatory aesthetic.

## Use contrast types deliberately

Distinguish luminance, hue, saturation, temperature, scale, and surrounding-color effects. Different hues can still have insufficient luminance separation.

For applicable live digital text, WCAG 2.2 uses 4.5:1 for ordinary text and 3:1 for qualifying large text. Verify the actual supported rendered condition. For photographic, transparent, gradient, or textured backgrounds, inspect the weakest point rather than an average color.

Contrast thresholds are minimum gates, not proof of design quality.

## Do not encode meaning only with color

Add a label, icon, shape, position, line style, pattern, or text description. This matters for data graphics and interface-like visuals as well as marketing assets.

## Control saturation and imagery integration

Saturated regions attract attention. Reserve them for primary action, a key data point, or a defined campaign signature. Integrate image colors through selection, restrained grading, tinting, or isolation without making skin tones, products, or factual colors inaccurate.

Do not infer universal emotions from colors. Audience, culture, category, material, brightness, saturation, and Brand history change perception.

## Supported accessibility boundary

ADR can preserve semantic reading intent, report supported deterministic contrast cases, validate geometry, and export static raster assets. It does not certify every accessibility condition for a live interface or every photographic background. Report unsupported checks as unevaluated and route responsive or interactive implementation to an appropriate workflow.

## Rendered gate

- Copy is exact and no glyph is missing or substituted.
- One role is visibly dominant.
- Type roles are consistent and limited.
- Line breaks, rag, leading, tracking, and alignment support meaning.
- Text remains readable at intended size.
- Hierarchy survives reduced-size and grayscale inspection.
- Supported contrast requirements pass.
- Color roles and Brand bindings are correct.
- Important meaning does not rely on color alone.
