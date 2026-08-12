# Layout Aids Contract

Status: Phase 3 canonical contract, 2026-08-10. Runtime API `1`; workspace schema `1`.

Layout aids combine durable frame metadata for agent-human continuity with ephemeral Studio feedback for direct manipulation. They never become scene nodes, renderer content, or a second mutation authority.

## Persistent frame metadata

`frame.canvas.guides` is an optional list of at most 128 stable-ID guides:

```json
{
  "id": "uuid",
  "axis": "horizontal | vertical",
  "position": 240
}
```

A vertical guide stores an x coordinate; a horizontal guide stores a y coordinate. Positions are finite, non-negative, and inside the current canvas. IDs are unique within the frame.

`frame.canvas.safeArea` is an optional `{ top, right, bottom, left }` inset. Insets are finite and non-negative and must leave a positive interior region. Safe areas guide composition; they do not clip content.

Both properties change through the existing frame-scope `setCanvas` operation. They have exact inverse/history behavior and independent semantic conflict properties: `frame.canvas.guides` and `frame.canvas.safeArea`.

## Studio interaction

- Horizontal and vertical rulers surround the artboard. Drag from a ruler to create a guide; press Enter or Space on a focused ruler to create one at canvas center.
- Drag a guide to move it. A focused guide uses arrow keys for one-pixel movement, Shift+arrow for ten pixels, and Delete/Backspace to remove it.
- Inspector provides equivalent add, exact-position, remove, and safe-area inset controls.
- Guides, safe area, and snapping have explicit local visibility/toggle controls. Toggling them creates no revision.
- Canvas center lines remain a subtle local composition aid while snapping is enabled.

Guide pointer movement is an ephemeral draft. Pointer release submits one `setCanvas` revision. The guide grid, center lines, snap lines, and gap labels are DOM overlays and never enter the Pixi scene or export.

## Snapping and spacing

Move gestures evaluate selected left/center/right and top/middle/bottom anchors against:

- Canvas edges and center
- Persistent guides
- Other visible object edges and centers
- An equal-gap position between nearest non-overlapping peers

The closest candidate inside the zoom-adjusted seven-pixel threshold wins per axis, with guide and equal-spacing intent preferred for exact ties. Shift still constrains movement to one axis before snapping. Snapping can be disabled locally without changing canonical design state.

Snap lines and equal-gap brackets/values are ephemeral. The completed transform remains one normal `updateNode/transform` revision. Unrelated node IDs and properties are unchanged.

## Rendering and compatibility

Guide and safe-area metadata participates in canonical hashing, history, external diffing, and collaboration, but is excluded from renderer canvas comparison and pixels. A metadata-only revision performs no node rebuild and canonical preview bytes remain unchanged.

Legacy schema-1 frames without these optional fields remain valid and are not rewritten on load. Undo restores field absence exactly rather than normalizing it to an empty list. No workspace migration or version bump is required. Older binaries do not understand frames after new metadata is committed, so runtime, Studio, client, MCP, and plugin artifacts continue to move together.

Studio canvas resizing clamps guides and safe-area insets into the new bounds in the same transaction. Future preset/reflow workflows must preserve this invariant explicitly.
