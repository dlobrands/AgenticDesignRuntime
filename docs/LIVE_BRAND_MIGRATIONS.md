# Live Brand Revision Migrations

Projects remain pinned to one exact immutable Brand Kit revision. A newer revision never changes a project automatically.

## Canonical contract

`migrateBrandKit` is a project-scoped semantic operation. It names an exact target `kitId`, positive `revision`, `contentHash`, and verified `resourceMap`. The target must belong to the currently pinned kit lineage and must differ from the current revision.

The project simulator compiles all current live palette, typography, effect, radius, canvas-spacing, and variable-mode bindings plus compatible component instances against that target. It preserves binding IDs, component instance/source IDs, declared active overrides, unrelated nodes, and unbound values. Every changed frame and the project pin are written through one journaled transaction. There is no per-frame partial commit path.

Migration stops before persistence when a required token, style, mode, or verified resource is missing; when a component changes source IDs, node types, or hierarchy; when a target override policy cannot represent an active override; or when ordinary canonical validation fails. Locked bound nodes remain protected and must be reviewed and unlocked explicitly before migration.

## Review and commit

Use `POST /api/projects/:projectId/brand-kit/migrate`, the typed client `migrateBrandKit`, or MCP `migrate_brand_kit_revision`. `mode: "preview"` returns the normal expiring transaction proposal with the exact pin diff and structured diffs for every affected frame. It does not mutate canonical project or frame state.

Studio selecting another revision in the pinned lineage opens this preview. The human must explicitly commit or discard it. Studio recomputes the exact target at the unchanged strict project revision during commit so newly required runtime-owned resources can be verified and copied safely; deterministic resource IDs keep preview and commit mappings stable. HTTP and MCP callers use the same preview-then-explicit-commit contract.

## Rollback

`POST /api/projects/:projectId/brand-kit/migration/rollback`, typed client `rollbackBrandMigration`, and MCP `rollback_brand_kit_migration` expose the exact project-history inverse only when the migration is the immediately preceding project mutation. Rollback is itself previewable and requires an explicit commit. It restores the prior pin, materialized bound values, binding metadata, modes, component metadata, and stable IDs through the same transaction engine.

Later unrelated project mutations deliberately make this convenience route unavailable; operators must first review history rather than silently undoing intervening work.

## Compatibility

Product version `1.0.0`, runtime API version `1`, and workspace schema version `1` remain unchanged. The operation is additive. Existing immutable Brand Kit bytes and hashes are unchanged. Older clients can continue reading projects but must not rewrite binding/component-bearing frames they do not understand.
