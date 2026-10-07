import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { BoardViewerElement, ElementInfo, LoadProgress } from '@boardui/viewer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardViewer, Widget } from './index';

const viewerClass = () => customElements.get('board-viewer') as typeof BoardViewerElement;

@Component({
  imports: [BoardViewer, Widget],
  template: `
    <bui-board-viewer
      id="viewer"
      [src]="src()"
      [backend]="backend()"
      [autoRotate]="spin()"
      [xray]="xray()"
      (hover)="events.push(['hover', $event])"
      (select)="events.push(['select', $event])"
      (progress)="events.push(['progress', $event])"
      (error)="events.push(['error', $event])"
    >
      @for (id of widgets(); track $index) {
        <bui-widget [target]="id" anchor="top" [offset]="[0, -6]" [class]="widgetClass()">
          <b>{{ id }}</b><input />
        </bui-widget>
      }
    </bui-board-viewer>
  `,
})
class Host {
  readonly src = signal<string | undefined>(undefined);
  readonly backend = signal<'webgl' | undefined>(undefined);
  readonly spin = signal<boolean | undefined>(undefined);
  readonly xray = signal<boolean | undefined>(undefined);
  readonly widgets = signal<string[]>([]);
  readonly widgetClass = signal('tag');
  readonly viewer = viewChild.required(BoardViewer);
  readonly events: [string, unknown][] = [];
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
  it('creates <board-viewer> in its element and gives access to it', () => {
    const { root, element } = render();
    expect(element).toBeInstanceOf(viewerClass());
    expect(root.querySelector('bui-board-viewer#viewer > board-viewer')).toBe(element);
    expect(element.isConnected).toBe(true);
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

  it('emits the typed details of the element’s events', () => {
    const { host, element } = render();
    const info = { id: 'cmp/R1', kind: 'component' } as ElementInfo;
    const progress: LoadProgress = { stage: 'convert', step: 'parse', fraction: 0.5 };
    element.dispatchEvent(new CustomEvent('bui-hover', { detail: info }));
    element.dispatchEvent(new CustomEvent('bui-select', { detail: null }));
    element.dispatchEvent(new CustomEvent('bui-progress', { detail: progress }));
    expect(host.events).toEqual([
      ['hover', info],
      ['select', null],
      ['progress', progress],
    ]);
  });
});

describe('Widget', () => {
  /** Stubs `attachWidget` (which needs a loaded board) as the viewer does it: slot and append. */
  function stubAttach() {
    const detach = vi.fn();
    const attach = vi.spyOn(viewerClass().prototype, 'attachWidget').mockImplementation(function (
      this: BoardViewerElement,
      id,
      element,
    ) {
      if (id === 'cmp/missing') throw new RangeError(`Unknown element: ${id}`);
      element.slot = 'widget';
      this.append(element);
      return () => {
        detach(id);
        element.remove();
      };
    });
    return { attach, detach };
  }

  it('shows its content in a widget that follows the element', () => {
    const { attach, detach } = stubAttach();
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
    stubAttach();
    const { fixture, host, root } = render();
    host.widgets.set(['cmp/missing']);
    fixture.detectChanges();
    expect(root.querySelector('bui-widget')).toBeNull();
  });

  it('keeps the native select event of a field in a widget from the select output', () => {
    stubAttach();
    const { fixture, host, element } = render();
    host.widgets.set(['cmp/R1']);
    fixture.detectChanges();
    element.querySelector('input')?.dispatchEvent(new Event('select', { bubbles: true }));
    expect(host.events).toEqual([]);
  });
});
