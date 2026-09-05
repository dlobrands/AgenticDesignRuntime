---
name: agentic-design-review
description: Review an existing Agentic Design Runtime project without changing canonical artwork. Use for design critique, frame validation, deterministic visual QA, Brand audits, history inspection, revision comparison, or rendered evidence. Do not use when the user asks to implement revisions.
---

# Agentic Design Review

Inspect one explicit ADR workspace and return an evidence-backed report without mutation. Never call commit, create, remove, bind, migrate, import, or update tools during a review-only request.

## Review workflow

1. Resolve the exact workspace, project, frame, and current revision. Never select a workspace by recency when more than one exists.
2. Inspect the project, frame, relevant nodes, assets, fonts, and Plan or Brief only as needed.
3. Use `get_history`, `get_revision`, or `compare_revisions` when the question concerns change over time.
4. Run `validate_frame` and `audit_visual_quality`; pass the exact compatible Plan ID when Plan-bound findings matter.
5. Use `audit_brand_system` only for exact-pin Brand integrity. Informational unbound matches are review prompts, not defects.
6. Call `render_preview` and inspect actual pixels at delivery size and reduced size. Canonical data alone is not visual proof.

Read [visual-qa.md](../agentic-design/references/visual-qa.md) before reporting final findings. For visual hierarchy, composition, or creative critique, also read [critique.md](../agentic-design/references/design-intelligence/critique.md). Separate deterministic findings from model-judged observations and never manufacture an objective score.

Return findings by severity, cite exact frame/revision/node evidence, distinguish unsupported checks as unevaluated, and state explicitly that no canonical state changed.
