# Core Design Judgment

Use this model before making a new visual direction. It teaches task-time judgment; installing it does not retrain model weights or create durable taste by itself.

## The seven layers

Work in this order:

1. **Intent:** what must the design accomplish for whom, where, and with what action?
2. **Content:** what must be seen, understood, remembered, and acted upon?
3. **Structure:** how are elements grouped, ordered, aligned, scaled, and positioned?
4. **Expression:** which typography, color, imagery, shape, and material treatment fit the intent?
5. **Perception:** what is actually noticed first, second, and third in the render?
6. **System:** which Brand and campaign relationships must remain consistent?
7. **Production:** will the supported export reproduce correctly in its stated context?

Weak design often starts at expression. Start at intent and validate all seven layers.

## Represent meaning and geometry separately

For each consequential element, know both:

- its semantic role, priority, group, required status, and protected decisions; and
- its node ID, bounds, parent, z-order, alignment anchors, and spatial relationships.

Use canonical DesignBrief and DesignPlan records for durable semantics. Use the canonical frame for geometry and pixels. Do not create a second scene or intent model outside ADR.

## Separate invariants from variables

Typical invariants:

- approved copy and factual claims;
- official logos and protected Brand rules;
- legal, sponsor, or attribution requirements;
- exact output dimensions;
- explicit accessibility or production requirements;
- user-selected or protected human decisions.

Typical variables:

- layout archetype and crop;
- focal-point position and image-to-copy proportion;
- grouping, alignment, and spacing rhythm;
- type scale within approved roles;
- controlled color and accent behavior;
- optional ornament.

Never change an invariant merely because the current layout is inconvenient. Redesign the variable structure around it.

## Use two loops

Structural loop:

```text
brief -> hierarchy -> grayscale candidates -> rendered comparison -> selection
```

Refinement loop:

```text
style -> render -> inspect -> localize -> revise -> rerender
```

Do not use detailed styling to rescue a weak structure. Do not discard a successful structure because of one local defect.

## Record decisions without hidden reasoning

For consequential choices, record only auditable external evidence:

```text
Observation: what is visibly or canonically present?
Constraint: which brief, Brand, accessibility, or production condition applies?
Decision: what was selected or changed?
Test: what render or deterministic check will verify it?
```

Distinguish:

- verified fact;
- canonical project rule;
- design heuristic;
- aesthetic preference;
- bounded assumption.

Heuristics are starting points, not laws. Project evidence and user direction override them.

## Judge rendered output

Inspect the actual render because valid nodes and coordinates can still fail through font metrics, wrapping, saliency, optical imbalance, texture, rasterization, clipping, or reduced-size viewing.

Use distinct visual questions:

- Full size: are type, crop, edges, and effects resolved?
- Intended size: is the design readable in its real context?
- Thumbnail: does the primary idea survive lost detail?
- Grayscale or squint: do large masses preserve hierarchy?
- Edge scan: are there accidental tangencies or unsafe margins?
- Copy proof: does rendered text exactly match approved content?

Do not claim a test was performed unless its evidence was actually inspected.

## Avoid false precision

Treat dimensions, bounds, overlap, supported contrast cases, resolution, copy fidelity, and export settings as measurable when ADR has canonical evidence.

Treat tone, originality, optical balance, cultural fit, image quality, composition quality, and creative effectiveness as model-judged observations. Never turn them into objective findings or a release-authorizing score.

## Completion standard

A design is not complete merely because it renders. It is ready for user review only when:

- the requested communication is evident;
- canonical validation has no blockers;
- deterministic visual QA has been reviewed;
- heuristic concerns have been inspected in the render;
- relevant Brand and production assumptions are explicit; and
- the exact requested export is produced only after authorization.
