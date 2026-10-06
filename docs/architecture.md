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
│  └─ demo/              demo app (drop a file, convert locally, view, download)
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
2. **Stack-up.** Build the layer list with Z ranges from `Stackup`, or from defaults. Synthesize missing soldermask and dielectric layers.
3. **2D per layer.**
   - Turn each feature into a region: stroke lines, expand standard primitives, apply the `Xform`.
   - Apply negative polarity in document order.
   - Resolve overlaps by priority (spec §6.2). Features go in priority order; each one subtracts the already-claimed area near it (found via the R-tree) and then claims its own.
4. **Holes.** Subtract the holes from every layer they cross, and build barrels.
5. **Extrude and triangulate.** Triangulate each region, emit caps and side walls, write features contiguously, and split into primitives of at most 65,535 vertices.
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
| Component | vanilla custom element `<board-viewer>` | no framework dependency; thin Angular/React wrappers are optional |
| Build/test | pnpm, Vite, Vitest, Playwright, Biome | |

### Element state without separate objects

Every element can be hovered, selected, recoloured or hidden, but layers stay merged meshes ([ADR 0008](adr/0008-hybrid-metadata.md), [ADR 0009](adr/0009-viewer-three-js-web-component.md)):

1. **One texel per element.** A small RGBA8 *state texture* has one texel per feature, across all layers (each layer gets an offset). It holds a highlight colour, a blend factor and a hidden flag.
2. **The shader reads it.** The shader reads `_FEATURE_ID_0` plus the layer offset, looks up the texel, then tints or discards the fragment.
3. **Hover.**
   - A BVH ray cast finds the triangle under the cursor.
   - The triangle's vertex gives the feature ID, and the metadata gives the element.
   - The viewer writes one texel; nothing is rebuilt.
4. **Net highlight.** The viewer writes every texel of the net's features. The feature → net index is built once at load time.
5. **Feature ranges.** Contiguous features (spec §8.1) let the loader compute each feature's vertex range and bounding box in one pass. These feed widget anchors and "zoom to element".
6. **Components.** Component nodes that share a mesh are batched (`BatchedMesh` / `InstancedMesh`) per material, and the instance index maps back to the component row.

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
```

**Widgets** are ordinary HTML elements, from any framework, placed in an overlay above the canvas:

- Each frame, the viewer projects every widget's anchor to the screen and sets a CSS transform.
- Occlusion is checked with throttled ray casts.

### Converter in the browser

`@boardui/converter` loads the WASM module in a Web Worker:

- the input `File` / `ArrayBuffer` is transferred in;
- progress events stream out;
- the GLB `ArrayBuffer` is transferred back.

Nothing leaves the machine.

## Testing and CI (GitHub Actions)

- **Rust:**
  - `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`;
  - `insta` snapshot tests of the parsed model and metadata JSON;
  - `proptest` property tests on the geometry invariants (no overlap, closed prisms, feature contiguity).
- **Conformance:** convert every sample in `spec/samples`, then run the Khronos validator and `boardui validate`, then diff against the expected outputs.
- **WASM:** build the module, then run a Node smoke test that converts the minimal sample.
- **Viewer:** Vitest unit tests, plus Playwright smoke and screenshot tests of the demo (software WebGL in CI).
- **Performance:** a `criterion` benchmark on the largest sample, with results tracked over time.

## Releases and hosting

- v1 publishes nothing to crates.io or npm. The `boardui` CLI ships as prebuilt binaries (Linux, macOS, Windows) on GitHub Releases, built by a workflow from version tags. Crates set `publish = false` and npm packages `"private": true`.
- The demo is hosted on GitHub Pages at <https://midub.github.io/boardui/>, deployed by CI from `master`. There is no custom domain: `boardui.com` and the unscoped `boardui` npm package belong to an unrelated project.
