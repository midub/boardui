import { hasTag, nextHighlightColor } from '@boardui/demo-shared';
import type { BoardViewerElement, ElementInfo } from '@boardui/react';
import { useState } from 'react';

/** A tag: a widget that follows a selected component, pin or pad. */
export interface Tag {
  info: ElementInfo;
  /** Pinned tags stay when the selection changes. */
  pinned: boolean;
}

/** A highlighted net. */
export interface Highlight {
  net: string;
  color: string;
  remove: () => void;
}

interface State {
  generation: number;
  selection: ElementInfo | null;
  hover: ElementInfo | null;
  tags: Tag[];
  highlights: Highlight[];
}

const initial = (generation: number): State => ({
  generation,
  selection: null,
  hover: null,
  tags: [],
  highlights: [],
});

/**
 * The selection, hover, tags and net highlights of the board. They reset when a load starts
 * (`generation`); the viewer resets its own selection and highlights when it loads a board.
 */
export function useBoardUi(viewer: () => BoardViewerElement, generation: number) {
  const [state, setState] = useState(() => initial(generation));
  if (state.generation !== generation) setState(initial(generation));

  /** The viewer selected an element (a click), or the UI did. */
  const onSelect = (info: ElementInfo | null) =>
    setState((s) => {
      let tags = s.tags;
      const previous = s.selection?.id;
      if (previous && previous !== info?.id) {
        tags = tags.filter((t) => t.info.id !== previous || t.pinned);
      }
      if (info && hasTag(info) && !tags.some((t) => t.info.id === info.id)) {
        tags = [...tags, { info, pinned: false }];
      }
      return { ...s, selection: info, tags };
    });

  /** Selects an element from the UI (the viewer selects on click by itself). */
  const select = (id: string | null, focus = false) => {
    const v = viewer();
    v.select(id);
    onSelect(id ? v.info(id) : null);
    if (id && focus) v.focus(id);
  };

  /** Highlights a net in the next free colour, or removes its highlight. */
  const toggleHighlight = (net: string, focus = false) => {
    const existing = state.highlights.find((h) => h.net === net);
    if (existing) {
      existing.remove();
      setState((s) => ({ ...s, highlights: s.highlights.filter((h) => h.net !== net) }));
      return;
    }
    const color = nextHighlightColor(state.highlights.map((h) => h.color));
    const remove = viewer().highlight({ net }, { color });
    setState((s) => ({ ...s, highlights: [...s.highlights, { net, color, remove }] }));
    if (focus) viewer().focus(net);
  };

  const togglePin = (id: string) =>
    setState((s) => ({
      ...s,
      tags: s.tags.map((t) => (t.info.id === id ? { ...t, pinned: !t.pinned } : t)),
    }));

  const removeTag = (id: string) =>
    setState((s) => ({ ...s, tags: s.tags.filter((t) => t.info.id !== id) }));

  const setHover = (hover: ElementInfo | null) => setState((s) => ({ ...s, hover }));

  return { ...state, onSelect, select, toggleHighlight, togglePin, removeTag, setHover };
}

export type BoardUi = ReturnType<typeof useBoardUi>;
