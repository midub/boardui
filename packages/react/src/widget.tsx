import type { WidgetAnchor, WidgetOcclusion } from '@boardui/viewer';
import { type ReactNode, useContext, useLayoutEffect, useState } from 'react';
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
 * Renders its children in an HTML widget that follows a board element (`attachWidget`): a `<div>`
 * that the viewer positions over the board, with the children portalled into it. Must be inside a
 * {@link BoardViewer}.
 *
 * The viewer needs a loaded board that has the element: mount widgets after the board has loaded
 * (e.g. after `await viewer.load(…)`) and unmount them before loading another one. A widget whose
 * element is unknown shows nothing.
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
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  // Arrays as dependencies by value.
  const anchorKey = typeof anchor === 'object' ? anchor.join() : anchor;
  const offsetKey = offset?.join();

  // biome-ignore lint/correctness/useExhaustiveDependencies: anchor and offset by value (keys).
  useLayoutEffect(() => {
    if (!viewer) return;
    const element = document.createElement('div');
    let detach: () => void;
    try {
      detach = viewer.attachWidget(target, element, {
        ...(anchor !== undefined ? { anchor } : {}),
        ...(offset !== undefined ? { offset } : {}),
        ...(occlusion !== undefined ? { occlusion } : {}),
      });
    } catch {
      // No board, or no such element in it.
      return;
    }
    setHost(element);
    return () => {
      detach();
      setHost(null);
    };
  }, [viewer, target, anchorKey, offsetKey, occlusion]);

  useLayoutEffect(() => {
    if (host) host.className = className ?? '';
  }, [host, className]);

  return host ? createPortal(children, host) : null;
}
