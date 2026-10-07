/**
 * JSX typings for using `<board-viewer>` directly in React 19, which sets the element's properties
 * (`autoRotate`) and attributes (`src`, `backend`) and adds listeners for `on<event>` props:
 *
 * ```tsx
 * <board-viewer ref={ref} src="board.glb" autoRotate onbui-select={(e) => setSelected(e.detail)} />
 * ```
 */
import type { BoardViewerElement, ElementInfo, LoadProgress } from '@boardui/viewer';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

/** Props of `<board-viewer>` in JSX. */
export interface BoardViewerElementProps
  extends DetailedHTMLProps<HTMLAttributes<BoardViewerElement>, BoardViewerElement> {
  /** URL of a GLB to load; failures dispatch an `error` event. */
  src?: string | undefined;
  /** `'webgl'` uses WebGL2 even where WebGPU is available; read when the element connects. */
  backend?: 'webgl' | undefined;
  autoRotate?: boolean | undefined;
  'onbui-hover'?: ((event: CustomEvent<ElementInfo | null>) => void) | undefined;
  'onbui-select'?: ((event: CustomEvent<ElementInfo | null>) => void) | undefined;
  'onbui-progress'?: ((event: CustomEvent<LoadProgress>) => void) | undefined;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'board-viewer': BoardViewerElementProps;
    }
  }
}
