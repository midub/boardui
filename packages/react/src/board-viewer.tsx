import type {
  BoardViewerElement,
  ElementInfo,
  LoadProgress,
  ModelSource,
  ModelStatus,
} from '@boardui/viewer';
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
  extends Omit<
    HTMLAttributes<BoardViewerElement>,
    'onError' | 'onLoad' | 'onProgress' | 'onSelect'
  > {
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
  /**
   * Where runtime models come from (`modelSources`), e.g. `[kicadSource()]` of
   * `@boardui/models`. Keep the array stable (`useMemo`): a new array starts over.
   */
  modelSources?: readonly ModelSource[] | undefined;
  /** Runtime models shown (default) or the placeholder bodies (`modelsShown`). */
  modelsShown?: boolean | undefined;
  /** The element under the pointer changed (`bui-hover`); `detail` is `null` off the board. */
  onHover?: ((event: CustomEvent<ElementInfo | null>) => void) | undefined;
  /** The user clicked an element, or empty space (`bui-select`, `detail` `null`). */
  onSelect?: ((event: CustomEvent<ElementInfo | null>) => void) | undefined;
  /** Progress of `loadIpc2581` (`bui-progress`). */
  onProgress?: ((event: CustomEvent<LoadProgress>) => void) | undefined;
  /**
   * A board was loaded and replaced the previous one (`bui-load`), from `src`, `load` or
   * `loadIpc2581`; `detail` is `info('board')`.
   */
  onLoad?: ((event: CustomEvent<ElementInfo>) => void) | undefined;
  /** The board is about to be replaced (`bui-unload`); the next one follows with `onLoad`. */
  onUnload?: ((event: CustomEvent<ElementInfo>) => void) | undefined;
  /** Loading `src` failed (`error`). */
  onError?: ((event: ErrorEvent) => void) | undefined;
  /** Runtime models are loading (`bui-model-progress`). */
  onModelProgress?: ((event: CustomEvent<ModelStatus>) => void) | undefined;
  /** Every component has been tried for a runtime model (`bui-model-done`). */
  onModelDone?: ((event: CustomEvent<ModelStatus>) => void) | undefined;
  /** The `<board-viewer>` element, for its methods (`load`, `loadIpc2581`, `highlight`, …). */
  ref?: Ref<BoardViewerElement> | undefined;
  /** {@link Widget}s, which follow board elements. */
  children?: ReactNode;
}

type Handlers = Pick<
  BoardViewerProps,
  | 'onHover'
  | 'onSelect'
  | 'onProgress'
  | 'onLoad'
  | 'onUnload'
  | 'onError'
  | 'onModelProgress'
  | 'onModelDone'
>;

/** The `<board-viewer>` of the enclosing {@link BoardViewer}, once it is mounted. */
export const BoardViewerContext = createContext<BoardViewerElement | null>(null);

/**
 * `<board-viewer>` as a React component: `src`, `backend`, `autoRotate`, `xray`, `modelSources`
 * and `modelsShown` as props, its events as `onHover`, `onSelect`, `onProgress`, `onLoad`,
 * `onUnload`, `onError`, `onModelProgress` and `onModelDone`, and `ref` to the element for its
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
  modelSources,
  modelsShown,
  onHover,
  onSelect,
  onProgress,
  onLoad,
  onUnload,
  onError,
  onModelProgress,
  onModelDone,
  children,
  ...attributes
}: BoardViewerProps): ReactNode {
  const element = useRef<BoardViewerElement>(null);
  const [viewer, setViewer] = useState<BoardViewerElement | null>(null);
  const handlers = useRef<Handlers>({});
  useLayoutEffect(() => {
    handlers.current = {
      onHover,
      onSelect,
      onProgress,
      onLoad,
      onUnload,
      onError,
      onModelProgress,
      onModelDone,
    };
  });
  useImperativeHandle(ref, () => element.current as BoardViewerElement, []);

  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    setViewer(target);
    const hover = (e: CustomEvent<ElementInfo | null>) => handlers.current.onHover?.(e);
    const select = (e: CustomEvent<ElementInfo | null>) => handlers.current.onSelect?.(e);
    const progress = (e: CustomEvent<LoadProgress>) => handlers.current.onProgress?.(e);
    const load = (e: CustomEvent<ElementInfo>) => handlers.current.onLoad?.(e);
    const unload = (e: CustomEvent<ElementInfo>) => handlers.current.onUnload?.(e);
    const error = (e: ErrorEvent) => handlers.current.onError?.(e);
    const modelProgress = (e: CustomEvent<ModelStatus>) => handlers.current.onModelProgress?.(e);
    const modelDone = (e: CustomEvent<ModelStatus>) => handlers.current.onModelDone?.(e);
    target.addEventListener('bui-hover', hover);
    target.addEventListener('bui-select', select);
    target.addEventListener('bui-progress', progress);
    target.addEventListener('bui-load', load);
    target.addEventListener('bui-unload', unload);
    target.addEventListener('error', error);
    target.addEventListener('bui-model-progress', modelProgress);
    target.addEventListener('bui-model-done', modelDone);
    return () => {
      target.removeEventListener('bui-hover', hover);
      target.removeEventListener('bui-select', select);
      target.removeEventListener('bui-progress', progress);
      target.removeEventListener('bui-load', load);
      target.removeEventListener('bui-unload', unload);
      target.removeEventListener('error', error);
      target.removeEventListener('bui-model-progress', modelProgress);
      target.removeEventListener('bui-model-done', modelDone);
    };
  }, []);

  useLayoutEffect(() => {
    if (element.current && autoRotate !== undefined) element.current.autoRotate = autoRotate;
  }, [autoRotate]);

  useLayoutEffect(() => {
    const target = element.current;
    if (target && xray !== undefined && target.xray !== xray) target.setXray(xray);
  }, [xray]);

  useLayoutEffect(() => {
    const target = element.current;
    if (target && modelSources !== undefined && target.modelSources !== modelSources) {
      target.modelSources = modelSources;
    }
  }, [modelSources]);

  useLayoutEffect(() => {
    const target = element.current;
    if (target && modelsShown !== undefined && target.modelsShown !== modelsShown) {
      target.modelsShown = modelsShown;
    }
  }, [modelsShown]);

  return (
    <board-viewer ref={element} src={src} backend={backend} {...attributes}>
      <BoardViewerContext value={viewer}>{children}</BoardViewerContext>
    </board-viewer>
  );
}
