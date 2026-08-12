# Native Vector Path Contract

Status: Phase 3 bounded V1 contract, 2026-08-10. Runtime API `1`; workspace schema `1`.

## Canonical representation

`vectorPath` is a normal canonical scene node. Its transform defines the path bounds and its commands use normalized coordinates from `0` to `1`, preserving geometry when the node is resized. The bounded command vocabulary is:

- `move` with a stable command ID and endpoint;
- `line` with a stable command ID and endpoint;
- `cubic` with a stable command ID, two controls, and endpoint;
- `close` with a stable command ID.

A path starts with `move`, contains 2–1024 commands, has at least one drawable segment, and has at least one fill or stroke. Multiple subpaths are valid. Fill and stroke use the same solid/linear/radial paint and dash contracts as canonical shapes. Vector paths may be normal layers or mask sources.

Creation and editing use existing `createNode` and `updateNode` transactions. Geometry is updated atomically through `propertyGroup: "vectorPath"`; fill, stroke, transform, compositing, effects, visibility, locking, naming, hierarchy, history, previews, conflicts, and exports keep their existing operation contracts. No vector-specific document or mutation authority exists.

## Studio behavior

Studio can create a bounded cubic path from the shared command registry. Inspector exposes every endpoint and cubic control as normalized numeric fields, retains command IDs, and supports adding line/cubic points, closing the path, and removing points when the result remains valid. These controls are the keyboard-accessible alternative to a future direct Canvas point tool. Fill, gradient, stroke, dash, effects, transform, hierarchy, and compositing use the existing professional controls.

Each completed point or structure edit submits one canonical revision. Invalid paths are rejected by the normal request schema and simulator; Studio never writes renderer state directly.

## Compatible SVG conversion

Every imported SVG still passes the existing active-content and external-reference security policy and is preserved as an asset. In addition, Studio places a single path as an editable `vectorPath` when conversion is exact within the bounded contract:

- exactly one untransformed `<path>` under the SVG root;
- `M/m`, `L/l`, `C/c`, and `Z/z` commands only;
- coordinates and cubic controls inside the declared viewBox;
- direct solid hexadecimal fill/stroke, opacity, width, dash, offset, and cap attributes;
- no style blocks, transforms, filters, masks, clip paths, even-odd fill, vector effects, or unsupported graphical structure.

Unsupported but safe SVGs remain ordinary immutable SVG asset layers. Conversion never approximates an unsupported command, silently drops paint, or makes a safe asset import fail. The source SVG asset remains in the project library even when Studio places the editable path.

## Rendering and export

Pixi traces native line and cubic commands in node-local coordinates. Dashed cubic strokes use a deterministic bounded subdivision for the dash path; solid strokes use the native curve. Fill and stroke gradients share the established node-local paint coordinate space. Preview and export use the same renderer and remain byte-identical in the production E2E fixture.

## Compatibility and rollback

This is an additive scene-node alternative and operation property group inside schema/API version 1. Existing schema-1 frames are unchanged and require no migration. New runtime/client/plugin packages understand the new alternative; older binaries must not open a workspace after a vector-path frame has been committed. Normal undo/history removes or restores the complete node and stable command IDs. SVG source assets are retained, so a user can delete the editable placement and place the original immutable SVG instead.

## Explicit limits

V1 does not include quadratic/arced paths, arbitrary SVG transforms/styles, editable gradients imported from SVG, boolean operations, variable-width strokes, arbitrary fill rules, a separate vector document, or SVG round-trip export. Those require explicit compatible semantics and proportional renderer/Studio tests before promotion.
