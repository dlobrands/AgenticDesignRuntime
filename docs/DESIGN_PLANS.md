# Canonical Design Plans

DesignPlans are bounded, non-executable project planning records. They translate a DesignBrief or standalone objective into explicit semantic roles, hierarchy, layout intent, constraints, bindings, variants, protected human decisions, and approval state. A plan is not scene state and does not mutate artwork. Only the later intent compiler may translate an approved plan into separately inspectable ordinary operations and a normal transaction preview.

## Canonical contract

`ProjectDocument.designPlans` is optional schema-1 metadata. A plan has a stable UUID, timestamps, optional brief and target-frame references, and contains:

- stable semantic-role instances with portable keys, bounded role types, and optional node/copy bindings;
- explicit content hierarchy and priorities;
- normalized layout regions, anchors, offsets, and safe areas;
- prioritized preserve, position, spacing, size, content, brand, and accessibility constraints;
- planned brand-token bindings and exact project asset assignments;
- ordered effect intentions using the supported bounded effect vocabulary;
- format-aware variant rules and per-role preserve/reflow/resize/hide behavior;
- protected node, role, copy, crop, hierarchy, brand-binding, and position decisions;
- draft, proposed, approved, or changes-requested approval state with bounded notes.

The schema is strict and non-executable. It rejects scripts, arbitrary keys, duplicate IDs or keys, missing role/region references, hierarchy cycles, invalid normalized regions and safe areas, impossible approval metadata, and duplicate project-local names. The runtime additionally rejects missing brief/copy, inactive frame, target-frame node, and asset references.

`setDesignPlan` and `removeDesignPlan` are project-scope operations. They use the existing project revision, preview, trusted identity, transaction, history, journal, recovery, and exact-inverse contracts. Workspace and frame requests reject them at request validation.

## Agent and human workflow

Direct and workspace-aware MCP expose:

- `list_design_plans`
- `create_design_plan`
- `remove_design_plan`
- `preview_design_plan`

Mutations default to preview and commit only through the existing review contract. The typed client exposes matching list, set, and remove methods. HTTP uses the canonical transaction endpoint and the same scope-specific operations.

Studio presents every stable plan field read-only in the Brand inspector. Authoring remains agent-first until a complete structured human workflow can preserve the whole bounded record without hidden normalization. Humans can inspect semantic roles, target bindings, layout, protections, variants, and approval state before any compiler is allowed to propose artwork changes.

The bounded compiler contract is documented in [DesignPlan Intent Compiler](./INTENT_COMPILER.md). It translates only fully parameterized intent into ordinary operations, preserves stable IDs and protected decisions, warns on stale or unsupported intent, and always returns through a separate canonical frame preview.

High-level role inspection and assignment are defined in [Semantic Role Tools](./SEMANTIC_ROLE_TOOLS.md). They update the existing plan through one normal preview-first `setDesignPlan`; they do not create a parallel role registry or mutate frame content.

Deterministic plan-wide layout and selected-role reflow are defined in [DesignPlan Layout and Reflow](./DESIGN_LAYOUT_SYSTEM.md). They compile only explicit normalized anchors and the supported global safe-area contract into ordinary reviewed frame operations.

Exact role-asset application is defined in [DesignPlan Role Asset Replacement](./ROLE_ASSET_REPLACEMENT.md). It compiles the canonical Plan assignment into reviewed existing asset/crop operations and never accepts undeclared replacement intent.

Exact pinned-Brand application is defined in [DesignPlan Brand Binding](./PLAN_BRAND_BINDINGS.md). It resolves only saved Plan bindings against the project's immutable Brand Kit pin and compiles supported palette/typography values into reviewed existing frame operations.

Deterministic same-format variant application is defined in [DesignPlan Variants](./DESIGN_VARIANTS.md). It compiles only saved preserve/hide/reflow/stretch-resize behavior and refuses partial application when the declared format differs from the current frame.

The final review boundary is defined in [Proposal Review Tools](./PROPOSAL_REVIEW_TOOLS.md). It exposes the exact expiring canonical preview as an ephemeral proposal without duplicating operations or creating a second commit authority.

## Compatibility and rollback

Existing projects without `designPlans` remain valid and are not eagerly rewritten. Product 1.0.0, runtime API 1, and workspace schema 1 remain unchanged. Updating a plan preserves its stable ID; undo restores the exact replaced or removed record. Plan-only revisions do not target frames and cannot alter rendered pixels or export dimensions.

Older strict binaries do not understand this optional project field and may reject or discard it when rewriting a newer project. Runtime, Studio, typed client, MCP, and plugin packages must move together before mixed-version editing.

## Rejected alternatives

- Executable plan code, prompts, scripts, CSS, or model-specific payloads.
- A plan-owned scene document, renderer path, or mutation engine.
- Automatically applying a plan when it is approved or updated.
- Free-form semantic roles or dangling canonical references.
- Silent node, copy, asset, token, crop, or hierarchy substitution.
- Treating approval as permission to bypass preview, validation, history, or conflict review.
- Claiming a plan has been fulfilled before the intent compiler produces inspectable operations and evidence.
