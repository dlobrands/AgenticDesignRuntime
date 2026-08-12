# DesignPlan Role Asset Replacement

`replace_role_asset` applies the exact asset assignment already stored for one canonical DesignPlan role. The tool does not accept an ad hoc asset ID because doing so would change artwork while silently leaving Plan intent behind. Agents first author or review the canonical Plan assignment, then preview its ordinary frame operations.

## Contract

The selected role must exist, bind to a current unlocked raster or SVG node, and have one declared `assetAssignments` entry. The compiler may emit only:

- `replaceAsset` with the declared canonical asset ID and fit; and
- `updateNode/crop` with `crop: null` when the declared assignment sets `preserveCrop: false` and the current raster has a crop.

Raster `stretch` maps to the existing canonical `fill` fit. SVG assignments replace only the asset because SVG nodes have no raster crop or fit state. Node IDs, transforms, hierarchy, visibility, paint, typography, effects, and every unrelated node remain unchanged.

## Review and protection

Replacement is preview-only. The current exact frame revision is required; stale requests fail before compilation. Studio exposes “Preview declared asset” only for roles that have a Plan assignment and then uses the existing rendered preview, structured operation list, commit, and discard controls.

Locked nodes produce no operation. Node or role protected decisions preserve the asset. Crop protections preserve crop even when the assignment requests a reset. Missing Plans, roles, bindings, nodes, assignments, or compatible node types return explicit failures or warnings; the runtime never chooses another asset or node.

Plan approval remains descriptive. Draft or proposed Plans produce a warning but can still create a review preview. Preview does not imply approval and never commits automatically.

## API parity

- `POST /api/projects/:projectId/frames/:frameId/design-plans/:planId/roles/:roleId/asset/preview`

The typed client exposes `replaceRoleAsset`. Direct MCP and workspace-aware plugin MCP expose `replace_role_asset` with matching inputs. The specialized compiler and general DesignPlan compiler have operation-parity tests for the same declared asset/crop intent.

## Compatibility and rollback

This slice adds one compilation warning code but no canonical field, operation kind, migration, dependency, product-version change, runtime API-version change, or workspace-schema change. Older clients retain the same Plan and asset contracts but lack the convenience route/tool. Discard changes nothing. Commit and undo use the existing frame history and exact inverses, restoring the prior asset, fit, and crop.
