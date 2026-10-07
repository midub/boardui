import type { BoardViewerElement, WidgetAnchor, WidgetOcclusion } from '@boardui/viewer';
import { type ReactNode, useContext, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BoardViewerContext } from './board-viewer.js';

/** Props of {@link Widget}. */
export interface WidgetProps {
  /** ID of the board element to follow (spec §5), e.g. `cmp/U3`. */
  target: string;
  /** Where the widget attaches to the element; default `'top'`. */
  anchor?: WidgetAnchor | undefined;
  /** Screen-space offset in CSS pixels, `[x, y]` with +y down; default `[0, 0]`. */
  offset?: readonly [number, number] | undefined;
  /** What the widget does when the board hides its anchor; default `'fade'`. */
  occlusion?: WidgetOcclusion | undefined;
  /** Class of the widget's element, which the viewer positions. */
  className?: string | undefined;
  children?: ReactNode;
}

/**
 * Changes whenever the viewer shows another board: `0` while it has none, then a new number for
 * every board it loads (`bui-load`).
 */
function useBoard(viewer: BoardViewerElement | null): number {
  const [board, setBoard] = useState(0);
  useLayoutEffect(() => {
    if (!viewer) return;
    const update = () => {
      const loaded = viewer.loaded;
      setBoard((n) => (loaded ? n + 1 : 0));
    };
    update();
    viewer.addEventListener('bui-load', update);
    return () => viewer.removeEventListener('bui-load', update);
  }, [viewer]);
  return board;
}

/**
 * Renders its children in an HTML widget that follows a board element (`attachWidget`): a `<div>`
 * that the viewer positions over the board, with the children portalled into it. Must be inside a
 * {@link BoardViewer}.
 *
 * The widget attaches once the viewer has loaded a board with the element (`bui-load`; at once if
 * it already has), detaches just before that board is replaced (`bui-unload`), and attaches again
 * if the next board has the element too; its children then stay mounted. Without a board, or
 * while the board lacks the element, the widget renders nothing.
 */
export function Widget({
  target,
  anchor,
  offset,
  occlusion,
  className,
  children,
}: WidgetProps): ReactNode {
  const viewer = useContext(BoardViewerContext);
  const board = useBoard(viewer);
  // One element for the widget's lifetime, so that its children survive attaching it again.
  const element = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  // Arrays as dependencies by value.
  const anchorKey = typeof anchor === 'object' ? anchor.join() : anchor;
  const offsetKey = offset?.join();

  // biome-ignore lint/correctness/useExhaustiveDependencies: anchor and offset by value (keys).
  useLayoutEffect(() => {
    let detach: (() => void) | null = null;
    if (viewer && board) {
      element.current ??= document.createElement('div');
      try {
        detach = viewer.attachWidget(target, element.current, {
          ...(anchor !== undefined ? { anchor } : {}),
          ...(offset !== undefined ? { offset } : {}),
          ...(occlusion !== undefined ? { occlusion } : {}),
        });
      } catch {
        // No such element on this board.
      }
    }
    if (!viewer || !detach) {
      setHost(null);
      return;
    }
    setHost(element.current);
    // Before the board is replaced; the next board's `bui-load` runs this effect again.
    const release = () => {
      detach?.();
      detach = null;
    };
    viewer.addEventListener('bui-unload', release);
    return () => {
      viewer.removeEventListener('bui-unload', release);
      release();
    };
  }, [viewer, board, target, anchorKey, offsetKey, occlusion]);

  useLayoutEffect(() => {
    if (host) host.className = className ?? '';
  }, [host, className]);

  return host ? createPortal(children, host) : null;
}
