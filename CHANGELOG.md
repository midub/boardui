# Changelog

All notable changes to boardui. Versions follow [Semantic Versioning](https://semver.org); the
glTF profile has its own version (`profileVersion`, [spec §11](spec/README.md#11-versioning)).

## [Unreleased]

- **Fewer converter warnings (profile 0.9, still a draft):** the reader no longer warns about
  data that exporters commonly write but that neither shapes the board nor describes its parts:
  `Content@roleRef`, `BomRef`, `AvlRef`, `FunctionMode@level`, `Stackup@stackupStatus`,
  `Step@type`, the stack-up materials' `Conductor` and `Dielectric` properties and
  `General@comment`, a step's `NonstandardAttribute`s, `Package@pinOneOrientation`,
  `PickupPoint`, and `Pin@type` and `@electricalType`. A `BOARD_OUTLINE` layer (KiCad's
  `Edge.Cuts`, Altium's board shape) is no longer reported as not converted: the profile and
  its cut-outs are the outline. The KiCad samples royalblue54l-feather, miao, antenna and
  blind-buried-vias now convert without warnings. Two of these become data
  ([spec §8.2](spec/README.md#82-ext_structural_metadata)):
  - a component's own `NonstandardAttribute`s join its attributes after the BOM's (Allegro
    writes a part's `VALUE` and `TOLERANCE` there; the BOM's `VALUE` wins);
  - text drawn as outlines takes its string from its set's `TEXT` attribute (KiCad), so the
    viewer's `info()` and the demos' details panel show the string of selected silkscreen text.

- **Component attributes (profile 0.8, still a draft):** the converter reads the BOM, the
  approved vendor list and the exporting software. Each component gets its BOM attributes
  (characteristics such as KiCad's `Value` and `LCSC`, `Description`, `MPN`, `Manufacturer`) in
  a new `attributes` table and in its node's `extras`, and `populate` (KiCad's DNP); the board
  gets `source.software` (for example KiCad 9.0.9). The viewer's `info()` returns them and both
  demos show them in the details panel ([spec §8.2](spec/README.md#82-ext_structural_metadata)).
- **Demo in React:** the demo is rebuilt in React on the new `@boardui/react` wrapper
  (`<BoardViewer>`, `<Widget>` for React widgets, JSX typings for `<board-viewer>`) and moves to
  <https://midub.github.io/boardui/react/>; <https://midub.github.io/boardui/> redirects there,
  keeping the query, so `?sample=…` links keep working. Its framework-independent parts, build
  helpers and e2e tests are shared (`packages/demo-shared`) for the Angular demo that follows.
  Importing `@boardui/viewer` without a DOM (server-side rendering) no longer throws.
- **Demo in Angular:** the same demo in Angular, at <https://midub.github.io/boardui/angular/>, on
  the new `@boardui/angular` wrapper (a standalone `<bui-board-viewer>` with signal inputs and
  typed outputs, `<bui-widget>` for Angular widgets). Both demos link to each other in the top
  bar, keeping `?sample=…`.
- A `Polygon`'s or `Cutout`'s own `Xform` (revisions B and C) is read and applied in the
  polygon's frame before the element that holds it is placed: in contours, profiles, outlines
  and features ([spec §6.1](spec/README.md#61-prisms)).
- KiCad's `pinOne="UNKNOWN"` (no pad numbered like a pin 1) counts as not given: no warning
  for mounting holes, fiducials and the like, unless a pin is numbered `UNKNOWN`.
- **Viewer load events:** `<board-viewer>` dispatches `bui-load` when a board has been loaded
  (`src`, `load`, `loadIpc2581`) and `bui-unload` just before another board replaces it; `loaded`
  tells whether it has a board. In `@boardui/react`, `<BoardViewer>` has `onLoad` and `onUnload`,
  and `<Widget>` attaches on its own once its board is loaded, detaches before the board is
  replaced and attaches again to the next board if it has the element.
- **Framing by what is shown:** the initial view, `setView` and the new `frame()` frame the
  visible layers and components only, so drawings on a hidden layer (e.g. fomu-pvt's `Eco1.User`
  documentation layer) no longer widen the view.
- **IPC consortium test cases:** the repository no longer hosts the IPC-2581 Consortium's test
  cases, which come without a licence; it links to them.
  `python3 spec/samples/ipc-testcases/fetch.py` fetches them from the consortium's archives
  (checked against the SHA-256s in `spec/samples/ipc-testcases/sources.json`), and the tests that
  read them are skipped without them (CI fetches them and requires them). The demo's test case
  cards link to the consortium's archives and name the file to open.

- **Runtime 3D models:** after a board loads, `<board-viewer>` replaces placeholder bodies with
  real models from pluggable sources (`modelSources`, `modelsShown`, `bui-model-progress`,
  `bui-model-done`), instanced like placeholders; immutable ones (KiCad's) are cached in Cache
  Storage. The new
  `@boardui/models` has `kicadSource` (KiCad's libraries, fetched from gitlab.com by footprint
  name), `mappingSource` (a model mapping file on your own server, with wildcards, `refDes` and
  attribute matches, URLs and templates) and the STEP (OpenCascade in a worker, loaded on first
  use) and OBJ loaders. The React and Angular wrappers pass them through; the demos load KiCad
  models (and `?models=<mapping URL>`) after every load, with a status line, a toggle and the
  credits. The converter skips mapping rules that only the viewer can apply, with a warning
  ([spec §6.15](spec/README.md#615-runtime-models-informative), [ADR 0014](docs/adr/0014-runtime-model-sources.md)).

## [1.1.1] - 2026-10-07

Importer fixes for Allegro, Altium and KiCad files. The glTF profile goes to 0.7 (still a draft):
a drill layer may now be synthesized.

- A standard primitive's own `Xform` (revision B; Allegro 17.4 writes it into revision C files)
  is read and applied in the primitive's frame before the pad places it, so a pad that uses
  such a primitive is turned, mirrored and offset as defined
  ([spec §6.1](spec/README.md#61-prisms)).
- KiCad board cut-outs: when a step's `Profile` has no `Cutout`, the closed contours of its
  `BOARD_OUTLINE` layer (`Edge.Cuts`) inside the profile are cut out of the board, with a
  warning. KiCad writes inner cut-outs and the gaps of a KiKit panel only there
  ([spec §6.7](spec/README.md#67-dielectric-and-outline)).
- Placeholder bodies: none for components without pads and without a height (logos, mounting
  holes, mouse bites), nor for one without a height whose outline covers more than half of its
  board (a carrier's module footprint); the components stay in the metadata. A package without
  pins no longer gives a warning for its `pinOne` ([spec §6.8](spec/README.md#68-components)).
- Altium (revision A and B) files: the `PadStack`s of a step become pads, via lands and holes,
  with their nets and component pins, so pins are checked against pads. A hole that is also on
  a drill layer (Altium's `Drill Guide`) is drilled once; a span without a drill layer gets a
  synthesized `@drill-<from>-<to>` (profile 0.7: drill layers may be synthesized;
  [spec §5](spec/README.md#5-element-identifiers), [§6.3](spec/README.md#63-holes-and-barrels)).
- A copper-function layer with `side="NONE"` or a non-copper stack-up `materialType` (Altium's
  core) is a dielectric, with a warning: LDO-PCB is 0.39 mm thick instead of 1.6 mm
  ([spec §6.4](spec/README.md#64-stack-up)).
## [1.1.0] - 2026-10-07

Board colours, the missing shapes, text, optional layers and panels. The glTF profile goes from
0.1 to 0.6 and is still a draft ([spec §11](spec/README.md#11-versioning)); minor versions
only add optional data, so 1.0.0 files still load.

- Eight more conformance samples from other exporters: Allegro rigid-flex, Polar Speedstack,
  Altium (revision A, `.cvg`), KiCad 9 (blind, buried and micro vias, castellations, inches,
  revision B, a KiKit panel) and KiCad 10. A `Stackup` without `name` (Polar, Altium) is now a
  warning instead of an error, and the CLI no longer panics on a parse error far into a file
  written on one line.
- Soldermask and silkscreen take their colours from the IPC-2581 file (`Spec` colours and KiCad's
  `Color : <name>`), with one material per colour; the demo's layer swatches follow them
  ([spec §6.10](spec/README.md#610-colours)).
- Profile 0.2: a material with a colour from the source is named `boardui/<kind>/<rrggbb>`
  ([spec §7](spec/README.md#7-materials)).
- **Missing shapes:** fiducials (`GlobalFiducial`, `LocalFiducial`, `BadBoardMark`,
  `GoodPanelMark`) become copper features of the new kind `FIDUCIAL` with a `fiducial` type
  property; `Hexagon` and `Moire` primitives are drawn; `HATCH` and `MESH` fills are drawn as
  lines clipped to their area; `LineDesc@lineProperty` dots and dashes strokes, and `ERASE` lines
  erase (profile 0.3; spec §6.1, §6.2, §8.2).
- **Optional layers:** paste, courtyard, assembly (fab) and documentation layers are converted,
  hidden by default: paste as a prism on the pads, drawings as thin sheets stacked outside the
  board. Package assembly drawings fill a synthesized `@assembly-top`/`-bottom` when the file has
  no assembly layer, and package silkscreens are drawn where the silkscreen layer has nothing for
  a part. The viewer and demo list the new layers, switched off (profile 0.4; spec §6.11–§6.13).
- **Text:** IPC-2581 `Text` is drawn as strokes, fitted into its `BoundingBox`: with the glyphs of
  a `FontDefEmbedded` font, else with a bundled single-stroke font (KiCad's Newstroke, ASCII and
  Latin-1, CC0); characters no font has are boxes. Features carry their strings in a new `text`
  property, shown by the viewer's `info()` (profile 0.5; spec §6.1, §8.2).
- **Panels:** `StepRepeat` is read and a panel converts with every board it places, nested,
  rotated and flipped (`mirror`, layers swapped). The default step is the panel (the step that
  no `StepRepeat` references); single-step files convert as before. Each placed copy is an
  instance (`inst/board-2`), and its components, pins, nets and features get the instance as an
  extra ID segment (`cmp/board-2/R1`, `feat/board-2/TOP/12`); nets are per board. The viewer
  resolves the new IDs (profile 0.6; spec §5, §6.14, [ADR 0013](docs/adr/0013-panels.md)).

## [1.0.0] - 2026-10-06

The first release of the 3D rewrite. It replaces the 2023 Angular/SVG viewer, which stays
available at the [`v1-angular`](https://github.com/midub/boardui/tree/v1-angular) tag.

### Highlights

- **Converter (Rust):** turns an IPC-2581 file into a glTF 2.0 board (GLB) that any glTF viewer
  can open. Copper, soldermask, silkscreen, dielectric, drills, plated barrels and slots are
  extruded from 2D regions, with overlaps resolved per layer. Components get placeholder bodies,
  or your own glTF models through a model mapping (`--models`).
- **Metadata in the GLB** ([profile spec](spec/README.md), version 0.1): every pad, trace, pin,
  component, net and layer can be identified, through `EXT_mesh_features`,
  `EXT_structural_metadata` and the `BOARDUI_board` extension.
- **`boardui` CLI:** `boardui convert` and `boardui validate` (profile rules, plus the Khronos
  validator when it is installed). Prebuilt binaries for Linux (x86_64, ARM64; static), macOS
  (Apple silicon, Intel) and Windows are attached to this release.
- **`<board-viewer>`:** a framework-independent web component on three.js (WebGPU with a WebGL2
  fallback): orbit, top/bottom/iso views, layer toggles, x-ray, hover and selection, net
  highlighting, camera focus, and HTML widgets that follow board elements.
- **Conversion in the browser:** `@boardui/converter` runs the converter as WebAssembly in a Web
  Worker, so boards are never uploaded.
- **Demo:** <https://midub.github.io/boardui/>. Drop an IPC-2581 file (or a board with a model
  mapping and models), view it, and download the GLB.

### Limits

- The browser converter is 32-bit WebAssembly (at most 4 GiB of memory): boards up to about
  250,000 features convert in the browser; use the CLI for larger ones.
- Not covered by profile 0.1: paste and documentation layers, assembly drawings, embedded
  components, cavities, rigid-flex.
- Nothing is published to npm or crates.io; the viewer and converter packages are used from this
  repository.

[Unreleased]: https://github.com/midub/boardui/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/midub/boardui/releases/tag/v1.1.1
[1.1.0]: https://github.com/midub/boardui/releases/tag/v1.1.0
[1.0.0]: https://github.com/midub/boardui/releases/tag/v1.0.0
