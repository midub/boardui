import { act, cleanup, render } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardViewer, type BoardViewerElement, type ElementInfo, Widget } from '../src/index.js';

const info: ElementInfo = { id: 'cmp/R1', kind: 'component', properties: { part: 'RES' } };
const board: ElementInfo = { id: 'board', kind: 'board', properties: { thickness: 0.0016 } };
const fire = (target: Element, type: string, detail: unknown) =>
  target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BoardViewer', () => {
  it('renders <board-viewer> and forwards the ref to it', () => {
    const ref = createRef<BoardViewerElement>();
    const { container } = render(
      <BoardViewer ref={ref} src="board.glb" backend="webgl" id="v" className="viewer" />,
    );
    const element = container.querySelector('board-viewer');
    expect(element).toBe(ref.current);
    expect(element?.constructor.name).toBe('BoardViewerElement');
    expect(element?.getAttribute('src')).toBe('board.glb');
    expect(element?.getAttribute('backend')).toBe('webgl');
    expect(element?.id).toBe('v');
    expect(element?.className).toBe('viewer');
    expect(typeof ref.current?.loadIpc2581).toBe('function');
  });

  it('sets autoRotate and x-ray', () => {
    const ref = createRef<BoardViewerElement>();
    const { rerender } = render(<BoardViewer ref={ref} autoRotate />);
    const element = ref.current as BoardViewerElement;
    const setXray = vi.spyOn(element, 'setXray');
    expect(element.autoRotate).toBe(true);
    expect(element.xray).toBe(false);
    rerender(<BoardViewer ref={ref} autoRotate={false} xray />);
    expect(element.autoRotate).toBe(false);
    expect(element.xray).toBe(true);
    rerender(<BoardViewer ref={ref} autoRotate={false} xray />);
    rerender(<BoardViewer ref={ref} />);
    expect(setXray).toHaveBeenCalledTimes(1);
    expect(element.xray).toBe(true);
  });

  it('calls the latest event handlers with the typed details', () => {
    const ref = createRef<BoardViewerElement>();
    const first = vi.fn();
    const onSelect = vi.fn();
    const onHover = vi.fn();
    const onProgress = vi.fn();
    const onLoad = vi.fn();
    const onUnload = vi.fn();
    const onError = vi.fn();
    const { rerender, unmount } = render(<BoardViewer ref={ref} onSelect={first} />);
    const element = ref.current as BoardViewerElement;
    rerender(
      <BoardViewer
        ref={ref}
        onSelect={onSelect}
        onHover={onHover}
        onProgress={onProgress}
        onLoad={onLoad}
        onUnload={onUnload}
        onError={onError}
      />,
    );
    fire(element, 'bui-select', info);
    fire(element, 'bui-hover', null);
    fire(element, 'bui-progress', { stage: 'convert', step: 'parse', fraction: 0.2 });
    fire(element, 'bui-unload', board);
    fire(element, 'bui-load', board);
    element.dispatchEvent(new ErrorEvent('error', { message: 'broken' }));
    expect(first).not.toHaveBeenCalled();
    expect(onSelect.mock.calls[0]?.[0].detail).toEqual(info);
    expect(onHover.mock.calls[0]?.[0].detail).toBeNull();
    expect(onProgress.mock.calls[0]?.[0].detail.step).toBe('parse');
    expect(onUnload.mock.calls[0]?.[0].detail).toEqual(board);
    expect(onLoad.mock.calls[0]?.[0].detail.properties.thickness).toBe(0.0016);
    expect(onError.mock.calls[0]?.[0].message).toBe('broken');
    unmount();
    fire(element, 'bui-select', null);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('can be used as <board-viewer> directly', () => {
    const ref = createRef<BoardViewerElement>();
    const onSelect = vi.fn();
    render(<board-viewer ref={ref} src="board.glb" autoRotate onbui-select={onSelect} />);
    expect(ref.current?.autoRotate).toBe(true);
    fire(ref.current as BoardViewerElement, 'bui-select', info);
    expect(onSelect.mock.calls[0]?.[0].detail).toEqual(info);
  });
});

describe('Widget', () => {
  /**
   * Stubs the viewer's board (`loaded`, `attachWidget`) as the element behaves: widgets attach to
   * elements of the loaded board, with slot and append; `load` replaces the board with events.
   */
  function stubBoard({ loaded = true } = {}) {
    const prototype = customElements.get('board-viewer')?.prototype as BoardViewerElement;
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
    const load = (viewer: Element, missing: string[] = []) =>
      act(() => {
        if (state.loaded) fire(viewer, 'bui-unload', board);
        state.loaded = true;
        state.missing = new Set(['cmp/missing', ...missing]);
        fire(viewer, 'bui-load', board);
      });
    return { attach, detach, load };
  }

  it('renders its children into a widget that follows the element', () => {
    const { attach, detach } = stubBoard();
    const { container, rerender, unmount } = render(
      <BoardViewer>
        <Widget target="cmp/R1" anchor="top" offset={[0, -6]} className="tag">
          <b>R1</b>
        </Widget>
      </BoardViewer>,
    );
    const host = container.querySelector('board-viewer > [slot="widget"]');
    expect(host?.className).toBe('tag');
    expect(host?.innerHTML).toBe('<b>R1</b>');
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0]?.[0]).toBe('cmp/R1');
    expect(attach.mock.calls[0]?.[2]).toEqual({ anchor: 'top', offset: [0, -6] });

    // Same options by value: no new widget. Another element: detached and attached again.
    rerender(
      <BoardViewer>
        <Widget target="cmp/R1" anchor="top" offset={[0, -6]} className="tag pinned">
          <b>R1</b>
        </Widget>
      </BoardViewer>,
    );
    expect(attach).toHaveBeenCalledTimes(1);
    expect(host?.className).toBe('tag pinned');
    rerender(
      <BoardViewer>
        <Widget target="cmp/R2">R2</Widget>
      </BoardViewer>,
    );
    expect(detach).toHaveBeenCalledWith('cmp/R1');
    expect(container.querySelector('[slot="widget"]')?.textContent).toBe('R2');
    unmount();
    expect(detach).toHaveBeenCalledWith('cmp/R2');
  });

  it('shows nothing for an unknown element', () => {
    stubBoard();
    const { container } = render(
      <BoardViewer>
        <Widget target="cmp/missing">?</Widget>
      </BoardViewer>,
    );
    expect(container.querySelector('[slot="widget"]')).toBeNull();
  });

  it('attaches once a board is loaded, and again to the next board', () => {
    const { attach, detach, load } = stubBoard({ loaded: false });
    let mounts = 0;
    function Tag() {
      const [id] = useState(() => ++mounts);
      return <b>tag {id}</b>;
    }
    const ref = createRef<BoardViewerElement>();
    const { container } = render(
      <BoardViewer ref={ref}>
        <Widget target="cmp/R1">
          <Tag />
        </Widget>
      </BoardViewer>,
    );
    const viewer = ref.current as BoardViewerElement;
    const widget = () => container.querySelector('[slot="widget"]');
    expect(attach).not.toHaveBeenCalled();
    expect(widget()).toBeNull();

    load(viewer);
    expect(attach).toHaveBeenCalledTimes(1);
    const host = widget();
    expect(host?.textContent).toBe('tag 1');

    // Detached while `bui-unload` runs, before the board is replaced; then attached again, with
    // the same element and children.
    let detached = 0;
    const onUnload = () => {
      detached = detach.mock.calls.length;
    };
    viewer.addEventListener('bui-unload', onUnload, { once: true });
    load(viewer);
    expect(detached).toBe(1);
    expect(attach).toHaveBeenCalledTimes(2);
    expect(widget()).toBe(host);
    expect(host?.textContent).toBe('tag 1');

    // A board without the element: nothing; the next one with it: a new tag.
    load(viewer, ['cmp/R1']);
    expect(detach).toHaveBeenCalledTimes(2);
    expect(widget()).toBeNull();
    load(viewer);
    expect(widget()?.textContent).toBe('tag 2');
  });
});
