import type { BoardViewerElement, ElementInfo, LoadProgress } from '@boardui/viewer';
import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/** Props of {@link BoardViewer}: the element's settings, its events, and any HTML attribute. */
export interface BoardViewerProps
  extends Omit<HTMLAttributes<BoardViewerElement>, 'onError' | 'onProgress' | 'onSelect'> {
  /** URL of a GLB to load (the `src` attribute); failures call {@link onError}. */
  src?: string | undefined;
  /**
   * `'webgl'` uses WebGL2 even where WebGPU is available. Read when the element is created;
   * changing it later has no effect.
   */
  backend?: 'webgl' | undefined;
  /** Whether the camera orbits the board on its own (`autoRotate`). */
  autoRotate?: boolean | undefined;
  /** X-ray mode (`setXray`). Leave it undefined to control x-ray through the element. */
  xray?: boolean | undefined;
  /** The element under the pointer changed (`bui-hover`); `detail` is `null` off the board. */
  onHover?: ((event: CustomEvent<ElementInfo | null>) => void) | undefined;
  /** The user clicked an element, or empty space (`bui-select`, `detail` `null`). */
  onSelect?: ((event: CustomEvent<ElementInfo | null>) => void) | undefined;
  /** Progress of `loadIpc2581` (`bui-progress`). */
  onProgress?: ((event: CustomEvent<LoadProgress>) => void) | undefined;
  /** Loading `src` failed (`error`). */
  onError?: ((event: ErrorEvent) => void) | undefined;
  /** The `<board-viewer>` element, for its methods (`load`, `loadIpc2581`, `highlight`, …). */
  ref?: Ref<BoardViewerElement> | undefined;
  /** {@link Widget}s, which follow board elements. */
  children?: ReactNode;
}

type Handlers = Pick<BoardViewerProps, 'onHover' | 'onSelect' | 'onProgress' | 'onError'>;

/** The `<board-viewer>` of the enclosing {@link BoardViewer}, once it is mounted. */
export const BoardViewerContext = createContext<BoardViewerElement | null>(null);

/**
 * `<board-viewer>` as a React component: `src`, `backend`, `autoRotate` and `xray` as props, its
 * events as `onHover`, `onSelect`, `onProgress` and `onError`, and `ref` to the element for its
 * methods. Children may be {@link Widget}s.
 *
 * @example
 * ```tsx
 * const viewer = useRef<BoardViewerElement>(null);
 * <BoardViewer ref={viewer} src="board.glb" style={{ height: 600 }}
 *   onSelect={(e) => setSelected(e.detail)} />
 * ```
 */
export function BoardViewer({
  ref,
  src,
  backend,
  autoRotate,
  xray,
  onHover,
  onSelect,
  onProgress,
  onError,
  children,
  ...attributes
}: BoardViewerProps): ReactNode {
  const element = useRef<BoardViewerElement>(null);
  const [viewer, setViewer] = useState<BoardViewerElement | null>(null);
  const handlers = useRef<Handlers>({});
  useLayoutEffect(() => {
    handlers.current = { onHover, onSelect, onProgress, onError };
  });
  useImperativeHandle(ref, () => element.current as BoardViewerElement, []);

  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    setViewer(target);
    const hover = (e: CustomEvent<ElementInfo | null>) => handlers.current.onHover?.(e);
    const select = (e: CustomEvent<ElementInfo | null>) => handlers.current.onSelect?.(e);
    const progress = (e: CustomEvent<LoadProgress>) => handlers.current.onProgress?.(e);
    const error = (e: ErrorEvent) => handlers.current.onError?.(e);
    target.addEventListener('bui-hover', hover);
    target.addEventListener('bui-select', select);
    target.addEventListener('bui-progress', progress);
    target.addEventListener('error', error);
    return () => {
      target.removeEventListener('bui-hover', hover);
      target.removeEventListener('bui-select', select);
      target.removeEventListener('bui-progress', progress);
      target.removeEventListener('error', error);
    };
  }, []);

  useLayoutEffect(() => {
    if (element.current && autoRotate !== undefined) element.current.autoRotate = autoRotate;
  }, [autoRotate]);

  useLayoutEffect(() => {
    const target = element.current;
    if (target && xray !== undefined && target.xray !== xray) target.setXray(xray);
  }, [xray]);

  return (
    <board-viewer ref={element} src={src} backend={backend} {...attributes}>
      <BoardViewerContext value={viewer}>{children}</BoardViewerContext>
    </board-viewer>
  );
}
