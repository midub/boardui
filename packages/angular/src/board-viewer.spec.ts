import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { BoardViewerElement, ElementInfo, LoadProgress, ModelSource } from '@boardui/viewer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardViewer, Widget } from './index';

const viewerClass = () => customElements.get('board-viewer') as typeof BoardViewerElement;
const board = { id: 'board', kind: 'board', properties: { thickness: 0.0016 } } as ElementInfo;
const fire = (target: Element, type: string, detail: unknown) =>
  target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

@Component({
  imports: [BoardViewer, Widget],
  template: `
    <bui-board-viewer
      #viewer="buiBoardViewer"
      id="viewer"
      [src]="src()"
      [backend]="backend()"
      [autoRotate]="spin()"
      [xray]="xray()"
      [modelSources]="sources()"
      [modelsShown]="models()"
      (modelProgress)="events.push(['modelProgress', $event])"
      (modelDone)="events.push(['modelDone', $event])"
      (hover)="events.push(['hover', $event])"
      (select)="events.push(['select', $event])"
      (progress)="events.push(['progress', $event])"
      (load)="events.push(['load', $event])"
      (unload)="events.push(['unload', $event])"
      (error)="events.push(['error', $event])"
    >
      @for (id of widgets(); track $index) {
        <bui-widget [target]="id" anchor="top" [offset]="[0, -6]" [class]="widgetClass()">
          <b>{{ id }}</b><input />
        </bui-widget>
      }
    </bui-board-viewer>
    <output>{{ viewer.element.localName }}</output>
  `,
})
class Host {
  readonly src = signal<string | undefined>(undefined);
  readonly backend = signal<'webgl' | undefined>(undefined);
  readonly spin = signal<boolean | undefined>(undefined);
  readonly xray = signal<boolean | undefined>(undefined);
  readonly sources = signal<readonly ModelSource[] | undefined>(undefined);
  readonly models = signal<boolean | undefined>(undefined);
  readonly widgets = signal<string[]>([]);
  readonly widgetClass = signal('tag');
  readonly viewer = viewChild.required(BoardViewer);
  readonly events: [string, unknown][] = [];
}

@Component({
  imports: [BoardViewer],
  template: '<bui-board-viewer autoRotate xray />',
})
class Attributes {
  readonly viewer = viewChild.required(BoardViewer);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const host = fixture.componentInstance;
  return { fixture, host, element: host.viewer().element, root: fixture.nativeElement as Element };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BoardViewer', () => {
  it('creates <board-viewer> in its element and gives access to it (exportAs too)', () => {
    const { root, element } = render();
    expect(element).toBeInstanceOf(viewerClass());
    expect(root.querySelector('bui-board-viewer#viewer > board-viewer')).toBe(element);
    expect(element.isConnected).toBe(true);
    // In the template too (`exportAs`).
    expect(root.querySelector('output')?.textContent).toBe('board-viewer');
  });

  it('sets src and backend before the element connects', async () => {
    // The element reads `backend` once, when it connects. Record what it reads then, and hide
    // it, since jsdom has no WebGL (the WebGPU adapter of the setup never comes).
    const read: [string | null, boolean][] = [];
    vi.spyOn(viewerClass().prototype, 'getAttribute').mockImplementation(function (
      this: BoardViewerElement,
      name: string,
    ) {
      const value = Element.prototype.getAttribute.call(this, name);
      if (name !== 'backend') return value;
      read.push([value, this.isConnected]);
      return null;
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.backend.set('webgl');
    fixture.componentInstance.src.set('data:,not-a-glb');
    fixture.detectChanges();
    expect(read).toEqual([['webgl', true]]);
    expect(fixture.componentInstance.viewer().element.getAttribute('src')).toBe('data:,not-a-glb');

    // Not a GLB: the `error` output gets the element's ErrorEvent.
    await vi.waitFor(() => expect(fixture.componentInstance.events).toHaveLength(1));
    const [name, event] = fixture.componentInstance.events[0] ?? [];
    expect(name).toBe('error');
    expect(event).toBeInstanceOf(ErrorEvent);
  });

  it('sets the model sources and whether models are shown, and emits the model events', () => {
    const { fixture, host, element } = render();
    const sources: ModelSource[] = [{ name: 'test', resolve: async () => null }];
    expect(element.modelSources).toEqual([]);
    host.sources.set(sources);
    host.models.set(false);
    fixture.detectChanges();
    expect(element.modelSources).toEqual(sources);
    expect(element.modelsShown).toBe(false);
    host.models.set(undefined);
    fixture.detectChanges();
    expect(element.modelsShown).toBe(false);
    fire(element, 'bui-model-progress', { loaded: 1 });
    fire(element, 'bui-model-done', { loaded: 2 });
    expect(host.events).toEqual([
      ['modelProgress', { loaded: 1 }],
      ['modelDone', { loaded: 2 }],
    ]);
  });

  it('loads a new src once', () => {
    const { fixture, host, element } = render();
    const load = vi.spyOn(element, 'load').mockResolvedValue();
    host.src.set('a.glb');
    fixture.detectChanges();
    fixture.detectChanges();
    expect(load.mock.calls).toEqual([['a.glb']]);
    host.src.set('b.glb');
    fixture.detectChanges();
    expect(load.mock.calls).toEqual([['a.glb'], ['b.glb']]);
  });

  it('sets autoRotate and x-ray, and leaves them alone when unset', () => {
    const { fixture, host, element } = render();
    element.autoRotate = true;
    fixture.detectChanges();
    expect(element.autoRotate).toBe(true);
    host.spin.set(false);
    host.xray.set(true);
    fixture.detectChanges();
    expect(element.autoRotate).toBe(false);
    expect(element.xray).toBe(true);
    host.xray.set(false);
    fixture.detectChanges();
    expect(element.xray).toBe(false);
  });

  it('takes autoRotate and xray as attributes without a value', () => {
    const fixture = TestBed.createComponent(Attributes);
    fixture.detectChanges();
    const { element } = fixture.componentInstance.viewer();
    expect(element.autoRotate).toBe(true);
    expect(element.xray).toBe(true);
  });

  it('emits the typed details of the element’s events', () => {
    const { host, element } = render();
    const info = { id: 'cmp/R1', kind: 'component' } as ElementInfo;
    const progress: LoadProgress = { stage: 'convert', step: 'parse', fraction: 0.5 };
    element.dispatchEvent(new CustomEvent('bui-hover', { detail: info }));
    element.dispatchEvent(new CustomEvent('bui-select', { detail: null }));
    element.dispatchEvent(new CustomEvent('bui-progress', { detail: progress }));
    fire(element, 'bui-unload', board);
    fire(element, 'bui-load', board);
    expect(host.events).toEqual([
      ['hover', info],
      ['select', null],
      ['progress', progress],
      ['unload', board],
      ['load', board],
    ]);
  });
});

/** Counts its instances: whether a widget's content was created again. */
@Component({ selector: 'test-tag', template: '<b>tag {{ id }}</b>' })
class Tag {
  static count = 0;
  readonly id = ++Tag.count;
}

@Component({
  imports: [BoardViewer, Widget, Tag],
  template: `
    <bui-board-viewer>
      <bui-widget target="cmp/R1"><test-tag /></bui-widget>
    </bui-board-viewer>
  `,
})
class Tagged {
  readonly viewer = viewChild.required(BoardViewer);
}

describe('Widget', () => {
  /**
   * Stubs the viewer's board (`loaded`, `attachWidget`) as the element behaves: widgets attach to
   * elements of the loaded board, with slot and append; `load` replaces the board with events.
   */
  function stubBoard({ loaded = true } = {}) {
    const prototype = viewerClass().prototype;
    const state = { loaded, missing: new Set(['cmp/missing']) };
    vi.spyOn(prototype, 'loaded', 'get').mockImplementation(() => state.loaded);
    const detach = vi.fn();
    const attach = vi.spyOn(prototype, 'attachWidget').mockImplementation(function (
      this: BoardViewerElement,
      id,
      element,
    ) {
      if (!state.loaded) throw new Error('No board loaded');
      if (state.missing.has(id)) throw new RangeError(`Unknown element: ${id}`);
      element.slot = 'widget';
      this.append(element);
      return () => {
        detach(id);
        element.remove();
      };
    });
    /** Loads a board that lacks `missing`: `bui-unload` for the current one, then `bui-load`. */
    const load = (viewer: Element, missing: string[] = []) => {
      if (state.loaded) fire(viewer, 'bui-unload', board);
      state.loaded = true;
      state.missing = new Set(['cmp/missing', ...missing]);
      fire(viewer, 'bui-load', board);
    };
    return { attach, detach, load };
  }

  it('shows its content in a widget that follows the element', () => {
    const { attach, detach } = stubBoard();
    const { fixture, host, element } = render();
    host.widgets.set(['cmp/R1']);
    fixture.detectChanges();
    const widget = element.querySelector(':scope > bui-widget[slot="widget"]');
    expect(widget?.className).toBe('tag');
    expect(widget?.textContent).toBe('cmp/R1');
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0]?.[0]).toBe('cmp/R1');
    expect(attach.mock.calls[0]?.[1]).toBe(widget);
    expect(attach.mock.calls[0]?.[2]).toEqual({ anchor: 'top', offset: [0, -6] });

    // Same options by value: not attached again. Another element: detached and attached again.
    host.widgetClass.set('tag pinned');
    fixture.detectChanges();
    expect(attach).toHaveBeenCalledTimes(1);
    expect(widget?.className).toBe('tag pinned');
    host.widgets.set(['cmp/R2']);
    fixture.detectChanges();
    expect(detach).toHaveBeenCalledWith('cmp/R1');
    expect(attach).toHaveBeenCalledTimes(2);
    expect(element.querySelectorAll('[slot="widget"]')).toHaveLength(1);
    expect(element.querySelector('[slot="widget"]')).toBe(widget);
    expect(widget?.textContent).toBe('cmp/R2');
    fixture.destroy();
    expect(detach).toHaveBeenCalledWith('cmp/R2');
  });

  it('shows nothing for an unknown element', () => {
    stubBoard();
    const { fixture, host, root } = render();
    host.widgets.set(['cmp/missing']);
    fixture.detectChanges();
    expect(root.querySelector('bui-widget')).toBeNull();
  });

  it('attaches once a board is loaded, and again to the next board', () => {
    const { attach, detach, load } = stubBoard({ loaded: false });
    Tag.count = 0;
    const fixture = TestBed.createComponent(Tagged);
    fixture.detectChanges();
    const viewer = fixture.componentInstance.viewer().element;
    const widget = () => viewer.querySelector('[slot="widget"]');
    expect(attach).not.toHaveBeenCalled();
    expect(widget()).toBeNull();

    load(viewer);
    fixture.detectChanges();
    expect(attach).toHaveBeenCalledTimes(1);
    const tag = widget();
    expect(tag?.textContent).toBe('tag 1');

    // Detached while `bui-unload` runs, before the board is replaced; then attached again, with
    // the same element and content.
    let detached = 0;
    viewer.addEventListener('bui-unload', () => (detached = detach.mock.calls.length), {
      once: true,
    });
    load(viewer);
    expect(detached).toBe(1);
    fixture.detectChanges();
    expect(attach).toHaveBeenCalledTimes(2);
    expect(widget()).toBe(tag);

    // A board without the element: not shown; the next one with it: shown again, as it was.
    load(viewer, ['cmp/R1']);
    fixture.detectChanges();
    expect(detach).toHaveBeenCalledTimes(2);
    expect(widget()).toBeNull();
    load(viewer);
    fixture.detectChanges();
    expect(widget()).toBe(tag);
    expect(tag?.textContent).toBe('tag 1');
  });

  it('keeps the native select event of a field in a widget from the select output', () => {
    stubBoard();
    const { fixture, host, element } = render();
    host.widgets.set(['cmp/R1']);
    fixture.detectChanges();
    element.querySelector('input')?.dispatchEvent(new Event('select', { bubbles: true }));
    expect(host.events).toEqual([]);
  });
});
