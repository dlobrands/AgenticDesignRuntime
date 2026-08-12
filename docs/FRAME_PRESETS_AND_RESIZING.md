# Frame Presets and Resizing

Status: Phase 3 static-marketing contract, 2026-08-10. Product `1.0.0`; runtime API `1`; workspace schema `1`.

## Marketing presets

Studio provides exact-size presets for:

- Instagram portrait — 1080×1350
- Instagram square — 1080×1080
- Story / Reel — 1080×1920
- YouTube thumbnail — 1280×720
- LinkedIn landscape — 1200×627
- LinkedIn square — 1200×1200
- Poster portrait — 1800×2400

Selecting a preset fills ordinary width and height values. A new frame remains a normal canonical frame without a hidden template or permanent preset dependency.

## Resize constraints

Every ordinary node may optionally store horizontal and vertical resize constraints. Horizontal values are `left`, `center`, `right`, `stretch`, or `scale`. Vertical values are `top`, `middle`, `bottom`, `stretch`, or `scale`.

Absent constraints mean `left` and `top`. Studio edits the optional property explicitly through the canonical `updateNode/resizeConstraints` property group. Constraints apply to top-level layers during frame resize; nested values remain canonical and visible for future container reflow.

## Resize behavior

Studio offers three explicit strategies:

- **Honor layer constraints** repositions or stretches each top-level layer from its stored constraints.
- **Scale composition** proportionally changes top-level positions and scale factors on each axis.
- **Resize canvas only** changes the canvas while preserving layer transforms.

Existing-frame resize compiles to one frame-scoped transaction containing `setCanvas` and the exact affected `updateNode/transform` operations. This makes the semantic footprint, diff, inverse, history, and conflict result inspectable. Existing guides and safe-area insets are clamped inside smaller dimensions in the same transaction. Locked top-level layers block scale or constrained reflow; canvas-only resize remains available.

## Duplicate and resize

The existing project-scoped `duplicateFrame` operation accepts an optional bounded `resize` object with `width`, `height`, and `strategy`. The runtime clones the source frame, preserves stable node IDs within the new frame, applies the same deterministic resize calculation, creates one baseline, and commits one project revision. The source frame is unchanged. Undo removes the new frame through the normal retained-history contract.

## Compatibility and rollback

Legacy schema-1 nodes omit `resizeConstraints` and remain valid. Current packages treat omission as left/top without rewriting the frame. Removing constraints restores exact field absence. Product, API, and workspace schema versions remain unchanged.

Older binaries do not understand the new optional node property and may reject or lose it when rewriting a frame. Runtime, client, Studio, MCP, and plugin packages should move together. Existing-frame rollback uses its normal inverse/history revision; duplicate rollback removes the new frame without modifying its source.

## Bounded V1 limitations

Constraint math operates on canonical top-level transform coordinates, not rotated visual edges. V1 does not provide breakpoint systems, auto-layout containers, text-baseline constraints, arbitrary multi-frame responsive rules, or semantic content reflow. Those require the later DesignPlan and live design-system contracts rather than hidden heuristics.
