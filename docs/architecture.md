# Architecture and tech stack

boardui turns an IPC-2581 file into a glTF board ([profile spec](../spec/README.md)) and shows it in an interactive 3D viewer. There are two halves:

- **Converter (Rust):** IPC-2581 in, GLB out. It runs as a native CLI and as WebAssembly in the browser, so boards never have to be uploaded anywhere.
- **Viewer (TypeScript + three.js):** a framework-independent web component that loads a boardui GLB, highlights elements and hosts widgets.

```
IPC-2581 ──► boardui-ipc2581 ──► boardui-geom ──► boardui-gltf ──► board.glb ──► @boardui/viewer
  (XML)       typed model         2D regions,        profile writer,               <board-viewer>
                                  holes, prisms      metadata tables
                     └──────────── boardui-convert (pipeline) ────────────┘
                            ▲                         ▲
                     boardui (CLI)            boardui-wasm ─► @boardui/converter (worker)
```

## Repository layout

```
/
├─ crates/
│  ├─ boardui-ipc2581/   streaming IPC-2581 reader → typed model
│  ├─ boardui-geom/      2D regions, stroking, booleans, overlap resolution, holes, extrusion, triangulation
│  ├─ boardui-gltf/      glTF/GLB writer for the profile, metadata tables, user-model import
│  ├─ boardui-convert/   pipeline and options; profile validation rules
│  ├─ boardui/           CLI binary: convert, validate
│  └─ boardui-wasm/      wasm-bindgen bindings for convert and validate
├─ packages/
│  ├─ converter/         @boardui/converter: WASM + Web Worker wrapper
│  ├─ viewer/            @boardui/viewer: <board-viewer>
│  ├─ models/            @boardui/models: runtime model sources (KiCad, mapping files), STEP and OBJ loaders
│  ├─ react/             @boardui/react: React wrapper of <board-viewer>
│  ├─ angular/           @boardui/angular: Angular wrapper of <board-viewer>
│  ├─ demo-shared/       the demos' framework-independent code, build helpers, e2e tests
│  ├─ demo-react/        demo app in React (drop a file, convert locally, view, download)
│  └─ demo-angular/      the same demo app in Angular
├─ spec/                 profile spec, JSON schemas, samples
├─ docs/                 this file, roadmap, ADRs
├─ Cargo.toml            Cargo workspace
└─ pnpm-workspace.yaml   pnpm workspace
```

There is no Nx. Cargo and pnpm workspaces plus a few scripts cover it.

## Converter (Rust)

| Concern | Choice | Notes |
|---|---|---|
| Language | Rust stable, edition 2024 | builds for native and `wasm32-unknown-unknown` |
| XML | `quick-xml` pull reader | hand-written mapping for the IPC-2581 subset we use; unknown elements are skipped with a warning, as in the old TS parser |
| 2D geometry | `i_overlay` | booleans, polygon offset and line stroking, float API |
| Triangulation | `i_triangle` | from the same author as `i_overlay`, so the shapes are compatible |
| Spatial index | `rstar` | neighbour queries for overlap resolution and hole cutting |
| Math | `glam` | `f64` for geometry, `f32` only when writing buffers |
| glTF output | own `serde` types + GLB writer | `gltf-json` doesn't model `EXT_mesh_features` / `EXT_structural_metadata` and changes slowly |
| glTF input (user models) | `gltf` crate | reading only |
| Hashing | `sha2` | `source.sha256` |
| CLI | `clap`, `miette`, `tracing` | readable diagnostics that point at the offending XML line |
| Parallelism | `rayon` (native only) | layers are processed in parallel; WASM stays single-threaded in v1 |
| WASM bindings | `wasm-bindgen`, `wasm-bindgen-cli`, `wasm-opt` | wasm-pack is skipped: since the rustwasm org was wound down it has a single maintainer |

### Pure Rust, 2.5D

All geometry is 2D regions pushed up to a thickness ([ADR 0005](adr/0005-2-5d-geometry-in-pure-rust.md)):

- holes are cut in 2D before extrusion;
- barrels are tubes;
- nothing needs 3D booleans.

That keeps every dependency pure Rust, so the WASM build needs no C/C++ toolchain. Anything that would pull in C/C++ is either native-only behind a feature flag (geometry compression) or stays out (STEP import).

### Pipeline

1. **Parse.** Stream the XML into a typed model. Normalize units to metres and resolve dictionary references (standard primitives, line descriptors, colours).
   Pick the step to convert (the root of the `StepRepeat` graph) and place every step it repeats, nested, rotated and flipped: each copy is an instance whose features, holes and components go through the steps below like the converted step's own, with their instance in their IDs ([ADR 0013](adr/0013-panels.md), spec §6.14).
2. **Stack-up.** Build the layer list with Z ranges from `Stackup`, or from defaults. Synthesize missing soldermask and dielectric layers. Add paste on the outer copper and stack the drawing layers (courtyard, assembly, documentation) outside the board, with synthesized silkscreen and assembly layers where package drawings need them (spec §6.11–§6.13).
3. **2D per layer.**
   - Turn each feature into a region: stroke lines, expand standard primitives, apply the `Xform`. Package drawings are placed with their components and added to the assembly and silkscreen layers.
   - Apply negative polarity in document order.
   - Resolve overlaps by priority (spec §6.2). Features go in priority order; each one subtracts the already-claimed area near it (found via the R-tree) and then claims its own.
4. **Holes and outline.** Subtract the holes from every layer they cross, and build barrels. The board outline, for the dielectric and soldermask sheets, is the union of the step profiles; a profile without `Cutout`s loses the closed contours that a `BOARD_OUTLINE` layer draws inside it, as KiCad writes them (spec §6.7).
5. **Extrude and triangulate.** Triangulate each region, emit caps and side walls, write features contiguously, and split into primitives of at most 65,535 vertices. Dielectrics crossed by the same drills have the same sheet: it is cut and triangulated once, and its mesh is moved to the other dielectrics' heights.
6. **Components.** Build placeholder bodies, or user models from the mapping file, with one shared mesh per package or model.
7. **Write.** Emit materials, nodes, meshes, `EXT_mesh_features`, the `EXT_structural_metadata` tables and `BOARDUI_board`, then pack the GLB.

### Compression

Files kept on disk or served over the network can be large. A dense board approaches a million triangles.

- The native CLI gets `--compress`, which applies `EXT_meshopt_compression` and `KHR_mesh_quantization` through the `meshopt` crate (C++, native-only feature).
- In the browser the GLB goes straight from the worker to the viewer in memory, so it isn't compressed.
- The viewer always supports meshopt decoding.

## Viewer (TypeScript)

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript, strict | |
| 3D engine | three.js | `WebGPURenderer`, which falls back to WebGL2 automatically; shading written in TSL so both backends share one shader path |
| glTF loading | `GLTFLoader` + `3d-tiles-renderer`'s `EXT_mesh_features` / `EXT_structural_metadata` plugins, `MeshoptDecoder` | |
| Picking | `three-mesh-bvh` | fast ray casts against large merged meshes |
| Component | vanilla custom element `<board-viewer>` | no framework dependency; thin wrappers: `@boardui/react`, `@boardui/angular`. Importing it without a DOM (server-side rendering) is safe |
| Build/test | pnpm, Vite, Vitest, Playwright, Biome | |

### Element state without separate objects

Every element can be hovered, selected, recoloured or hidden, but layers stay merged meshes ([ADR 0008](adr/0008-hybrid-metadata.md), [ADR 0009](adr/0009-viewer-three-js-web-component.md)):

1. **One texel per element.** A small RGBA8 *state texture* has one texel per feature, across all layers (each layer gets an offset). It holds a highlight colour, a blend factor and a hidden flag.
2. **The shader reads it.** The shader reads the element's texel index from the geometry (when merging a layer, the viewer stores `_FEATURE_ID_0` plus the layer offset), looks up the texel, then tints or discards the fragment. The graph holds nothing per mesh, so meshes that render alike share one material, and x-ray mode swaps each mesh's material for its x-ray variant instead of changing materials.
3. **Hover.**
   - A BVH ray cast finds the triangle under the cursor.
   - The triangle's vertex gives the feature ID, and the metadata gives the element.
   - The viewer writes one texel; nothing is rebuilt.
4. **Net highlight.** The viewer writes every texel of the net's features. The feature → net index is built once at load time.
5. **Feature ranges.** Contiguous features (spec §8.1) let the loader compute each feature's vertex range and bounding box in one pass. These feed widget anchors and "zoom to element".
6. **Components.** The asset's component meshes are merged into one static mesh per material, each vertex carrying its component's texel, so the number of meshes doesn't grow with the number of packages; meshes that would cost too much memory as copies, and runtime models (below), are instanced, with the texel per instance. Either way a component uses the same texel, so it behaves alike whatever body it shows.

### Runtime models

After a board loads, the viewer replaces placeholder bodies with real models from **model sources** ([ADR 0014](adr/0014-runtime-model-sources.md), spec §6.15):

- **Sources** (`ModelSource`) resolve a component (refDes, part, package, BOM attributes) and the board (exporting software) to a `ModelRef`: key, URL or loader, format, transform into the package frame. They are tried in order; misses and failures fall through, models embedded by the converter stay.
- **Loaders** per format: glTF/GLB in the viewer; STEP (occt-import-js in a worker, on first use) and OBJ in `@boardui/models`, with `kicadSource` (KiCad's libraries through GitLab's API) and `mappingSource` (a model mapping file on your own server).
- **Loading** runs in the background after `bui-load`: deduplicated per key, eight components at a time, scene updates batched, stopped by the next load; `bui-model-progress` and `bui-model-done` report it. Files and tessellated STEP go into Cache Storage, so a second load of a board makes no model requests.

### Public API (sketch)

```ts
const viewer = document.querySelector('board-viewer')!;

await viewer.load(glbUrlOrBuffer);              // a boardui GLB
await viewer.loadIpc2581(file, { models });     // converts in a worker via @boardui/converter

viewer.setLayerVisible('layer/TOP', false);
viewer.setXray(true);
viewer.highlight({ net: 'net/GND' }, { color: '#ffcc00' });
viewer.select('cmp/U3');
viewer.focus('cmp/U3');                          // fly the camera to the element

const detach = viewer.attachWidget('cmp/U3', myElement, {
  anchor: 'top',            // 'top' | 'center' | [x, y, z] offset in metres
  offset: [0, -8],          // screen-space px
  occlusion: 'fade',        // 'hide' | 'fade' | 'none'
});

viewer.addEventListener('bui-hover', (e) => e.detail /* { id, kind, properties } | null */);
viewer.addEventListener('bui-select', (e) => e.detail);
viewer.addEventListener('bui-load', (e) => e.detail /* info('board'): widgets can attach now */);
viewer.addEventListener('bui-unload', (e) => e.detail /* the board is about to be replaced */);

viewer.modelSources = [kicadSource()];          // runtime models (@boardui/models)
viewer.addEventListener('bui-model-done', (e) => e.detail /* { loaded, total, sources, … } */);
```

**Widgets** are ordinary HTML elements, from any framework, placed in an overlay above the canvas:

- Each frame, the viewer projects every widget's anchor to the screen and sets a CSS transform.
- Occlusion is checked with throttled ray casts.

### Converter in the browser

`@boardui/converter` loads the WASM module in a Web Worker:

- the input `File` / `ArrayBuffer` is transferred in;
- progress events stream out, one per pipeline step;
- the GLB `ArrayBuffer` is transferred back.

Nothing leaves the machine. Each conversion gets a fresh worker that is terminated afterwards, because WebAssembly memory only grows. The module is 32-bit, so a conversion can use at most 4 GiB; a board of about 240k features needs 3.1 GB. `<board-viewer>`'s `loadIpc2581` and the demo use this package.

## Testing and CI (GitHub Actions)

- **Rust:**
  - `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`;
  - `insta` snapshot tests of the parsed model and metadata JSON;
  - `proptest` property tests on the geometry invariants (no overlap, closed prisms, feature contiguity).
- **Conformance:** convert every sample in `spec/samples`, then run the Khronos validator and `boardui validate`, then diff against the expected outputs.
- **WASM:** build the module (`wasm-bindgen`, `wasm-opt`), then run a Node smoke test that converts the minimal sample.
- **Viewer and wrappers:** Vitest unit tests (the React wrapper with Testing Library in jsdom, the Angular wrapper with TestBed through the Angular CLI's `unit-test` builder), plus Playwright smoke and screenshot tests of every demo app against the built Pages site (software rendering with SwiftShader in CI, in the Playwright Docker image), including converting every sample in the browser. The apps run the same suite and share its screenshots (`packages/demo-shared/e2e`).
- **Demo build:** a demo's build, and `pnpm site`, fail if the output contains an IPC consortium test case (`packages/demo-shared/src/build/check-dist.ts`, by the hashes in `spec/samples/ipc-testcases/sources.json`).
- **IPC consortium test cases:** the repository only links to them. The jobs that read them (Rust, Conformance, Demos) restore them from the Actions cache or fetch them (`.github/actions/ipc-testcases`), and set `BOARDUI_REQUIRE_IPC_TESTCASES`, so a missing file fails the tests instead of skipping them.
- **Release build:** pull requests that change `release.yml` build, smoke-test and package the CLI for every release target without publishing.
- **Performance:** a `criterion` benchmark on the largest sample, with results tracked over time.

## Releases and hosting

- v1 publishes nothing to crates.io or npm. Crates set `publish = false` and npm packages `"private": true`; the README explains how to use the viewer from a source build.
- The `boardui` CLI ships as prebuilt binaries on GitHub Releases. Pushing a tag `v<version>` (it must match the workspace version in `Cargo.toml`) runs `.github/workflows/release.yml`:
  - it builds `x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl` (static), `x86_64-apple-darwin`, `aarch64-apple-darwin` and `x86_64-pc-windows-msvc` (static CRT), each on a runner of its own platform;
  - it smoke-tests each binary (`--version`, then converting and validating `minimal-2layer`);
  - it packs `boardui-<version>-<target>.tar.gz` (`.zip` on Windows) with the binary, `LICENSE`, `LICENSING.md` and `README.md`, and writes `SHA256SUMS`;
  - it creates the GitHub release with notes from `scripts/release-notes.sh`, which includes the version's `CHANGELOG.md` section.
- The demos are hosted on GitHub Pages, deployed from `master` by `.github/workflows/pages.yml`: each app at `/boardui/<framework>/` (<https://midub.github.io/boardui/react/>, <https://midub.github.io/boardui/angular/>), and <https://midub.github.io/boardui/>, which redirects to the React demo keeping the query and hash. It builds the demos with the same setup as the CI Web job (`.github/actions/setup-web`) and assembles the site with `pnpm site`. The IPC consortium test cases are test data only, so the demo links to them in the repository instead of shipping them. There is no custom domain: `boardui.com` and the unscoped `boardui` npm package belong to an unrelated project.
