# Performance Evidence

## Scope

This document records measured performance evidence for the Phase 2 renderer and Studio architecture work. It separates deterministic Node-side planning/simulation measurements from production-browser rendering and export measurements. These results are evidence for the measured fixtures only; they are not a blanket 60 fps or GPU-memory claim.

## Reference environment

- Date: 2026-08-10
- Hardware: MacBook Pro (Mac15,6), Apple M3 Pro, 18 GB memory
- OS: macOS 26.5.2
- Architecture: arm64
- Shell Node: 23.10.0
- pnpm: 10.34.5

The repository accepts Node `>=22`, but release verification names Node 24.18.0 as its reference. The measurements below therefore do not establish reference-Node parity.

## Deterministic Node-side measurements

Command:

```bash
pnpm exec vitest run --config vitest.performance.config.ts --reporter=verbose --disableConsoleIntercept
```

All eight tests passed. Timings use 20 validation samples and 120 reconciliation-planning or drag-simulation samples.

| Fixture            | Measurement                          | p95 or elapsed |
| ------------------ | ------------------------------------ | -------------: |
| 50 ordinary nodes  | frame validation p95                 |       1.226 ms |
| 250 ordinary nodes | frame validation p95                 |       3.683 ms |
| 300 ordinary nodes | frame validation p95                 |       5.753 ms |
| 500 ordinary nodes | frame validation p95                 |      11.984 ms |
| 250 revisions      | canonical reconstruction elapsed     |      20.004 ms |
| 250 nodes          | transform reconciliation plan p95    |       0.736 ms |
| 250 nodes          | paint reconciliation plan p95        |       0.692 ms |
| 250 nodes          | hierarchy reconciliation plan p95    |       0.708 ms |
| 250 nodes          | semantic drag preview simulation p95 |       5.819 ms |

These measurements exercise validation, revision reconstruction, semantic simulation, and stable-ID reconciliation planning. They do not include Pixi drawing or browser layout.

## Production-browser 250-node workflow

Command:

```bash
pnpm exec playwright test --grep "250-node Studio open"
```

The fixture creates an isolated 1080×1350 frame with 250 rectangle nodes through the canonical transaction API, opens the production Studio build, applies external canonical transform and paint edits, observes event-driven reconciliation, and exports through the runtime export endpoint.

| Step                        |                     Reconciliation |  Render | Rebuilt | In-place | Result                |
| --------------------------- | ---------------------------------: | ------: | ------: | -------: | --------------------- |
| Initial 250-node frame open |                            27.7 ms | 14.4 ms |     250 |        0 | full build            |
| One transform edit          |                             1.7 ms |  0.1 ms |       0 |        1 | incremental           |
| One paint edit              |                             3.3 ms |  1.6 ms |       1 |        0 | incremental           |
| 1080×1350 export            | 487.6 ms request / 469.2 ms worker |       — |       — |        — | 1080×1350 PNG written |

The measured inspector-equivalent paint preview is below the Phase 2 reference target of 50 ms, and the export is below the 2 second reference target on this machine. The test asserts semantic dirty categories, rebuild counts, exact export dimensions, revisioned export path, and bounded timing; it does not merely assert that a file exists.

Playwright writes `performance-250.json` and `performance-250.png` into the test result directory for the run.

## Text, masks, switching, and event burst

The same isolated production fixture imports the pinned IBM Plex Sans test font, creates an in-memory 2048×2048 raster through the runtime package's existing Sharp dependency, and builds a second 1080×1350 frame with the cropped raster, one fixed text box, and twelve masked tiles. It alternates alpha/luminance modes and inverted masks, switches between frames and projects, repeats asset-bearing frame round trips, and then applies twenty sequential canonical external commits while Studio remains connected. The synthetic raster exists only in the temporary test workspace and is not committed.

| Workflow                                      | Measured duration |
| --------------------------------------------- | ----------------: |
| Text-aware canonical validation               |            8.8 ms |
| Twelve-mask plus 2048px raster preview render |          778.1 ms |
| Switch to text/mask/raster frame              |           37.8 ms |
| Switch back to 250-node frame                 |           22.1 ms |
| Five asset-bearing frame round trips          |         1026.7 ms |
| Primary/performance project round trip        |          283.8 ms |
| Twenty-commit WebSocket propagation burst     |         1929.4 ms |

The validation result is semantically valid, the complex render is a nontrivial PNG, switches reach exact canonical revisions, and the event burst reaches revision 23. Active imported-asset texture count is exactly one on the complex frame and zero on the 250-node frame for every round trip. The renderer explicitly calls Pixi `Assets.unload` for URLs no longer referenced by the next frame. These assertions exercise the real Chromium text measurer, Pixi masks/assets, Studio navigation, runtime event synchronization, canonical reload epochs, and stable-ID reconciliation.

## Resource evidence

- Repeated gradient, stroke, and shadow preview replacements retain exactly two active node-owned generated textures; no growth was observed across that sequence.
- Five repeated complex/ordinary frame round trips retain exactly one imported asset texture on the asset frame and zero after leaving it; stale URLs are unloaded through Pixi Assets.
- A stable hierarchy reorder rebuilds zero nodes.
- A paint change inside an isolated opacity group rebuilds one leaf and invalidates one group cache.
- Imported shared asset textures remain under Pixi Assets ownership; node replacement destroys only node-owned generated textures.

## Targets not yet proven

- Sustained 60 fps drag/resize at 250 nodes on the repository's reference Node/platform combination.
- Browser workflows have representative bounded runs rather than statistically sampled p95 distributions. Node-side validation, planning, and drag simulation do report sampled p95.
- External GPU-profiler allocation totals. Application-level imported/generated texture ownership and repeated-switch bounds are instrumented and verified, but no external GPU trace was captured.
- Windows and Linux measurements.
- Before/after comparisons against a retained pre-reconciliation production build. Current evidence establishes absolute post-change behavior and semantic work avoided, not a historical speedup ratio.

Those gaps remain open Phase 2 work and must not be represented as completed performance exit criteria.
