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
of `loadIpc2581`. Neither package is published to npm in v1: the root README ("Embedding the
viewer") shows how to install them from a source build.

Importing the module defines the element in a browser. Without a DOM (server-side rendering) the
import is safe and defines nothing. In React, use [`@boardui/react`](../react/README.md).

## API

Element IDs follow spec §5 (`cmp/U3`, `pin/U3/1`, `net/GND`, `layer/TOP`, `feat/TOP/12`, `board`). In a panel, each placed board is an instance (`inst/board-2`), and its elements carry the instance: `cmp/board-2/U3`, `net/board-2/GND`, `feat/board-2/TOP/12` (spec §6.14). Resolving an instance gives its features and components, and those of the instances placed in it.
Build them from names with `encodeIdSegment`, e.g. `'net/' + encodeIdSegment('/SDA')`.

| Member | |
|---|---|
| `load(urlOrBytes)` | Loads a GLB (URL, `ArrayBuffer` or `Uint8Array`). Rejects non-boardui assets. |
| `loadIpc2581(file, options)` | Converts IPC-2581 locally with `@boardui/converter` (WASM in a worker) and loads the result. `options`: `models`, `tolerance`, `platingThickness`, `step`, `signal`, `onProgress`. Resolves with the conversion (`glb` for download, `warnings`, `stats`, `timings`). |
| `loaded` | Whether a board is loaded: `true` from its `bui-load` on (also while the next board loads). |
| `whenPickable()` | Resolves when hover and picking cover the whole board (see "Picking" below). |
| `layers` | Layers and drill layers, top to bottom, with their current visibility. |
| `setLayerVisible(id, visible)` | Defaults come from `BOARDUI_board.layers[].visible`: inner copper, paste and drawing layers (courtyard, assembly, documentation) start hidden; drill layers start visible. |
| `setXray(on)`, `xray` | Makes the board translucent (copper less than the rest); tinted elements stay opaque. Layer visibility doesn't change: inner copper shows only when switched on. |
| `highlight({ ids } \| { net }, { color })` | Tints elements with a CSS colour. Returns a function that removes the highlight. |
| `hide({ ids } \| { net })` | Hides elements. Returns a function that shows them again. |
| `select(id \| null)`, `selection` | Selects any element; a net selects all its copper, and a component (also on hover) its drawings, such as its assembly outline. |
| `focus(id)` | Flies the camera to an element. (`focus()` / `focus(options)` still focus the element.) |
| `setView('top' \| 'bottom' \| 'iso')` | Frames what is shown (see `frame()`) from above, from below (mirrored, as when flipping a board), or obliquely. |
| `frame()` | Frames what is shown, keeping the view direction: visible layers and drill layers, and the components, without elements hidden with `hide`. Hidden layers don't count, so drawings far off the board on a hidden documentation layer don't widen the view. Showing or hiding layers doesn't move the camera; call `frame()` or `setView` to frame the new set. |
| `attachWidget(id, element, { anchor, offset, occlusion })` | Shows an HTML element above the board, following a board element. Returns a detach function. |
| `info(id)` | `{ id, kind, properties }`, with references to other elements as IDs. A component's `properties.attributes` holds its BOM attributes by name (`Value`, `Description`, `MPN`, … since profile 0.8, absent when it has none); the board's `properties.source.software` names the exporting software. |
| `ids(kind)` | All IDs of a kind: `'layer'`, `'component'`, `'pin'`, `'net'` or `'instance'`. |
| `stats()` | Backend, draw calls and triangles of the last frame, and the number of frames rendered. |
| `autoRotate` | Orbits the camera continuously; the board is then rendered every frame (frame-rate measurements). |
| `modelSources` | Where runtime models come from, tried in order (see "Runtime models"); default none. Setting it starts over for the loaded board. |
| `modelsShown` | Runtime models shown (default) or the placeholder bodies they replace. |
| `modelStatus` | The runtime models of the loaded board so far (as in `bui-model-progress`), or `null`. |

Events (`bubbles`, `composed`): `bui-hover` when the element under the pointer changes, and
`bui-select` when the user clicks an element or empty space; `detail` is `info(id)`, or `null`.
`bui-progress` reports `loadIpc2581`: `{ stage: 'convert' | 'load', step, fraction }`.

`bui-load` comes when a board has been loaded and put in place of the previous one, from `src`,
`load` or `loadIpc2581` (before their promise resolves): widgets, highlights and `info()` work
on it from then on.
`bui-unload` comes just before another board replaces it, while it is still in place; the new
board's `bui-load` follows at once. `detail` is the board's `info('board')` for both. A failed
load dispatches neither (`src` dispatches `error`, the methods reject) and keeps the current
board; a load that a newer one overtook is dropped without events. Moving or reconnecting the
element keeps its board, without events. A new board is framed obliquely, by what is shown.

```js
viewer.addEventListener('bui-load', () => {
  const detach = viewer.attachWidget('cmp/U3', tag);
  viewer.addEventListener('bui-unload', detach, { once: true });
});
```

Attributes: `src` loads a GLB (failures dispatch `error`); `backend="webgl"` forces the WebGL2
backend (read when the element connects).

Methods that take one ID throw a `RangeError` for unknown IDs; `highlight` and `hide` skip unknown
IDs. All of them need a loaded board.

### Runtime models

After every load the viewer can replace placeholder bodies (spec §6.8) with real models, fetched
in the background from **model sources**: KiCad's library on gitlab.com, your own server, or
anything that implements `ModelSource`. [`@boardui/models`](../models/README.md) has the sources
and the STEP and OBJ loaders; the viewer itself loads glTF/GLB and doesn't depend on OpenCascade.

```js
import { kicadSource, mappingSource, registerLoaders } from '@boardui/models';
registerLoaders(); // STEP (worker, loaded on first use) and OBJ
viewer.modelSources = [mappingSource('https://models.example.com/models.json'), kicadSource()];
viewer.addEventListener('bui-model-done', (e) => console.log(e.detail.loaded, 'models'));
```

- **Which components.** Those whose body is a placeholder (materials `boardui/body` and
  `boardui/pin1`). Models embedded by the converter (`--models`) are never replaced, and
  components without a body get none: the converter leaves them out on purpose (test points,
  fiducials, logos, mounting holes, packages as large as the board).
- **Sources** are asked in order per component: `resolve(component, board, signal)` gets the
  component (`id`, `refDes`, `part`, `package`, `side`, `mount`, `attributes` from
  `extras.boardui.attributes`, `{}` without) and the board (`profileVersion`, `source` with
  `software` from profile 0.8), and returns a `ModelRef` or `null`. The first model that resolves
  and loads wins; `null`, a rejection, a missing file (HTTP 404), a parse error or a model
  without triangles falls through to the next source; with none the placeholder stays.
- **`ModelRef`**: `key` (dedupe, sharing, cache), `url` or
  `load(signal)` (bytes, or `null` for missing), `format` (`glb`, `gltf`, `step`, `obj` or any
  registered one), `transform` into the package frame (`offsetMm`, `rotationDeg`, `scale` with
  the mapping file's semantics, spec §6.9, or a column-major `matrix`), `immutable` (the content
  behind the key never changes, so the model goes into the persistent cache) and `attribution`.
- **Loaders** turn bytes into parts (`{ geometry, material }`, Y up in metres):
  `registerModelLoader(format, loader)`. GLB and glTF are built in (default scene flattened, node
  transforms baked in). A loader with `cacheVersion` (STEP) has its parsed geometry cached instead
  of the file.
- **In the scene.** A model replaces the placeholder body and its pin-1 marker. Components with
  the same key share the geometry and are instanced, one batch per material, on the component's
  state texel: hover, picking, selection, highlights, widgets, `hide`, the component toggle and
  framing work as with placeholders, and `info()` doesn't change. `modelsShown = false` shows the
  placeholders again.
- **Loading** never delays `bui-load`: the board shows with placeholders, and models swap in as
  they arrive, in batches of scene updates (at most one per 150 ms). Eight components are
  resolved at a time, each key is loaded once, and the next load, unload or `modelSources` stops
  the run.
- **Cache.** Immutable models (the file, or the parsed geometry of loaders with `cacheVersion`)
  and immutable missing files go into Cache Storage (`boardui-models-v1`, by key; secure contexts
  only), so a board's second load makes no requests for them and parses no STEP. This cache never
  revalidates; other models are fetched again on every load, through the HTTP cache. Cache errors
  are ignored. Models stay in memory while the
  element lives, pruned to those of the current board.

Events: `bui-model-progress` after each batch, and `bui-model-done` when every component has been
tried (not when a load stops the run first). `detail` (`ModelStatus`): `total` (components with a
placeholder body), `done`, `loaded`, per source `{ name, attribution, loaded, missing, failed }`,
the first 50 `failures` (`{ source, component, key, message }`) and `failureCount`, `models`
(distinct keys), `cached`, `requests` and `bytes` (the viewer's model downloads; sources that
fetch themselves count their own), `triangles` (added, all instances), `ms` and `complete`.

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
  Runtime models are batched the same way (`src/bodies.ts`); the placeholder batches they replace
  draw only their remaining instances.
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
