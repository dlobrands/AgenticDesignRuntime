# Deterministic Visual QA

AgenticDesignRuntime exposes a read-only executable visual-quality audit for the current canonical frame. The audit does not preview, commit, regenerate, score, or mutate artwork. HTTP, the typed client, direct MCP, workspace-aware plugin MCP, and Studio return the same schema-1 report.

## Classification contract

Every returned finding has `classification: "deterministic"`, a stable fact-derived ID, a code, severity, exact affected node and semantic-role IDs, and optional measured details. The report also returns separate `unevaluated` entries for heuristic and model-judged categories. Those entries are not findings, do not affect counts, and must not be presented as objective scores.

V1 intentionally does not produce a composite “quality score.” A deterministic fact such as overlapping text bounds may be intentional; the report states the measured condition without claiming creative failure.

## Deterministic checks

The V1 audit detects:

- fixed-box text overflow measured by the canonical Chromium text path;
- low-resolution raster use from effective crop and displayed bounds;
- content outside the exact export canvas;
- frame node/complexity warning boundaries;
- exact duplicate visible text after whitespace/case normalization;
- intersecting visible text bounds;
- low contrast only when the text background is provably the opaque solid canvas and no earlier visible root content intersects it;
- required DesignPlan roles bound to missing canonical nodes;
- required role content hidden by its own or ancestor visibility/opacity;
- required role content clipped by the exact export canvas;
- required role content outside one unambiguous normalized DesignPlan safe area or canonical pixel safe area;
- exact required brief copy absent from its bound role or all visible text;
- concrete palette/text/stroke and typography binding drift against the project’s exact pinned immutable Brand Kit revision.

The audit reuses canonical validation results rather than duplicating text measurement, asset-resolution, canvas, or complexity rules.

## Explicitly unevaluated

V1 lists inconsistent margins, cluster alignment, irregular spacing, hierarchy quality, and logo misuse without machine-readable rules as heuristic checks. Mood fit, composition quality, and creative effectiveness are model-judged checks. Neither category runs in the deterministic endpoint.

Protected-node change detection requires a proposal/base-revision comparison and belongs to proposal QA rather than a current-frame-only audit. Brand checks that lack a concrete supported token value remain unevaluated rather than guessed.

## API and tools

`POST /api/projects/:projectId/frames/:frameId/visual-qa` accepts an optional strict `{ "planId": "uuid" }` body. An explicit plan must exist and target the requested frame. Omitting `planId` runs frame-only checks; no plan is selected implicitly.

The typed client method is `auditVisualQuality(projectId, frameId, planId?)`. MCP exposes `audit_visual_quality` with the same optional plan ID. Studio’s frame checks run the frame-only audit, while each compatible DesignPlan offers “Run deterministic visual QA” for plan/brief/Brand-aware checks.

The endpoint reads the current canonical frame, measured validation report, exact referenced brief, and exact pinned Brand Kit revision. It creates no transaction, preview, journal entry, history revision, render artifact, or event.

## Compatibility and rollback

This slice adds no canonical schema field, operation, migration, dependency upgrade, product-version change, runtime API-version change, or workspace-schema change. Older clients simply do not expose the endpoint/tool. Removing the endpoint and UI restores the previous behavior without rewriting workspace content.
