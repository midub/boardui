# Changelog

All notable changes to boardui. Versions follow [Semantic Versioning](https://semver.org); the
glTF profile has its own version (`profileVersion`, [spec §11](spec/README.md#11-versioning)).

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

[1.0.0]: https://github.com/midub/boardui/releases/tag/v1.0.0
