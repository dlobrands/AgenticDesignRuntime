---
name: agentic-brand-system
description: Manage exact-version Brand Libraries in Agentic Design Runtime. Use to create, inspect, pin, apply, audit, migrate, or roll back Brand Kits; manage live token bindings; or switch and detach Brand components. Do not use for ordinary artwork edits that do not change Brand governance.
---

# Agentic Brand System

Manage Brand state only through the runtime's exact-pin, preview-first contracts. Never select a newest kit implicitly, rebuild a component to simulate a variant, or edit Brand files and project manifests directly.

Read [brand-operations.md](references/brand-operations.md) before the first Brand mutation. For Brand strategy or visual grammar, read [imagery-brand.md](../agentic-design/references/design-intelligence/imagery-brand.md) without turning heuristic guidance into automatic governance.

## Required sequence

1. Resolve the exact workspace and inspect the project revision, Brand pin, kit revision, resources, and affected frames.
2. Preview one bounded operation at the current project or frame revision.
3. Review the complete diff, warnings, resources, protected nodes, bindings, and rendered output.
4. Commit the exact stored preview or the tool's explicit commit mode only after review.
5. Reinspect the canonical project and affected frames. For migrations, confirm every binding and component remained on the exact requested lineage.

Treat `audit_brand_system` as read-only. Never mutate artwork merely to reduce informational unbound-token findings. Use `rollback_brand_kit_migration` only as the immediately following explicit inverse; otherwise create a new reviewed forward migration.
