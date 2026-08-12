# Semantic Role Tools

AgenticDesignRuntime exposes high-level DesignPlan role inspection and assignment without introducing a second state model. Roles remain fields inside the canonical schema-1 project DesignPlan. Assignment compiles to one existing project-scope `setDesignPlan` operation and uses the normal runtime preview, trusted identity, validation, history, inverse, journal, and commit contracts.

## Inspection

`inspect_design_plan` returns one exact canonical DesignPlan. `inspect_design_roles` returns a read-only schema-1 role report with:

- stable plan, role, node, and copy IDs;
- target frame and current frame revision when available;
- `bound`, `unbound`, `missingTargetFrame`, or `missingNode` status;
- current canonical node name, type, effective visibility, and lock state;
- matching protected-decision IDs;
- total, bound, unbound, stale, and required-missing counts.

Inspection creates no transaction, preview, event, render, revision, or artifact. A later frame edit may stale a node binding; inspection reports that drift and does not block ordinary frame work or regenerate the role.

## Assignment

`assign_semantic_role` updates one existing role by stable `roleId`. `nodeId` is an exact canonical target-frame node ID; `null` detaches the node. Optional `copyItemId` sets an exact copy binding and `null` clears it. Omitting `copyItemId` preserves its current value.

The request requires the current project revision. MCP defaults to preview and returns the complete updated plan, post-change role inspection, and canonical transaction preview. Studio provides keyboard-accessible “Assign selected node” and “Detach node” actions, exact diff review, and explicit commit/discard.

Assignment preserves the plan ID, every role ID, all unrelated plan fields, canonical frame content, all node IDs, and rendered/exported bytes. A changed assignment invalidates any prior approval and returns the plan to `draft` with an audit note. A no-op assignment is rejected.

Role protections reject binding changes. Copy protections reject copy-binding changes. The normal `setDesignPlan` boundary also rejects stale project revisions, missing target frames/nodes/copy, invalid schema, or orphaned resources. Caller-supplied actor source never overrides runtime-issued provenance.

## API

- `GET /api/projects/:projectId/design-plans/:planId`
- `GET /api/projects/:projectId/design-plans/:planId/roles`
- `POST /api/projects/:projectId/design-plans/:planId/roles/:roleId/assignment`

The assignment body contains `baseRevision`, optional `mode`, actor label, `nodeId`, and optional `copyItemId`. The typed client exposes `inspectDesignPlan`, `inspectDesignRoles`, and `assignSemanticRole`. Direct MCP and workspace-aware plugin MCP expose `inspect_design_plan`, `inspect_design_roles`, and `assign_semantic_role` with matching legal inputs.

## Compatibility and rollback

This slice adds no canonical field, operation kind, migration, dependency upgrade, product-version change, runtime API-version change, or workspace-schema change. Older clients can continue reading the same DesignPlan through project inspection but do not expose the convenience routes/tools. A committed assignment has an exact previous-plan inverse and normal undo; discarding a preview changes nothing.
