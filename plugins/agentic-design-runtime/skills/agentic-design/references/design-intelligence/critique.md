# Rendered Critique and Local Revision

Use this reference during requested critique, candidate selection, material revisions, and final review.

## Separate gates from judgment

Deterministic, factual, legal, Brand, accessibility, and production failures can block delivery. Heuristic or model-judged observations can guide revision but must not be presented as objective measurements.

ADR intentionally does not produce a composite quality score. Do not create a self-scored release threshold, call a model rating an audit result, or let an average override one blocking condition.

## Review in this order

1. Exact copy, facts, required content, and explicit user direction.
2. Canonical validation and deterministic visual-QA findings.
3. Five-second communication and primary message.
4. Hierarchy and large visual masses at reduced size.
5. Grouping, alignment, spacing, balance, and tangencies.
6. Typography and text shape.
7. Imagery, crop, protected content, and local readability.
8. Color, accessibility, Brand fit, and campaign coherence.
9. Supported export requirements and remaining handoff assumptions.
10. Minor optical polish.

This order prevents polishing a design that should be structurally rejected.

## Use localized evidence

For each material concern, report:

```text
Target: stable node or role ID, layer name, or visible region.
Observation: what is present in the canonical state or render.
Principle: which brief, Brand, spatial, typographic, or perceptual relationship applies.
Severity: blocker, major, minor, or optional exploration.
Fix: the smallest effective correction.
Verification: the exact render view or deterministic check to repeat.
Classification: deterministic or model-judged.
```

Do not use vague language such as “make it cleaner” or “the spacing feels off.” Describe the relationship: which gap, edge, group, line break, crop, or competing mass causes the issue.

## Severity

- **Blocker:** wrong copy, missing required content, clipped essential content, unreadable primary text, wrong dimensions, unsupported or misleading delivery claim, or an unresolved legal/rights issue.
- **Major:** reading order, hierarchy, crop, grouping, or Brand failure that prevents professional review readiness.
- **Minor:** localized polish that does not block comprehension or fidelity.
- **Optional exploration:** a defensible preference or alternate direction, not a defect.

Use “deterministic error” only when ADR or another authoritative source measured it. A model-judged composition concern can still be serious, but its classification must remain honest.

## Candidate comparison

Compare each candidate against the same brief:

- primary-message clarity;
- hierarchy and reading path;
- protected-zone and text-field safety;
- Brand distinction;
- adaptation path;
- production risk;
- unnecessary complexity.

State why the selected candidate wins and what tradeoff it accepts. Novelty is not its own justification.

## Visual inspection methods

- Delivery-size review for type, crop, edges, effects, and compression.
- Reduced-size or thumbnail review for primary idea and large-mass hierarchy.
- Grayscale or squint review for luminance structure.
- Edge scan for tangencies, clipping, and unsafe placement.
- Copy proof against the approved canonical Brief.
- Context preview when the real feed, slide, or placement is available.

Do not claim a five-second user test, preference test, or comprehension test occurred unless a person actually performed it. An agent may make a model-judged prediction and label it accordingly.

## Revise locally

Prefer:

- changing one line break rather than replacing the type system;
- moving one copy group rather than darkening the entire image;
- widening one intergroup gap rather than redistributing every node;
- reducing one competing accent rather than muting the whole palette;
- correcting one crop rather than replacing a suitable asset.

After every meaningful correction, render again and check for regressions in copy, wrapping, overlap, contrast, hierarchy, Brand bindings, and adaptations.

## Final review boundary

Before export:

- resolve canonical validation blockers;
- review all deterministic findings and warnings;
- inspect all explicitly unevaluated heuristic/model-judged categories that matter;
- confirm exact dimensions, supported format, scale, quality, alpha, and matte intent;
- state unresolved assumptions or external production handoffs;
- require the user's requested acceptance or export instruction.
