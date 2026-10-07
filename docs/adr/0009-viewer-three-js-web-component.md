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

## Notes

- 2026-10-07: the demo moves to React and Angular, one feature-identical app per framework, each built on its wrapper ([roadmap](../roadmap.md#demos-in-react-and-angular)). `@boardui/react` is the first wrapper: a `<BoardViewer>` component (the element's settings as props, its events as typed handlers, `ref` to the element) and `<Widget>`, which renders React children into a viewer widget. The decision stands: the element does the work, the wrappers stay thin and depend on it, not the other way round. For the wrappers, importing `@boardui/viewer` without a DOM (server-side rendering) no longer throws; the element is only defined in a browser.
- 2026-10-07: `@boardui/angular` is the second wrapper: a standalone `<bui-board-viewer>` (signal inputs for the settings, typed outputs for the events, `element` for the methods) and `<bui-widget>`, whose own element becomes the viewer widget. The component creates the `<board-viewer>` and connects it only once its inputs are set, because the element reads `backend` when it connects and Angular connects template elements before it sets their bindings. Angular's application builder doesn't bundle the `new URL(…, import.meta.url)` workers and WASM module of dependencies, so an Angular app copies them next to its scripts (the Angular demo does it with esbuild); the packages are unchanged.

## Alternatives considered

- **Babylon.js:** solid, but fewer ready-made tools for the metadata extensions.
- **Rust viewer (Bevy/wgpu):** one language, but a download of several MB, a second rendering stack, and HTML widgets need positions passed from WASM to the page every frame.
