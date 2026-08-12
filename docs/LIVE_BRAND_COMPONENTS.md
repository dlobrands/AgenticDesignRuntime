# Live Brand Components

Live Brand components are ordinary canonical scene nodes with stable identity tied to one exact immutable Brand Kit revision. They do not introduce a second scene model or mutation authority.

## Definition contract

- A reusable Brand definition with `kind: "component"` may declare `allowedOverrides` per source node.
- Override policies accept only the bounded canonical property vocabulary: visibility, transform, compositing, text content, typography, text box, fill, stroke, vector path, effects, radius, crop, and asset.
- Templates cannot declare component override policies and continue to instantiate as detached ordinary nodes.
- Override source IDs must exist in the definition, and source/property declarations must be unique.
- Existing Brand Kit records that omit `allowedOverrides` retain their prior bytes and content hash.

## Instance contract

Applying a component requires a fresh stable `instanceId` plus the existing complete source-to-canonical `idMap`. Each materialized node records:

- instance ID;
- exact kit ID, revision, and content hash;
- definition key and stable source-node ID;
- declared allowed properties;
- properties currently overridden.

All visible values remain materialized in normal scene properties. Rendering and export never perform a mutable library lookup.

## Controlled editing

- A declared visual edit uses the existing `updateNode` or `replaceAsset` operation and records the property as overridden in the same canonical transaction.
- An undeclared visual edit fails validation and instructs the caller to detach first.
- Component hierarchy is controlled: create-inside, delete, duplicate, move, reorder, group, and ungroup operations require prior detach when they target component nodes.
- History inverses restore both the visible value and the previous override metadata.
- All normal locking, stale-revision, preview, conflict, and provenance rules still apply.

## Detach contract

`detach_brand_component` compiles metadata-only `updateNode` operations for every node in one instance. Preview and commit travel through the canonical frame transaction pipeline. Detach preserves visible values, stable node IDs, assets, hierarchy, bindings, and render bytes; undo restores exact component identity.

Studio exposes the exact definition/revision and current override list for a selected instance node, with an accessible detach action. HTTP callers may use the normal transaction endpoint, the typed client carries `instanceId` through Brand application, and MCP exposes explicit apply/detach tools.

## Compatible variants

Component definitions may opt into a named variant group. Every definition in one group must retain identical source IDs, node types, hierarchy, and included definitions. A reviewed variant switch:

- keeps every canonical instance node ID and hierarchy;
- resolves only from the exact pinned kit revision and verified resource map;
- updates materialized values that are not actively overridden;
- carries compatible active overrides forward;
- rejects a target that cannot represent an active override;
- records the target definition/group/key in canonical metadata;
- uses ordinary operations plus exact history inverses through the canonical transaction engine.

HTTP, typed client, MCP, and Studio expose preview-first switching. Studio keeps commit/discard explicit and does not select a newer kit revision implicitly.

## Compatibility and limitations

Product version `1.0.0`, runtime API version `1`, and workspace schema version `1` remain unchanged. The node metadata and definition policy are additive optional fields. Older strict binaries may reject or omit them and must not rewrite component-bearing frames or kits.

This contract does not yet implement cross-revision component migration or project-wide migration proposals. Project pins remain exact and never advance automatically.
