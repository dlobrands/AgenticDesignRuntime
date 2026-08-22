# Briefing and Content Hierarchy

Use this reference when translating a request into ADR's canonical DesignBrief and DesignPlan.

## Reduce the assignment to one communication sentence

```text
Help [audience] understand or feel [primary message] so they [desired action],
in [viewing context], while expressing [Brand qualities].
```

This is more useful than an appearance-only direction such as “modern and clean.” Store the substance in the canonical brief's objective, audience, context, constraints, hierarchy, and export intent; do not invent unsupported fields or maintain a parallel JSON brief.

## Establish one primary message

A design may contain many facts but should usually have one dominant communicative center: a benefit, launch, event, offer, topic, instruction, person, product, or number.

The logo is normally attribution rather than the primary message. A CTA usually follows comprehension unless immediate action is the concept.

## Inventory content before placement

For every required item, determine:

- exact approved content;
- canonical semantic role;
- priority and parent relationship;
- required or optional status;
- relevant copy item, node, asset, or Brand binding;
- whether the user has protected its content, crop, position, or hierarchy;
- factual, legal, accessibility, or production risk.

Use stable canonical IDs. Do not treat repeated wording in a prompt as separate content unless the design actually needs both instances.

## Use P0-P3 as a planning shorthand

P0 is the one dominant message or unified subject-message group. P1 provides what is needed to understand it. P2 supplies action, evidence, or useful detail. P3 is attribution, legal copy, metadata, or optional ornament.

ADR stores ordered `contentHierarchy.priority` values rather than P0-P3 labels. Map the shorthand into a strict priority order and parent relationships. Priority controls perceptual emphasis, not whether mandatory content may be omitted.

When everything is emphasized, hierarchy has failed.

## Map hierarchy into visual variables

Express priority through a controlled subset of:

- scale;
- luminance contrast;
- position and isolation;
- whitespace;
- weight or width;
- image saliency;
- color intensity;
- depth or repetition.

Do not maximize all variables on the same element. A strong headline may be large and isolated without also being uppercase, outlined, shadowed, and brightly saturated.

## Declare the reading order

Write the intended sequence explicitly, then verify that rendered perception supports it.

Example:

```text
1. product or subject
2. primary benefit
3. supporting proof
4. action
5. attribution or legal
```

Do not assume a universal Z or F pattern. Language direction, density, medium, image motion, and viewing duration change scan behavior.

## Group by meaning

Related items should normally be closer than unrelated items. Similar spacing should represent similar relationships.

A useful starting relationship is:

```text
intergroup gap = 1.5 to 3 times intragroup gap
```

Treat this as a heuristic. Type size, grid, density, and Brand rhythm override it.

## Match density to context

- Fast glance: reduce visible roles and preserve only the dominant message, essential support, and attribution.
- Moderate attention: allow a short explanation, action, and limited evidence.
- Sustained reading: use navigation, hierarchy, columns, captions, and repeated page logic rather than one poster-like focal treatment.

Never delete required evidence or legal content merely to look minimal. Subordinate or restructure it.

## Resolve conflicts in this order

Unless the user or applicable specification says otherwise:

1. factual and legal accuracy;
2. explicit user direction and protected decisions;
3. core communication objective;
4. accessibility and legibility;
5. mandatory Brand rules;
6. format and production requirements;
7. content hierarchy;
8. aesthetic preference and novelty.

## Brief gate

Before detailed styling, the agent should know or have recorded a bounded assumption for:

- audience and context;
- one primary message;
- desired action or response;
- exact pixel dimensions and supported export;
- required and optional copy;
- required assets and Brand context;
- content hierarchy;
- accessibility requirements;
- material production assumptions.

Ask only when a missing answer would materially change the deliverable. Otherwise proceed with an explicit reversible assumption.
