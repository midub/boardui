# @boardui/viewer

`<board-viewer>`: a framework-independent web component that shows a boardui glTF board
([profile spec](../../spec/README.md)) in 3D. It uses three.js `WebGPURenderer`, which falls back
to WebGL2 where WebGPU is missing.

```html
<board-viewer src="board.glb" style="height: 600px"></board-viewer>
<script type="module">
  import '@boardui/viewer';

  const viewer = document.querySelector('board-viewer');
  viewer.addEventListener('bui-select', (e) => console.log(e.detail)); // { id, kind, properties } | null
</script>
```

`three` is a peer dependency (`^0.186`). `@boardui/converter` (a dependency) is loaded on first use
of `loadIpc2581`.

## API

Element IDs follow spec §5 (`cmp/U3`, `pin/U3/1`, `net/GND`, `layer/TOP`, `feat/TOP/12`, `board`).
Build them from names with `encodeIdSegment`, e.g. `'net/' + encodeIdSegment('/SDA')`.

| Member | |
|---|---|
| `load(urlOrBytes)` | Loads a GLB (URL, `ArrayBuffer` or `Uint8Array`). Rejects non-boardui assets. |
| `loadIpc2581(file, options)` | Converts IPC-2581 locally with `@boardui/converter` (WASM in a worker) and loads the result. `options`: `models`, `tolerance`, `platingThickness`, `step`, `signal`, `onProgress`. Resolves with the conversion (`glb` for download, `warnings`, `stats`, `timings`). |
| `whenPickable()` | Resolves when hover and picking cover the whole board (see "Picking" below). |
| `layers` | Layers and drill layers, top to bottom, with their current visibility. |
| `setLayerVisible(id, visible)` | Defaults come from `BOARDUI_board.layers[].visible`; drill layers start visible. |
| `setXray(on)`, `xray` | Makes the board translucent (copper less than the rest); tinted elements stay opaque. Layer visibility doesn't change: inner copper shows only when switched on. |
| `highlight({ ids } \| { net }, { color })` | Tints elements with a CSS colour. Returns a function that removes the highlight. |
| `hide({ ids } \| { net })` | Hides elements. Returns a function that shows them again. |
| `select(id \| null)`, `selection` | Selects any element; a net selects all its copper. |
| `focus(id)` | Flies the camera to an element. (`focus()` / `focus(options)` still focus the element.) |
| `setView('top' \| 'bottom' \| 'iso')` | Frames the board from above, from below (mirrored, as when flipping a board), or obliquely. |
| `attachWidget(id, element, { anchor, offset, occlusion })` | Shows an HTML element above the board, following a board element. Returns a detach function. |
| `info(id)` | `{ id, kind, properties }`, with references to other elements as IDs. |
| `ids(kind)` | All IDs of a kind: `'layer'`, `'component'`, `'pin'` or `'net'`. |
| `stats()` | Backend, draw calls and triangles of the last frame, and the number of frames rendered. |
| `autoRotate` | Orbits the camera continuously; the board is then rendered every frame (frame-rate measurements). |

Events (`bubbles`, `composed`): `bui-hover` when the element under the pointer changes, and
`bui-select` when the user clicks an element or empty space; `detail` is `info(id)`, or `null`.
`bui-progress` reports `loadIpc2581`: `{ stage: 'convert' | 'load', step, fraction }`.

Attributes: `src` loads a GLB (failures dispatch `error`); `backend="webgl"` forces the WebGL2
backend (read when the element connects).

Methods that take one ID throw a `RangeError` for unknown IDs; `highlight` and `hide` skip unknown
IDs. All of them need a loaded board.

### Widgets

Widgets are ordinary elements from any framework. They are moved into `<board-viewer>` with
`slot="widget"`, so page styles apply to them, and positioned with a CSS transform every frame.

- `anchor`: `'top'` (default; centre of the bounding-box face that points away from the board,
  widget above it), `'center'`, or an `[x, y, z]` offset in metres from the box centre.
- `offset`: `[x, y]` in CSS pixels.
- `occlusion`: `'fade'` (default), `'hide'` or `'none'`, checked by ray casts at most every 150 ms.

A widget is hidden while its element isn't drawn at all: its layer (or, for a component, the
component) is switched off or the element is hidden with `hide`.

## How it works

- **Loading.** `GLTFLoader` with `MeshoptDecoder`. The `EXT_structural_metadata` tables are read
  column-wise by a small reader (`src/metadata.ts`).
- **Layers.** Each layer's primitives are merged into one mesh per material (32-bit indices), so a
  layer is one draw call however many 65k-vertex primitives it had. Feature vertex/index ranges and
  bounding boxes are found in the same pass (spec §8.1).
- **Lighting and depth.** Room environment, a key light from above and a weaker one from below
  (bottom view). The soldermask gets a polygon offset: its bottom face is coplanar with the
  dielectric's top and the copper's bottom (ADR 0006), which z-fought with the dielectric hidden.
- **Element state.** One RGBA8 texel per feature and per component. A TSL node graph reads it per
  vertex (feature ID + layer offset) and tints, or discards, the fragment. Hover, selection,
  highlights and hiding are texel writes. Copper and drill layers get a second, overlay draw that
  shows tinted features through the translucent soldermask; it is drawn only while the layer has a
  tint.
- **Components.** Component nodes that share geometry and material become one `InstancedMesh`; an
  instanced attribute carries each instance's component row into the same state-texture lookup.
- **Picking.** `three-mesh-bvh` BVHs per layer mesh, three's instanced ray cast for components.
  Meshes with 50k triangles or more get their BVH built in Web Workers (`src/bvh.worker.ts`, a pool
  of up to three) from copies of their positions and indices, so loading a dense board doesn't
  block the main thread; smaller ones are built in idle time. Until a layer's BVH arrives, hover
  and widget occlusion skip that layer (`whenPickable()` resolves when all are built). The BVHs are
  indirect, so the index buffer stays as it is. Picking and widget occlusion look through the translucent
  soldermask. Dielectric sheets can't be hovered or selected (over bare board the pointer finds
  nothing), but they block the pointer and hide widgets whose element is on the far side.

## Development

```sh
pnpm --filter @boardui/viewer dev    # dev page with generated fixtures (query parameters below)
pnpm --filter @boardui/viewer test   # Vitest, no GPU needed
pnpm --filter @boardui/viewer build  # tsc → dist/, type-check of tests and dev page, vite build of the dev page
```

`test/fixture/` generates conformant boardui GLBs from code: a small four-layer board that
exercises the profile, and a dense board, by default 105 × 105 cells with about 110k features.
They are dev/test only and not published. Dev page query parameters: `board=small|dense`,
`grid=<cells per side>`, `realistic` (shapes as a converter writes them at the 5 µm default
tolerance, about 46 vertices per copper feature), `tolerance=<µm>` (arc tolerance of `realistic`)
and `backend=webgl`. `?board=dense&grid=60&realistic` is about the size of IPC-2581 testcase1
(40k features, 5 M triangles); `grid=135` has 200k features (25 M triangles).

`dev/review.mjs` takes review screenshots and performance numbers of the built dev page in headless
Chromium with software rendering; its header says how to run it in the Playwright Docker image.
