import { Injectable, signal } from '@angular/core';
import type { ElementInfo } from '@boardui/angular';
import { hasTag, nextHighlightColor } from '@boardui/demo-shared';
import { viewer } from './session';

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

/**
 * The selection, hover, tags and net highlights of the board. They reset when a load starts
 * ({@link reset}); the viewer resets its own selection and highlights when it loads a board.
 */
@Injectable()
export class BoardUi {
  readonly selection = signal<ElementInfo | null>(null);
  readonly hover = signal<ElementInfo | null>(null);
  readonly tags = signal<Tag[]>([]);
  readonly highlights = signal<Highlight[]>([]);

  /** A load started. */
  reset(): void {
    this.selection.set(null);
    this.hover.set(null);
    this.tags.set([]);
    this.highlights.set([]);
  }

  /** The viewer selected an element (a click), or the UI did. */
  onSelect(info: ElementInfo | null): void {
    const previous = this.selection()?.id;
    this.tags.update((tags) => {
      if (previous && previous !== info?.id) {
        tags = tags.filter((t) => t.info.id !== previous || t.pinned);
      }
      if (info && hasTag(info) && !tags.some((t) => t.info.id === info.id)) {
        tags = [...tags, { info, pinned: false }];
      }
      return tags;
    });
    this.selection.set(info);
  }

  /** Selects an element from the UI (the viewer selects on click by itself). */
  select(id: string | null, focus = false): void {
    const v = viewer();
    v.select(id);
    this.onSelect(id ? v.info(id) : null);
    if (id && focus) v.focus(id);
  }

  /** Highlights a net in the next free colour, or removes its highlight. */
  toggleHighlight(net: string, focus = false): void {
    const existing = this.highlights().find((h) => h.net === net);
    if (existing) {
      existing.remove();
      this.highlights.update((list) => list.filter((h) => h.net !== net));
      return;
    }
    const color = nextHighlightColor(this.highlights().map((h) => h.color));
    const remove = viewer().highlight({ net }, { color });
    this.highlights.update((list) => [...list, { net, color, remove }]);
    if (focus) viewer().focus(net);
  }

  togglePin(id: string): void {
    this.tags.update((tags) =>
      tags.map((t) => (t.info.id === id ? { ...t, pinned: !t.pinned } : t)),
    );
  }

  removeTag(id: string): void {
    this.tags.update((tags) => tags.filter((t) => t.info.id !== id));
  }
}
