/**
 * @boardui/react: React components for `<board-viewer>` (`@boardui/viewer`). Importing this module
 * defines the element in a browser; on a server (server-side rendering) the import is safe and
 * `<BoardViewer>` renders a plain `<board-viewer>` tag.
 */
import '@boardui/viewer';

export type { BoardViewerElement, ElementInfo, LoadProgress } from '@boardui/viewer';
export { BoardViewer, BoardViewerContext, type BoardViewerProps } from './board-viewer.js';
export type { BoardViewerElementProps } from './jsx.js';
export { Widget, type WidgetProps } from './widget.js';
