# Canonical Project Templates

Project templates are reusable, project-scoped definitions for static-design systems. They capture ordinary scene nodes plus optional semantic slots, then compile into a normal `createNode` frame operation. Templates do not create a second document model, mutation authority, renderer path, or live link.

## Canonical state

`ProjectDocument.templates` is optional schema-1 metadata. Each definition has a stable UUID, unique project-local name, timestamps, one or more source root nodes, and up to 64 semantic slots. A definition may contain at most 499 total source nodes so the generated instance group remains within the 500-node frame limit.

The bounded slot roles are:

- `headline`
- `supportingCopy`
- `heroImage`
- `logo`
- `cta`
- `background`
- `badge`
- `legalCopy`

Each slot has a stable UUID, portable key, human-readable name, role, and exact source-node reference. Source node IDs, slot IDs, slot keys, and slot-to-node ownership are unique within a definition. Referenced project assets and fonts must exist when the definition is committed.

`setProjectTemplate` and `removeProjectTemplate` are project-scope operations with normal revision checks, trusted provenance, history, and exact inverse operations. Updating or removing a definition never rewrites an existing instance. Existing instances remain ordinary editable nodes; removal only prevents new application through that definition.

## Application

Application requires caller-generated stable UUID replacements for every source node, plus distinct instance and wrapper-group IDs. The runtime validates the complete map, clones the definition, remaps adjustment targets that point inside it, attaches semantic metadata, and submits one ordinary `createNode` operation to the canonical transaction engine.

The generated pass-through group and every generated descendant receive `templateInstance` metadata. Slot nodes also receive `templateSlot` metadata. Their visible scene properties are otherwise ordinary canonical properties. Humans can edit text, imagery, crop, effects, transforms, hierarchy, and all other supported properties without regeneration. Agents can inspect the slot role and source identity instead of guessing from layer names.

HTTP and the typed client expose the template-application route. Direct and workspace-aware MCP expose:

- `list_project_templates`
- `apply_project_template`
- `detach_project_template`

Agent application and detach default to preview. A preview must be reviewed and committed through the existing preview contract. Studio application is an explicit human command and commits one canonical revision.

## Studio capture and detach

Studio can capture selected top-level layers as a project template. Selected groups and masks retain their complete nested scene, and every nested node is available for semantic-slot assignment. Applying a definition selects the generated group. The Brand panel exposes slot identity for a selected layer and an explicit detach action for an instance.

Detach compiles into bounded `updateNode/templateMetadata` operations for the instance group and descendants. It removes only `templateInstance` and `templateSlot`; no visible property, node ID, hierarchy position, lock, asset binding, font binding, effect, or transform changes. Metadata-only detach is permitted through locked template ancestry without unlocking or weakening protection for any rendered edit. History inverses restore the exact metadata.

## Compatibility and rollback

Projects and frames without template fields remain valid schema-1 documents and are not eagerly rewritten. No product, runtime API, or workspace schema version changes. Older binaries do not understand the optional project definitions or node metadata and may reject or lose them when rewriting current documents, so runtime, Studio, typed client, MCP, and plugin packages must move together before mixed-version editing.

Project-operation undo restores a removed or replaced definition. Frame-operation undo removes an applied instance or restores detached metadata through normal history. Definition removal does not delete instances or assets. Rollback never regenerates visible artwork.

## Rejected alternatives

- A separate template mutation engine or template-owned renderer document.
- Live implicit propagation from a changed definition into existing instances.
- Reusing source IDs across instances.
- Executable template code or arbitrary semantic roles.
- Detach by flattening, rasterizing, regenerating, or replacing nodes.
- Silent asset or font substitution.
