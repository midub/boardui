// @vitest-environment jsdom
// `<board-viewer>` in jsdom with a stand-in renderer (no GPU): the load lifecycle (`bui-load`,
// `bui-unload`, `loaded`) and what the camera frames.
import type { Box3, Vector3 } from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BoardModel } from '../src/board-model.js';
import type { BoardViewerElement } from '../src/element.js';
import { loadGltf } from '../src/load.js';
import { denseBoardGlb, smallBoardGlb } from './fixture/boards.js';

/** What the stand-in renderer was asked to frame, in order. */
const frames = vi.hoisted(() => [] as { box: Box3; direction: Vector3 | undefined }[]);

vi.mock('../src/renderer.js', async () => {
  const { Matrix4 } = await import('three');
  return {
    BoardRenderer: {
      create: async () => ({
        camera: { matrixWorld: new Matrix4() },
        autoRotate: false,
        setContent() {},
        setBounds() {},
        resize() {},
        requestRender() {},
        compile: async () => {},
        dispose() {},
        frame(box: Box3, direction?: Vector3) {
          frames.push({ box: box.clone(), direction: direction?.clone() });
        },
      }),
    },
  };
});

vi.mock('@boardui/converter', () => ({
  convertIpc2581: async (_input: unknown, options: { onProgress?: (p: object) => void }) => {
    options.onProgress?.({ step: 'parse', fraction: 0.5 });
    return { glb: smallBoardGlb(), warnings: [] };
  },
}));

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
// jsdom lacks `Element.part`, which the shadow DOM uses.
if (!('part' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'part', { get: () => ({ add() {} }) });
}

await import('../src/index.js');

const small = smallBoardGlb();
const other = denseBoardGlb(2);
let model: BoardModel;
/** Components of the other board. */
let o: number;

beforeAll(async () => {
  model = await BoardModel.fromGltf(await loadGltf(small));
  o = (await BoardModel.fromGltf(await loadGltf(other))).ids('component').length;
});

afterEach(() => {
  document.body.replaceChildren();
  frames.length = 0;
  vi.unstubAllGlobals();
});

/** A connected `<board-viewer>` that logs its load events (and what it knew at the time). */
async function viewer() {
  const element = document.createElement('board-viewer') as BoardViewerElement;
  document.body.append(element);
  const log: string[] = [];
  for (const type of ['bui-load', 'bui-unload', 'bui-progress', 'error'] as const) {
    element.addEventListener(type, (event) => {
      const detail = (event as CustomEvent).detail;
      const step = type === 'bui-progress' ? ` ${detail.step}` : '';
      const components = element.ids('component').length;
      log.push(`${type}${step} (${element.loaded ? components : 'none'})`);
    });
  }
  await new Promise((resolve) => setTimeout(resolve)); // the renderer is created asynchronously
  return { element, log };
}

describe('load lifecycle', () => {
  it('dispatches bui-load once the board is ready, before load() resolves', async () => {
    const { element, log } = await viewer();
    const details: unknown[] = [];
    let highlighted = false;
    element.addEventListener('bui-load', (e) => {
      details.push(e.detail, element.info('cmp/R1')?.kind);
      highlighted = typeof element.highlight({ net: 'net/GND' }, { color: 'red' }) === 'function';
    });
    expect(element.loaded).toBe(false);
    const done = element.load(small).then(() => log.push('resolved'));
    await done;
    expect(log).toEqual(['bui-load (5)', 'resolved']);
    expect(element.loaded).toBe(true);
    expect(details).toEqual([element.info('board'), 'component']);
    expect(highlighted).toBe(true);
    expect(details[0]).toMatchObject({
      id: 'board',
      kind: 'board',
      properties: { thickness: 0.0016 },
    });
  });

  it('dispatches bui-unload for the current board just before the next one replaces it', async () => {
    const { element, log } = await viewer();
    await element.load(small);
    await element.load(other);
    expect(log).toEqual(['bui-load (5)', 'bui-unload (5)', `bui-load (${o})`]);
  });

  it('reports a src load like a load() call, and a failed one as error only', async () => {
    const { element, log } = await viewer();
    const responses = [new Response(small), new Response(null, { status: 404 })];
    vi.stubGlobal('fetch', async () => responses.shift());
    const loaded = new Promise((resolve) => element.addEventListener('bui-load', resolve));
    element.setAttribute('src', 'board.glb');
    await loaded;
    const failed = new Promise((resolve) => element.addEventListener('error', resolve));
    element.setAttribute('src', 'missing.glb');
    await failed;
    expect(log).toEqual(['bui-load (5)', 'error (5)']);
    expect(element.loaded).toBe(true);
  });

  it('keeps the board and dispatches nothing when load() fails', async () => {
    const { element, log } = await viewer();
    await element.load(small);
    await expect(element.load(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    expect(log).toEqual(['bui-load (5)']);
    expect(element.info('cmp/R1')).not.toBeNull();
  });

  it('dispatches nothing for a load that a later one overtook', async () => {
    const { element, log } = await viewer();
    await Promise.all([element.load(small), element.load(other)]);
    expect(log).toEqual([`bui-load (${o})`]);
  });

  it('orders loadIpc2581 progress around the load events', async () => {
    const { element, log } = await viewer();
    await element.load(other);
    await element.loadIpc2581(new Uint8Array(0));
    expect(log).toEqual([
      `bui-load (${o})`,
      `bui-progress start (${o})`,
      `bui-progress parse (${o})`,
      `bui-progress load (${o})`,
      `bui-unload (${o})`,
      'bui-load (5)',
      'bui-progress done (5)',
    ]);
  });
});

describe('framing', () => {
  const near = (actual: Box3, expected: Box3) => {
    expect(actual.min.distanceTo(expected.min)).toBeLessThan(1e-9);
    expect(actual.max.distanceTo(expected.max)).toBeLessThan(1e-9);
  };

  it('frames what is shown: the initial view, the presets and frame()', async () => {
    const { element } = await viewer();
    await element.load(small);
    // Initially obliquely, everything but the (hidden) inner copper, which lies inside the board.
    expect(frames).toHaveLength(1);
    near(frames[0]?.box as Box3, model.visibleBounds());
    expect(frames[0]?.direction?.y).toBeGreaterThan(0);

    for (const layer of element.layers)
      element.setLayerVisible(layer.id, layer.id === 'layer/B.Cu');
    element.hide({ ids: element.ids('component') });
    element.setView('top');
    const copper = model.resolve('layer/B.Cu')?.box as Box3;
    near(frames[1]?.box as Box3, copper);
    expect(frames[1]?.direction?.y).toBeCloseTo(1);

    element.setLayerVisible('layer/F.SilkS', true);
    expect(frames).toHaveLength(2); // showing a layer doesn't move the camera
    element.frame();
    near(frames[2]?.box as Box3, copper.clone().union(model.resolve('layer/F.SilkS')?.box as Box3));
    expect(frames[2]?.direction).toBeUndefined(); // keeps the view direction

    // Nothing shown: the whole board.
    for (const layer of element.layers) element.setLayerVisible(layer.id, false);
    element.setView('bottom');
    near(frames[3]?.box as Box3, model.bounds);
  });
});
