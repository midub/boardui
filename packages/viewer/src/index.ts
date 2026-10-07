/**
 * @boardui/viewer: the `<board-viewer>` web component, which shows boardui glTF boards
 * (spec/README.md) in 3D. Importing this module defines the element (in a browser; in Node, e.g.
 * for server-side rendering, the import is safe but defines nothing).
 *
 * @example
 * ```html
 * <board-viewer src="board.glb"></board-viewer>
 * <script type="module">
 *   import '@boardui/viewer';
 *   const viewer = document.querySelector('board-viewer');
 *   viewer.addEventListener('bui-select', (e) => console.log(e.detail));
 * </script>
 * ```
 */
import { BoardViewerElement } from './element.js';

export { DRAWING_ROLES, type LayerRole, OPTIONAL_ROLES, type Side } from './board-extension.js';
export type { ElementInfo, ListableKind } from './board-model.js';
export type { ViewPreset } from './camera.js';
export {
  BoardViewerElement,
  type BoardViewerEventMap,
  type ElementTarget,
  type LayerState,
  type LoadIpc2581Options,
  type LoadProgress,
} from './element.js';
export { type ElementKind, encodeIdSegment, featureId } from './ids.js';
export type { BoardSource } from './load.js';
export type { RenderStats } from './renderer.js';
export type { WidgetAnchor, WidgetOcclusion, WidgetOptions } from './widgets.js';

// Not defined where there is no DOM (server-side rendering), so importing the module is safe there.
if (globalThis.customElements && !customElements.get('board-viewer')) {
  customElements.define('board-viewer', BoardViewerElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'board-viewer': BoardViewerElement;
  }
}
