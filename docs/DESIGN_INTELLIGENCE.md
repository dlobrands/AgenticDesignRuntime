# Installed Design Intelligence

Agentic Design Runtime bundles one versioned design-intelligence curriculum under `$agentic-design` and three focused companion workflows: `$agentic-design-review`, `$agentic-brand-system`, and `$agentic-design-ops`. The skills share one MCP server and one canonical runtime; they separate triggers and success criteria without duplicating design state or curriculum.

## Purpose and boundary

The curriculum targets dependable junior-level judgment for static branded graphics. It teaches agents to translate intent into hierarchy and structure, compare rendered candidates when exploration is valuable, apply coherent typography/color/imagery/Brand systems, localize defects, and distinguish deterministic evidence from model judgment.

Installation supplies task-time instructions. It does not retrain model weights, create automatic durable taste, or authorize external publication. Project-specific Brand Kits, approved examples, human feedback, and repeated rendered comparison remain essential.

ADR produces canonical PNG, JPEG, WebP, bounded SVG, and generic ICC-managed process-CMYK PDF exports. The curriculum does not claim PDF/X, spot colors, overprint, separations, printer-specific proofing, responsive interface behavior, or other unsupported production conditions.

## One canonical workflow

The curriculum maps into existing ADR contracts:

```text
request
  -> canonical DesignBrief
  -> canonical DesignPlan
  -> rendered structural candidates when warranted
  -> rendered comparison
  -> commit one exact selected preview
  -> style and local revision previews
  -> canonical validation
  -> deterministic visual QA plus clearly labeled model critique
  -> authorized raster export
```

Agents must not create parallel brief, plan, layout, review, scene, or history files as an alternate authority. P0-P3 is planning shorthand mapped into canonical semantic roles and ordered content hierarchy. Layout intent uses canonical regions, anchors, safe areas, constraints, bindings, assignments, variants, and protected decisions.

## Progressive disclosure

The skill entrypoint carries only the doctrine that must affect every substantial design. Focused references cover:

- briefing and hierarchy;
- composition and layout;
- text on imagery;
- typography, color, and accessibility;
- imagery, graphics, and Brand systems;
- supported format behavior and production boundaries;
- structural patterns and common AI anti-patterns;
- rendered critique and local revision;
- contrastive examples and deliberate training;
- research provenance for maintainers.

The machine-readable `plugins/agentic-design-runtime/design-intelligence-manifest.json`, `tool-surface.json`, and `plugin-evals.json` declare curriculum, tool, and routing contracts. `scripts/validate-plugin.mjs` verifies all four skills, references, source/packed tool parity, and module files.

## Candidate exploration

For greenfield public or client-facing work with several defensible directions, the skill asks the agent to compare three structurally different grayscale candidates. Same-base transaction previews are preferred when their pixels are directly inspectable. When an agent cannot consume pending preview pixels, it creates separate candidate frames through normal preview/commit operations and renders each canonical frame instead of selecting from coordinates or diffs. Unselected frames remain available for review unless the user requests recoverable removal.

Exact recreations, user-selected directions, and bounded revisions skip this exploration when it adds no meaningful decision value.

## Quality classification

Canonical validation and `audit_visual_quality` remain the deterministic evidence boundary. Copy fidelity, supported geometry, role presence, overflow, supported contrast cases, Brand binding integrity, and export contracts may produce measured findings.

Hierarchy quality, composition, tone, originality, cultural fit, photographic local contrast, and creative effectiveness remain heuristic or model-judged unless a future bounded runtime contract measures them. The curriculum explicitly prohibits self-scored release approval and composite scores that conceal a failed gate.

## Packaging contract

`product-metadata.json` owns the curriculum version. Packed plugin compatibility metadata records that version and the SHA-256 of the design-intelligence manifest. The release manifest repeats both values, while the plugin archive checksum covers every module byte.

The normal source and packed validation gates must pass before a future approved release. Existing immutable release artifacts are never rewritten merely to add curriculum content.
