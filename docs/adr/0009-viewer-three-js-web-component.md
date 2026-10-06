# 0009 Viewer: TypeScript, three.js, web component

**Status:** Accepted, 2026-10-06

## Context

Widgets are HTML, so the viewer must live comfortably in a web page. The worry was whether a JS engine copes with dense boards. Performance depends on the draw-call count, not the language, and [ADR 0008](0008-hybrid-metadata.md) keeps draw calls low.

## Decision

- The viewer is written in TypeScript with three.js. It uses `WebGPURenderer` (with automatic WebGL2 fallback) and TSL shaders.
- It ships as a framework-independent custom element, `<board-viewer>` (`@boardui/viewer`). Angular and React wrappers are optional and thin.
- **Element state** (hover, selection, colour, hidden) lives in a per-feature state texture that the shader reads. Picking uses `three-mesh-bvh`.
- **Widgets** are HTML elements in an overlay, positioned each frame from their element's anchor.
- **Metadata loading** uses the `3d-tiles-renderer` plugins for `EXT_mesh_features` and `EXT_structural_metadata`.

## Consequences

- Widgets can be built in any framework.
- Net highlighting means writing texels, not swapping materials.
- If `WebGPURenderer` causes trouble, falling back to `WebGLRenderer` means porting the TSL shader to a material patch.

## Alternatives considered

- **Babylon.js:** solid, but fewer ready-made tools for the metadata extensions.
- **Rust viewer (Bevy/wgpu):** one language, but a download of several MB, a second rendering stack, and HTML widgets need positions passed from WASM to the page every frame.
