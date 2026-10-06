# Roadmap

## v1

All v1 milestones are done; v1.0.0 is the release of M6.

| Milestone | Content | Done when | Status |
|---|---|---|---|
| **M0 Restructure** | Tag the Angular code as `v1-angular` (tag + branch), clear `master`, set up the Cargo and pnpm workspaces and CI skeleton | CI is green on an empty workspace; the legacy code is reachable from the tag | done |
| **M1 Parser** | `boardui-ipc2581`: streaming reader, typed model, units, dictionaries, stack-up | every sample parses; snapshot tests; the old TS parser serves as a cross-check on the consortium test cases | done |
| **M2 Geometry** | `boardui-geom`: regions, stroking, polarity, overlap resolution, holes, slots, extrusion, triangulation | property tests for no overlap, closed prisms and contiguity pass; hand-written samples produce the expected areas | done |
| **M3 Converter CLI** | `boardui-gltf`, `boardui-convert`, `boardui convert` / `validate`, placeholder bodies, `--models` | all samples convert, pass the Khronos validator and `boardui validate`, and look right next to `kicad-cli pcb export glb` | done |
| **M4 Viewer** | `<board-viewer>`: load, orbit/pan/zoom, top/bottom views, layer toggles, hover/select via the state texture, net highlight, x-ray | performance targets below met on `testcase1` | done |
| **M5 Browser and widgets** | `boardui-wasm`, `@boardui/converter` worker, widget API, demo app (drop a file, convert locally, view, download) | the demo converts every sample in the browser; widgets follow their elements | done |
| **M6 Release** | docs, CLI binaries on GitHub Releases, demo on GitHub Pages | v1.0.0 tag with release binaries; demo live at midub.github.io/boardui; issue #1 answered | done |

### Performance targets (verified in M4)

These are goals to measure against, not promises:

| Measure | Target |
|---|---|
| Native conversion, ~200k features | ≤ 10 s on a current laptop |
| WASM conversion, ~200k features | ≤ 30 s on a current laptop |
| Orbiting, outer layers visible | ≥ 60 fps on an integrated GPU at 1080p |
| Hover and highlight | visible in the next frame |

Measured in M5 on a VM without a GPU: a 238k-feature board converts in 3.7 s natively and in about 10 s as WebAssembly in Chromium. The frame rate on a GPU is still to be measured: open <https://midub.github.io/boardui/?sample=royalblue54l-feather&stats&spin>, or open `?stats&spin` and drop `testcase1`.

## v2 backlog

- Exploded layer view, cross-section (clipping plane), measuring
- `boardui inspect` (summary of a GLB), `boardui diff` (two revisions of a board)
- Multi-threaded WASM (requires cross-origin isolation)
- Parametric bodies for common packages
