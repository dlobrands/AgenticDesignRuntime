# Native Vector Path Contract

Status: ADR v2 bounded contract, 2026-08-27. Runtime API `2`; workspace schema `2`.

## Canonical representation

`vectorPath` is a normal canonical scene node. Its transform defines the path bounds and its commands use normalized coordinates from `0` to `1`, preserving geometry when the node is resized. The bounded command vocabulary is:

- `move` with a stable command ID and endpoint;
- `line` with a stable command ID and endpoint;
- `cubic` with a stable command ID, two controls, and endpoint;
- `quadratic` with a stable command ID, control, and endpoint;
- `arc` with stable ID, normalized radii, rotation, large-arc/sweep flags, and endpoint;
- `close` with a stable command ID.

A path starts with `move`, contains 2–1024 commands, has at least one drawable segment, and has at least one fill or stroke. Multiple subpaths are valid. Fill and stroke use the same solid/linear/radial paint and dash contracts as canonical shapes. Vector paths may be normal layers or mask sources.

Creation and editing use existing `createNode` and `updateNode` transactions. Geometry is updated atomically through `propertyGroup: "vectorPath"`; fill, stroke, transform, compositing, effects, visibility, locking, naming, hierarchy, history, previews, conflicts, and exports keep their existing operation contracts. No vector-specific document or mutation authority exists.

## Studio behavior

Studio exposes every endpoint, quadratic/cubic control, arc radius/rotation/flags, and fill rule as keyboard-accessible fields. It retains command IDs and supports adding line, quadratic, cubic, and arc segments, closing paths, and removing points when the result remains valid.

Each completed point or structure edit submits one canonical revision. Invalid paths are rejected by the normal request schema and simulator; Studio never writes renderer state directly.

## Compatible SVG conversion

Every imported SVG still passes the existing active-content and external-reference security policy and is preserved as an asset. In addition, Studio places a single path as an editable `vectorPath` when conversion is exact within the bounded contract:

- exactly one untransformed `<path>` under the SVG root;
- `M/m`, `L/l`, `Q/q`, `C/c`, `A/a`, and `Z/z` commands only;
- coordinates and cubic controls inside the declared viewBox;
- direct solid hexadecimal fill/stroke, opacity, width, dash, offset, and cap attributes;
- direct nonzero/even-odd fill rules;
- no style blocks, arbitrary transforms, filters, masks, clip paths, vector effects, or unsupported graphical structure.

Unsupported but safe SVGs remain ordinary immutable SVG asset layers. Conversion never approximates an unsupported command, silently drops paint, or makes a safe asset import fail. The source SVG asset remains in the project library even when Studio places the editable path.

## Rendering and export

Pixi traces native line, quadratic, cubic, and SVG-style arc commands in node-local coordinates. Dashed curves use deterministic bounded subdivision. Vector-only SVG emits the declared safe subset; hybrid SVG records its conservative full-frame raster fallback explicitly.

## Compatibility and rollback

These fields are part of schema/API version 2. Schema-1 workspaces require the explicit stopped-workspace migration; older binaries must not edit schema-2 frames. Normal undo/history restores the exact command and fill-rule state, and source SVG assets remain available.

## Explicit limits

V2 still excludes arbitrary SVG CSS/paint servers/transforms, editable imported gradients, boolean operations, variable-width strokes, unrestricted SVG execution, and a separate vector document.
