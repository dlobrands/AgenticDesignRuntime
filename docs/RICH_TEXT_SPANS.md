# Rich Text Span Contract

AgenticDesignRuntime V1 keeps `TextNode.text` as the canonical plain-content field and adds optional `TextNode.spans` for bounded inline styling. Plain text remains the simplest agent and human authoring path. Rich text does not introduce a second document model, mutation authority, renderer, or history stream.

## Canonical shape

Each span contains:

- a stable, portable ID scoped to its text node;
- UTF-16 `start` and `end` offsets into `TextNode.text`;
- optional font ID, size, weight, style, color, opacity, tracking, baseline shift, and decoration overrides.

When `spans` exists, one to 256 ordered spans must cover the complete non-empty text without gaps or overlap. Ranges cannot split a UTF-16 surrogate pair. Paragraph alignment, vertical alignment, line height, and fallback values remain in `TextNode.typography`.

## V1 compatibility and migration

Existing schema-1 files need no destructive migration. A legacy text node without `spans` deterministically projects to one effective empty-style span over the complete text. The projection ID is derived from the node ID and range and is stable across repeated reads. It is persisted only when a range receives rich formatting.

This is an additive schema-1 evolution:

- missing `spans` means plain text;
- a `textContent` operation with an explicit span array replaces text and spans atomically;
- an explicit `spans: null` flattens the node to paragraph typography without changing its text;
- an older client that changes `text` without sending `spans` triggers deterministic prefix/suffix reconciliation, preserving surrounding run styles and identities where possible;
- empty text never retains spans.

Rollback is explicit flattening or the normal canonical undo/history path. No workspace-wide rewrite is required.

## Mutation, conflicts, and external files

Rich formatting uses the existing frame-scoped `updateNode/textContent` operation. One completed direct edit remains one revision. Semantic analysis tracks `node:<id>.text` and `node:<id>.spans` separately from paragraph typography. Concurrent paragraph-style and rich-span edits can rebase when disjoint; concurrent span edits require review.

External canonical-file changes convert text and spans into one normal typed operation. History inverses restore the exact prior text and span state. Brand definitions validate and remap fonts referenced by both paragraph typography and spans.

## Studio behavior

F2, direct double-press, and the visible Canvas edit control open the same draft session. A selected text range can edit every stable span property. The Canvas shows the current UTF-16 range and keeps all formatting local until Save or Command/Control+Enter. Escape cancels. Inspector lists the canonical spans and offers explicit flattening.

Plain textarea edits on a rich node preserve spans through deterministic reconciliation. Formatting never creates per-keystroke revisions or writes around the authenticated transaction client.

## Rendering, measurement, and export

The Pixi renderer resolves spans against paragraph defaults, lays out bounded word/character wrapping, applies alignment and vertical alignment, renders baseline shifts and decorations, and clips through the existing text-box contract. The same layout supplies auto-size and overflow measurement. Studio preview, render preview, and canonical PNG export use the same renderer and font registry.

The current bounded model intentionally excludes per-run line height, arbitrary HTML/CSS, executable content, bidirectional override controls, and OpenType feature toggles. Those require separate compatibility and deterministic-layout decisions.

## Evidence

Core tests cover legacy projection, range validation, surrogate safety, style application, stable identities, plain-client reconciliation, reversible operations, and semantic conflicts. Runtime tests cover external-file conversion. Renderer tests cover deterministic style resolution, wrapping, and newlines. Production E2E covers range formatting, two imported fonts, every supported span field, exact persistence, later plain editing, explicit flattening, stable node identity, and byte-identical preview/export.

- [Representative Studio state](./evidence/phase3-rich-text-studio.png)
- [Canonical 720x480 preview/export fixture](./evidence/phase3-rich-text-preview.png)
