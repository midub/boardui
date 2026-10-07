import { readFileSync } from 'node:fs';
import type { BoardViewerElement } from '@boardui/viewer';
import { describe, expect, it, vi } from 'vitest';
import { DemoSession, type DemoState } from '../src/session.js';

const samples = new URL('../../../spec/samples/', import.meta.url);
const file = (path: string) =>
  new File([readFileSync(new URL(path, samples))], path.split('/').pop() as string);

function session(viewer: Partial<BoardViewerElement>) {
  const s = new DemoSession({ samplesBase: '/samples/', sizes: {} });
  s.viewer = viewer as BoardViewerElement;
  const states: DemoState[] = [];
  s.subscribe(() => states.push(s.state));
  return { s, states };
}

describe('DemoSession', () => {
  it('opens a boardui GLB without converting', async () => {
    const load = vi.fn(async () => {});
    const { s, states } = session({ load });
    await s.openFiles([{ path: 'slots.glb', file: file('hand-written/slots/slots.glb') }]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(states[0]).toMatchObject({ status: 'busy', generation: 1, progress: { step: '' } });
    expect(s.state).toMatchObject({ status: 'ready', generation: 1, progress: null, error: null });
    expect(s.state.board).toMatchObject({ id: 1, name: 'slots', conversion: null });
    expect(s.timings.total).toBeGreaterThan(0);
  });

  it('converts IPC-2581 and reports the steps', async () => {
    const glb = new ArrayBuffer(8);
    const loadIpc2581 = vi.fn(
      async (_xml: unknown, options: { onProgress?: (p: unknown) => void }) => {
        options.onProgress?.({ stage: 'convert', step: 'resolve', fraction: 0.5 });
        return { glb, warnings: [], timings: {}, stats: {}, seconds: 0.1 };
      },
    );
    const { s, states } = session({ loadIpc2581 } as unknown as BoardViewerElement);
    await s.openFiles([{ path: 'slots.xml', file: file('hand-written/slots/slots.xml') }]);
    expect(states.map((st) => st.progress?.title)).toContain('Converting slots');
    expect(states.map((st) => st.progress?.step)).toContain('resolving overlaps');
    expect(s.state.board?.glb).toBe(glb);
  });

  it('shows errors and returns to the previous state', async () => {
    const { s } = session({
      load: async () => {
        throw new Error('not a board');
      },
    });
    await s.openFiles([{ path: 'notes.txt', file: new File(['x'], 'notes.txt') }]);
    expect(s.state).toMatchObject({ status: 'error', generation: 0 });
    expect(s.state.error).toContain('IPC-2581');
    s.dismissError();
    expect(s.state).toMatchObject({ status: 'empty', error: null });
    await s.openFiles([{ path: 'slots.glb', file: file('hand-written/slots/slots.glb') }]);
    expect(s.state).toMatchObject({ status: 'error', error: 'not a board', progress: null });
  });

  it('cancels a load', async () => {
    const { s } = session({
      loadIpc2581: (_xml: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    } as unknown as BoardViewerElement);
    const done = s.openFiles([{ path: 'slots.xml', file: file('hand-written/slots/slots.xml') }]);
    await vi.waitFor(() => expect(s.state.status).toBe('busy'));
    s.cancel();
    await done;
    expect(s.state).toMatchObject({ status: 'empty', board: null, progress: null, error: null });
  });
});
