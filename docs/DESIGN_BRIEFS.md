# Canonical Design Briefs

Design briefs are bounded, non-executable project intent. They record what a design should achieve before an approved `DesignPlan` structures that intent and a separate reviewed compiler proposes ordinary canonical operations. Creating, updating, or removing a brief never mutates a frame, renders artwork, runs code, or establishes a second state model.

## Canonical contract

`ProjectDocument.designBriefs` is optional schema-1 metadata. A brief has a stable UUID and timestamps and contains:

- objective, audience, locale, context, and exact pixel format;
- required and optional copy with stable item IDs and bounded semantic roles;
- optional immutable Brand Kit revision intent and required token keys;
- asset and hierarchy requirements with bounded semantic roles;
- mood direction, avoided directions, and prioritized constraints;
- minimum contrast, accessibility requirements, and semantic reading order;
- one or more PNG, JPEG, or WebP export requirements with explicit scale, quality, matte, and transparency intent.

The schema is strict. Arbitrary keys, scripts, executable expressions, duplicate IDs, duplicate project-local names, unavailable referenced assets, and unavailable Brand Kit revisions are rejected. PNG cannot specify lossy quality, non-JPEG exports cannot specify a matte, and JPEG cannot require transparency.

`setDesignBrief` and `removeDesignBrief` are project-scope operations. They use the existing project revision, preview, trusted identity, transaction, history, journal, recovery, and exact-inverse contracts. Workspace and frame transactions reject them at request validation.

## Agent and human workflow

Direct and workspace-aware MCP expose:

- `list_design_briefs`
- `create_design_brief`
- `remove_design_brief`

Mutation tools default to preview. Review and commit through the existing preview contract. The typed client exposes matching list, set, and remove methods. HTTP accepts the same project operations through the canonical transaction endpoint.

Studio presents every stable brief field read-only in the Brand inspector. Brief authoring remains agent-first for this slice because Studio does not yet have a safe structured authoring workflow; humans can inspect the exact intent and canonical history without receiving hidden project state. DesignPlans may reference exact brief/copy IDs, but an intent compiler may consume them only through a later explicit preview and review contract.

## Compatibility and rollback

Existing projects without `designBriefs` remain valid and are not eagerly rewritten. No API, workspace-schema, runtime, or product version changes. Updating a brief preserves its stable ID. Project undo restores the exact replaced or removed object. Since brief transactions do not target frames, rollback cannot regenerate or alter artwork.

Older binaries do not understand this optional project field and may reject or discard it if they rewrite a newer project. Runtime, Studio, typed client, MCP, and plugin packages therefore need to move together before mixed-version editing.

## Rejected alternatives

- Storing prompts, arbitrary executable code, or model-specific payloads.
- Treating a brief as a scene document or allowing it to bypass transactions.
- Automatically regenerating a frame when a brief changes.
- Free-form semantic roles that cannot be validated across clients.
- Silent Brand Kit, asset, format, transparency, or export substitution.
- Claiming heuristic or model judgement is part of this deterministic intent record.
