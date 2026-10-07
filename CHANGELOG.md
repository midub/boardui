# Changelog

All notable changes to boardui. Versions follow [Semantic Versioning](https://semver.org); the
glTF profile has its own version (`profileVersion`, [spec §11](spec/README.md#11-versioning)).

## [Unreleased]

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

[Unreleased]: https://github.com/midub/boardui/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/midub/boardui/releases/tag/v1.1.0
[1.0.0]: https://github.com/midub/boardui/releases/tag/v1.0.0
