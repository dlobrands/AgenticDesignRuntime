# Text on Imagery

Use this reference before placing text over, beside, or around meaningful imagery.

## Treat the image as semantic space

Map:

- faces, eyes, mouths, hands, products, labels, logos, and critical scene details;
- high-saliency, high-texture, strong-edge, dark, light, and quiet regions;
- gaze, motion, horizon, architecture, product edges, and perspective lines;
- crop-safe extension and likely platform overlay areas.

The fact that a rectangle is geometrically empty does not make it semantically safe.

## Protect important regions

Do not cover critical subjects unless occlusion is an explicit concept approved by the user. A protected face area should normally include hair, gaze space, and breathing room rather than only a tight facial box.

ADR does not currently claim automatic subject-mask detection. Record relevant protection through canonical Plan regions, constraints, roles, and protected decisions where supported, and verify the rendered placement visually.

## Compare candidate text zones

For each plausible region, compare:

- usable area;
- subject clearance;
- local contrast potential;
- texture and edge density;
- alignment with image geometry;
- reading-order fit;
- crop stability;
- distance from edges and platform overlays.

Use comparative reasoning rather than pretending an estimated score is objective. A region with more empty area may still be worse because it blocks gaze direction or produces an unstable crop.

## Respect directional energy

Gaze, movement, product angle, and architectural lines can direct attention toward copy or an action. Use that energy when it strengthens the narrative. Do not place text in gaze space when it feels like an obstruction.

## Verify local contrast

Average image color is not evidence. Individual glyphs can cross light and dark texture even when the overall image appears contrasting.

Inspect the weakest region behind each line at the actual output size and after relevant compression. ADR's deterministic audit reports contrast only when the background is provably supported; treat photographic and layered cases as visual review unless a future canonical pixel-analysis contract measures them.

## Use the least invasive remedy

When placement is unstable, try in this order:

1. Move the text to a quieter natural region.
2. Re-crop or reposition the image without harming the subject.
3. Change text color or weight within Brand rules.
4. Add one restrained, coherent local underlay.
5. Adjust image value or detail locally.
6. Separate image and copy into distinct fields.

Heavy shadow, thick outline, or glow is not a universal readability solution.

## Make underlays structural

An underlay should contain a semantic text group, use consistent padding, follow Brand shape language, create stable contrast, and avoid critical content. Prefer one coherent text field to several disconnected translucent patches.

## Shape the text block

Evaluate line count, line-length variation, rag shape, semantic phrase breaks, block width and height, and relationship to image geometry.

Avoid separating:

- articles or short prepositions without intent;
- names that should stay together;
- a number from its unit;
- a date from its month or year;
- a CTA verb from its object.

Adjust box width or planned line breaks before shrinking everything.

## Use image-led alignment carefully

Align or counter-align copy to a meaningful horizon, shoulder, product edge, table, shadow boundary, or architectural line. Use only a few axes so the typography retains its own system.

## Plan for adaptation

For each required ratio, preserve the subject and primary message while reconsidering crop, line breaks, group order, and text zone. Do not uniformly scale or center-crop the original composition.

## Rendered gate

- Critical subjects and labels remain recognizable.
- Text occupies a stable readable field.
- Subject and copy form one hierarchy rather than two competing focal points.
- Line breaks are semantically coherent.
- Underlays are purposeful and Brand-consistent.
- The placement survives intended size and reduced-size review.
- Every adaptation has been recomposed and rechecked.
