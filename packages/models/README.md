# @boardui/models

Runtime component models for [`<board-viewer>`](../viewer/README.md) ("Runtime models"):

- **`stepLoader`**: STEP models, read by OpenCascade ([occt-import-js](https://github.com/kovacsv/occt-import-js),
  WebAssembly) in a Web Worker;
- **`objLoader`**: Wavefront OBJ with materials;
- **`kicadSource`**: models of KiCad's libraries, fetched from gitlab.com by footprint name;
- **`mappingSource`**: your own server, named by a model mapping file
  ([`spec/schema/models.schema.json`](../../spec/schema/models.schema.json)).

The viewer asks its sources for every component that has a placeholder body after each load,
and swaps the models in as they arrive. OpenCascade lives here, not in the viewer: apps that
don't need STEP don't ship it, and apps that do download it only when the first STEP model is
read. Like the other packages, it is not on npm in v1 (root README, "Embedding the viewer").

```js
import '@boardui/viewer';
import { kicadSource, mappingSource, registerLoaders } from '@boardui/models';

registerLoaders(); // registerModelLoader('step', stepLoader()) and ('obj', objLoader())
const viewer = document.querySelector('board-viewer');
viewer.modelSources = [mappingSource('/models/models.json'), kicadSource()];
viewer.addEventListener('bui-model-done', ({ detail }) =>
  console.log(`${detail.loaded} of ${detail.total} components have models`),
);
```

In React: `<BoardViewer modelSources={sources} onModelDone={…} />` (keep `sources` stable, e.g.
module-level or `useMemo`); in Angular: `<bui-board-viewer [modelSources]="sources"
(modelDone)="…" />`.

## `stepLoader(options)`

Reads STEP (AP203, AP214, AP242) with face colours in a worker (`dist/step.worker.js`), which
loads the WebAssembly module `occt/occt-import-js.wasm` (7.6 MB, 3.1 MB gzipped) with the first
STEP file and stops after `idleTimeout` (15 s) without work. The viewer caches the tessellated
result of immutable models (KiCad's) in Cache Storage, so a board's second load parses no STEP.

| Option | Default | |
|---|---|---|
| `linearDeflection` | `0.02` | Largest distance between mesh and surface, in mm (absolute, not relative to the part's size: small parts don't get finer meshes than large ones). |
| `angularDeflection` | `0.5` | Largest angle between neighbouring facets, in radians (≈ 29°): a pin's cylinder gets at least 13 sides. |
| `idleTimeout` | `15000` | Milliseconds without work after which the worker (and its 30 MB+ of memory) goes. |
| `createWorker` | the package's worker | For build tools that don't bundle `new Worker(new URL(…, import.meta.url))`. |

STEP models are taken as Z-up in millimetres, the convention of ECAD models (KiCad's among
them), and delivered Y-up in metres as the viewer expects: (x, y, z) mm → (x, z, −y) m. Faces
without a colour are light grey. Vite bundles the worker and the WebAssembly module as they
are; other build tools serve `dist/step.worker.js` next to the app's scripts and
`occt/occt-import-js.wasm` in `occt/` beside it (see `packages/demo-angular/scripts/assets.mjs`).

## `objLoader()`

three's `OBJLoader` with the materials of the `mtllib` files the OBJ names (fetched next to its
URL) and `newmtl` blocks inside the OBJ (as EasyEDA writes them). OBJ has no units: the model is
taken as it is (Y up, metres); correct it with the reference's `transform` (`scale: 0.001` for
millimetres).

## `kicadSource(options)`

For a component exported by KiCad — IPC-2581 `Package@name` = `<footprint>_<n>`,
`Component@part` = `<library>_<footprint>_<value>`, e.g. `C_0402_1005Metric_2` and
`Capacitor_SMD_C_0402_1005Metric_100nF` — whose library is one of KiCad's
(`KICAD_LIBRARIES`, the 156 footprint libraries of 8.0.9, 9.0.9.1 and 10.0.7, pinned), it reads
`<library>.pretty/<footprint>.kicad_mod` from `kicad/libraries/kicad-footprints`, takes its first
visible `(model …)`, and loads that model as STEP from `kicad/libraries/kicad-packages3D` at the
same tag (`.wrl` references become `.step`: the library has STEP for every model). Other
components resolve to `null` without a request: project libraries, other exporters.

- **Requests** go to GitLab's API (`/api/v4/projects/<project>/repository/files/<path>/raw?ref=<tag>`),
  which allows cross-origin requests (the `/-/raw/` URLs don't). At most `concurrency` (4) at a
  time, each file once; footprints, missing ones too, are cached in Cache Storage
  (`boardui-kicad-v1`): files at a tag never change. GitLab allows 500 unauthenticated requests
  per minute per IP; after HTTP 429 the source stops asking until `Retry-After` (else a minute)
  and reports a `RateLimitError`. `stats` counts requests, bytes and cache hits.
- **Tag** (`ref`): the newest tag of the KiCad major version that exported the board
  (`BOARDUI_board.source.software`, profile 0.8: 8 → `8.0.9`, 9 → `9.0.9.1`, 10 → `10.0.7`), else
  `10.0.7`. KiCad 10's library ships STEP only; 9's WRL and STEP.
- **Placement** as KiCad does it: the footprint's `offset` (mm), `rotate` (degrees, negated, about
  Z, then Y, then X) and `scale` in KiCad's 3D frame (Z up, Y up in the top view), which is the
  IPC-2581 package frame; verified against `kicad-cli pcb export glb` (PR #30).
- **Options:** `ref`, `baseUrl` (another host with GitLab's API, e.g. a caching proxy or a
  mirror), `footprints` and `models` (project paths), `libraries`, `concurrency`, `cache`
  (`null`: none), `fetch`.
- **Coverage** with KiCad 10.0.7 (2026-10-07): RoyalBlue54L Feather 41 of 56 components,
  miao 13 of 18; boards with their own libraries get little (egg-ldo-panel 16 of 97, fomu-pvt
  0 of 17). Some footprints name models that don't exist (`D_0402_1005Metric`,
  `JST_PH_S2B-PH-SM4-TB_1x02-1MP_P2.00mm_Horizontal`): HTTP 404, counted as `missing`.

The request for a footprint names it: the board's footprint names go to gitlab.com, nothing else.

## `mappingSource(urlOrMapping, options)`

The model mapping file of the converter (`--models`, spec §6.9), read at runtime, for your own
server. `urlOrMapping` is the URL of the JSON (loaded once, on first use; relative files resolve
against it) or the parsed object (`options.baseUrl`, default the page). Extensions over what the
converter reads:

```json
{
  "version": 1,
  "models": [
    { "match": { "attributes": { "MPN": "GRM155*" } }, "file": "capacitors/0402.glb" },
    { "match": { "refDes": "J1" }, "file": "usb-c.step" },
    { "match": { "package": "*" }, "file": "https://models.example.com/{package}.step" }
  ]
}
```

- `match`: any of `part`, `package`, `refDes` and `attributes` (BOM attributes, spec §8.4); all
  given must match; `*` matches any text, `?` one character.
- `file`: a path, an absolute URL, or a template with `{part}`, `{package}`, `{refDes}`, `{side}`,
  `{mount}` and attribute names (`{MPN}`, `{LCSC}`), filled in URL-encoded; a rule whose
  placeholder has no value doesn't match. `format` (`glb`, `gltf`, `step`, `obj`) defaults to the
  extension.
- Order: rules that match more than the package first, then package-only rules, each in file order
  (the converter's "part first, then package"). The first rule that matches names the model; a
  missing file (404) means this source has no model for the component, and the viewer asks the
  next source. To try several URL patterns, use several sources.
- `offsetMm`, `rotationDeg`, `scale` as in spec §6.9.
- The key is the URL. A server can change its files, so the viewer keeps these models out of its
  persistent cache: each load fetches them again through the browser's HTTP cache (send
  `Cache-Control` to save requests) and parses STEP again.

The converter reads the same file and skips, with a warning, the rules that only the viewer can
apply (wildcards, `refDes`, `attributes` or several fields, URLs, templates, STEP and OBJ).

## Writing a source

A source is an object with a `name`, an optional `attribution` (`{ text, url, license }`) and
`resolve(component, board, signal)`, which returns a `ModelRef` or `null`:

```ts
import type { ModelSource } from '@boardui/viewer';

export function myServer(base: string): ModelSource {
  return {
    name: 'My server',
    async resolve(component) {
      const mpn = component.attributes.MPN;
      if (!mpn) return null;
      const url = `${base}/${encodeURIComponent(mpn)}.glb`;
      return { key: url, url, format: 'glb' };
    },
  };
}
```

Use `load(signal)` instead of `url` to fetch the bytes yourself (rate limits, authentication;
resolve `null` for a missing file), `transform` to place a model that doesn't follow spec §6.9's
conventions, and `immutable: true` if the content behind the key never changes (the viewer then
keeps the model, or its absence, in its persistent cache and never asks again).

**EasyEDA (a sketch, not implemented):** LCSC parts carry their LCSC number as a BOM attribute
(`attributes.LCSC`, e.g. `C139797`). An EasyEDA source would look the part up in EasyEDA's
component API (`easyeda.com/api/products/<LCSC>/components`), which sends no CORS headers, so
through a CORS proxy of your own; take the 3D model's UUID and its origin and rotation from the
package's `SVGNODE` entry; and return
`{ key: 'easyeda/<uuid>', format: 'obj', url: 'https://modules.easyeda.com/3dmodel/<uuid>', transform }`
(or the model's STEP from `modules.easyeda.com`), with `transform` from that origin, rotation and
the file's units (easyeda2kicad shows the conversion). OBJ materials come inline, as `objLoader`
reads them.

## Licences

The package is MIT. occt-import-js and OpenCascade (in `occt/`, copied from `occt-import-js@0.0.23`
by `scripts/occt.mjs`) are LGPL-2.1 (OpenCascade with its exception): their licence texts are in
`occt/LICENSE.occt-import-js.txt` and `occt/LICENSE.occt.txt`; ship them with the worker (the
demos serve them under `licenses/`). The worker loads the unmodified module, so it can be
replaced.

KiCad's libraries are CC-BY-SA 4.0 with an exception for designs and generated files: credit them
(`KICAD_ATTRIBUTION`, the source's `attribution`, also in the `bui-model-*` events) wherever their
models are shown. The repository holds no KiCad (or other third-party) model or footprint files;
the tests use self-made fixtures.

## Development

```sh
pnpm --filter @boardui/models build  # occt/ from occt-import-js, then tsc → dist/
pnpm --filter @boardui/models test   # Vitest; reads a self-made STEP box with OpenCascade in Node
```
