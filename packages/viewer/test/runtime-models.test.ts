import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BoxGeometry,
  type BufferGeometry,
  type Material,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardModel } from '../src/board-model.js';
import { loadGltf } from '../src/load.js';
import { decodeParts, encodeParts, ModelCache } from '../src/model-cache.js';
import {
  type ModelBoard,
  type ModelComponent,
  type ModelLoader,
  type ModelRef,
  type ModelSource,
  registerModelLoader,
  transformMatrix,
} from '../src/model-sources.js';
import { type ModelStatus, RuntimeModels } from '../src/runtime-models.js';
import { smallBoardGlb } from './fixture/boards.js';

/** The small fixture board; C1's body is made a user model. */
async function board(): Promise<BoardModel> {
  const gltf = await loadGltf(smallBoardGlb());
  gltf.scene.traverse((object: Object3D) => {
    if (object.name === 'C1') {
      object.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.material = (mesh.material as Material).clone();
        (mesh.material as Material).name = 'user/model';
      });
    }
  });
  return BoardModel.fromGltf(gltf);
}

/** A loader of `test` models: the file's text is the box size in millimetres. */
const parsed: string[] = [];
const testLoader: ModelLoader = {
  cacheVersion: 7,
  async load(data) {
    const size = Number(new TextDecoder().decode(data)) / 1000;
    parsed.push(String(size));
    return {
      parts: [
        {
          geometry: new BoxGeometry(size, size, size),
          material: new MeshStandardMaterial({ name: 'a' }),
        },
        {
          geometry: new BoxGeometry(size, size, size),
          material: new MeshStandardMaterial({ name: 'b' }),
        },
      ],
    };
  },
};
registerModelLoader('test', testLoader);

/** A source that serves `test` models through `load`, recording what it is asked. */
function source(
  name: string,
  pick: (c: ModelComponent) => string | null | Error,
  files: Record<string, string | null> = {},
): ModelSource & { asked: string[]; loads: string[] } {
  const asked: string[] = [];
  const loads: string[] = [];
  return {
    name,
    asked,
    loads,
    async resolve(component) {
      asked.push(component.refDes);
      const key = pick(component);
      if (key instanceof Error) throw key;
      if (key === null) return null;
      const ref: ModelRef = {
        key,
        format: 'test',
        immutable: true,
        load: async () => {
          loads.push(key);
          const file = key in files ? files[key] : '1';
          return file === null ? null : new TextEncoder().encode(file).buffer;
        },
      };
      return ref;
    },
  };
}

interface Run {
  status: ModelStatus;
  applied: { key: string; rows: number[] }[];
  reports: ModelStatus[];
}

async function run(
  model: BoardModel,
  sources: ModelSource[],
  cache = new ModelCache(null),
  memory = new Map(),
): Promise<Run> {
  const applied: Run['applied'] = [];
  const reports: ModelStatus[] = [];
  const runner = new RuntimeModels({
    model,
    sources,
    cache,
    memory,
    apply: (key, geometry, rows, matrices) => {
      applied.push({ key, rows: [...rows] });
      model.bodies.setModel(key, geometry.parts, rows, matrices);
    },
    report: (status) => reports.push(structuredClone(status)),
  });
  await runner.run();
  return { status: runner.status, applied, reports };
}

const refDes = (model: BoardModel, rows: Iterable<number>) =>
  [...rows].map((r) => model.components.get('refDes', r)).join(' ');

afterEach(() => {
  parsed.length = 0;
  vi.unstubAllGlobals();
});

describe('runtime models', () => {
  it('ask sources in order and fall through on null, errors and missing files', async () => {
    const model = await board();
    const first = source(
      'first',
      (c) => (c.refDes === 'R1' ? new Error('offline') : c.refDes === 'J1' ? 'missing' : null),
      { missing: null },
    );
    const second = source('second', (c) => `box-${c.package}`);
    const { status, applied, reports } = await run(model, [first, second]);
    // C1 has a user model: never replaced, never asked for.
    expect(first.asked.sort()).toEqual(['J1', 'R1', 'R2', 'U1']);
    expect(second.asked.sort()).toEqual(['J1', 'R1', 'R2', 'U1']);
    expect(status).toMatchObject({ total: 4, done: 4, loaded: 4, complete: true, failureCount: 1 });
    expect(status.sources).toEqual([
      { name: 'first', loaded: 0, missing: 1, failed: 1 },
      { name: 'second', loaded: 4, missing: 0, failed: 0 },
    ]);
    expect(status.failures).toEqual([{ source: 'first', component: 'cmp/R1', message: 'offline' }]);
    // Components sharing a key share one load and one batch per part.
    const groups = applied.map((a) => refDes(model, a.rows).split(' ').sort().join(' '));
    expect(groups.sort()).toEqual(['J1', 'R1 R2', 'U1']);
    expect(status.models).toBe(3);
    expect(second.loads.sort()).toEqual(applied.map((a) => a.key).sort());
    expect(status.triangles).toBe(4 * 2 * 12);
    expect(reports.at(-1)?.complete).toBe(true);
  });

  it('pass component metadata and BOM attributes to sources', async () => {
    const seen: ModelComponent[] = [];
    const boards: ModelBoard[] = [];
    const record: ModelSource = {
      name: 's',
      resolve: async (c, b) => {
        seen.push(c);
        boards.push(b);
        return null;
      },
    };
    await run(await board(), [record]);
    expect(seen.find((c) => c.refDes === 'R1')).toMatchObject({
      id: 'cmp/R1',
      side: 'TOP',
      mount: 'SMT',
      attributes: {},
    });
    // The bom-attributes sample (profile 0.8) has an attributes table.
    seen.length = 0;
    const bytes = readFileSync(
      fileURLToPath(
        new URL(
          '../../../spec/samples/hand-written/bom-attributes/bom-attributes.glb',
          import.meta.url,
        ),
      ),
    );
    const glb = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await run(await BoardModel.fromGltf(await loadGltf(glb)), [record]);
    expect(seen.find((c) => c.refDes === 'R1')?.attributes).toMatchObject({
      MPN: 'RC0603FR-0710KL',
      LCSC: 'C25744',
    });
    expect(boards.at(-1)?.profileVersion).toBe('0.8');
  });

  it('replace placeholder bodies and pin-1 markers on the same state texels, and revert', async () => {
    const model = await board();
    const before = model.resolve('cmp/U1')?.box?.clone();
    const placeholders = model.bodies.placeholders.map((b) => b.mesh.count);
    await run(model, [source('s', (c) => (c.refDes === 'U1' ? 'big' : null), { big: '20' })]);
    const drawn = model.componentBatches.map((b): [string, string] => [
      (b.mesh.material as Material).name,
      refDes(model, b.rows),
    ]);
    // U1's body and pin-1 marker are gone; its model has a batch per material.
    expect(drawn.filter(([, r]) => r === 'U1')).toEqual([
      ['a', 'U1'],
      ['b', 'U1'],
    ]);
    expect(drawn.filter(([n]) => n.startsWith('boardui/')).map(([, r]) => r)).not.toContain('U1');
    const box = model.resolve('cmp/U1')?.box;
    const node = model.bodies.nodeMatrix(model.ids('component').indexOf('cmp/U1'));
    expect(box?.max.y).toBeCloseTo((node?.elements[13] ?? 0) + 0.01, 6);
    expect(model.resolve('cmp/U1')?.texels).toEqual(Uint32Array.of(model.componentOffset + 2));
    model.updateBounds();
    expect(model.bounds.max.y).toBeGreaterThan(0.009);

    model.bodies.showModels(false);
    expect(model.bodies.placeholders.map((b) => b.mesh.count)).toEqual(placeholders);
    expect(model.componentBatches.some((b) => (b.mesh.material as Material).name === 'a')).toBe(
      false,
    );
    expect(model.resolve('cmp/U1')?.box?.equals(before as NonNullable<typeof before>)).toBe(true);
    model.bodies.showModels(true);
    expect(model.bodies.modelCount).toBe(1);
    model.bodies.clearModels();
    expect(model.bodies.placeholders.map((b) => b.mesh.count)).toEqual(placeholders);
  });

  it('place a model with the reference’s transform on the component’s node', async () => {
    const model = await board();
    const ref = { offsetMm: [1, 2, 3] as const, rotationDeg: [0, 90, 0] as const, scale: 2 };
    const s: ModelSource = {
      name: 's',
      resolve: async (c) =>
        c.refDes === 'U1'
          ? {
              key: 'u1',
              format: 'test',
              transform: ref,
              load: async () => new TextEncoder().encode('1').buffer,
            }
          : null,
    };
    await run(model, [s]);
    const batch = model.componentBatches.find((b) => (b.mesh.material as Material).name === 'a');
    const matrix = new Matrix4();
    batch?.mesh.getMatrixAt(0, matrix);
    const row = model.ids('component').indexOf('cmp/U1');
    const expected = model.bodies.nodeMatrix(row)?.clone().multiply(transformMatrix(ref));
    expect(matrix.toArray().map((v) => +v.toFixed(9))).toEqual(
      expected?.toArray().map((v) => +v.toFixed(9)),
    );
  });

  it('stop when aborted', async () => {
    const model = await board();
    let runner: RuntimeModels | null = null;
    const signals: AbortSignal[] = [];
    const applied: string[] = [];
    const s: ModelSource = {
      name: 's',
      async resolve(_c, _b, signal) {
        signals.push(signal);
        runner?.abort();
        return { key: 'k', format: 'test', load: async () => new TextEncoder().encode('1').buffer };
      },
    };
    const reports: ModelStatus[] = [];
    runner = new RuntimeModels({
      model,
      sources: [s],
      cache: new ModelCache(null),
      memory: new Map(),
      apply: (key) => applied.push(key),
      report: (status) => reports.push(status),
    });
    await runner.run();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(applied).toEqual([]);
    expect(reports).toEqual([]);
    expect(runner.status.complete).toBe(false);
  });

  it('take models from the persistent cache on the next load: no requests, no parsing', async () => {
    const caches = memoryCaches();
    const cache = new ModelCache(caches);
    const pick = (c: ModelComponent) => (c.refDes === 'J1' ? 'gone' : `box-${c.package}`);
    const first = source('s', pick, { gone: null });
    const a = await run(await board(), [first], cache);
    expect(first.loads.length).toBe(3);
    expect(a.status.cached).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    parsed.length = 0;
    // A new element (no memory), same cache.
    const second = source('s', pick, { gone: null });
    const b = await run(await board(), [second], new ModelCache(caches));
    expect(second.loads).toEqual([]);
    expect(parsed).toEqual([]);
    expect(b.status).toMatchObject({ loaded: 3, cached: 2, bytes: 0 });
    expect(b.status.sources[0]).toMatchObject({ missing: 1 });
  });

  it('fetch URLs, a missing file falling through', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/404') ? new Response('', { status: 404 }) : new Response('2'),
    );
    vi.stubGlobal('fetch', fetch);
    const model = await board();
    const s: ModelSource = {
      name: 'web',
      resolve: async (c) => ({
        key: c.refDes === 'U1' ? 'https://m.example/404' : 'https://m.example/ok',
        url: c.refDes === 'U1' ? 'https://m.example/404' : 'https://m.example/ok',
        format: 'test',
      }),
    };
    const { status } = await run(model, [s]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(status).toMatchObject({ loaded: 3, requests: 2, bytes: 1 });
    expect(status.sources[0]).toMatchObject({ loaded: 3, missing: 1 });
  });

  it('fail without a loader for the format', async () => {
    const model = await board();
    const s: ModelSource = {
      name: 's',
      resolve: async () => ({ key: 'x', format: 'nope', url: 'x' }),
    };
    const { status } = await run(model, [s]);
    expect(status.failures[0]?.message).toMatch(/No loader for nope/);
  });

  it('take a model without triangles for a failure and ask the next source', async () => {
    registerModelLoader('empty', { load: async () => ({ parts: [] }) });
    const empty: ModelSource = {
      name: 'empty',
      resolve: async (c) =>
        c.refDes === 'U1'
          ? {
              key: 'nothing',
              format: 'empty',
              immutable: true,
              load: async () => new ArrayBuffer(1),
            }
          : null,
    };
    const caches = memoryCaches();
    const { status } = await run(
      await board(),
      [empty, source('s', (c) => (c.refDes === 'U1' ? 'u1' : null))],
      new ModelCache(caches),
    );
    expect(status.sources).toEqual([
      { name: 'empty', loaded: 0, missing: 0, failed: 1 },
      { name: 's', loaded: 1, missing: 0, failed: 0 },
    ]);
    expect(status.failures[0]?.message).toMatch(/no triangles/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await new ModelCache(caches).get('nothing', undefined)).toBeNull();
  });

  it('keep models that may change out of the persistent cache', async () => {
    const caches = memoryCaches();
    const loads: string[] = [];
    const s: ModelSource = {
      name: 's',
      resolve: async (c) => ({
        key: `box-${c.package}`,
        format: 'test',
        load: async () => {
          loads.push(c.refDes);
          return new TextEncoder().encode('1').buffer;
        },
      }),
    };
    await run(await board(), [s], new ModelCache(caches));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loads).toHaveLength(3);
    const b = await run(await board(), [s], new ModelCache(caches));
    expect(loads).toHaveLength(6);
    expect(b.status).toMatchObject({ loaded: 4, cached: 0 });
  });
});

describe('the model cache', () => {
  it('round-trips parsed geometry', () => {
    const geometry = new BoxGeometry(1, 2, 3);
    const material = new MeshStandardMaterial({
      name: 'pins',
      color: 0x336699,
      metalness: 0.5,
      roughness: 0.25,
    });
    const [part] = decodeParts(encodeParts([{ geometry, material }]));
    const g = part?.geometry as BufferGeometry;
    expect([...(g.getAttribute('position').array as Float32Array)]).toEqual([
      ...(geometry.getAttribute('position').array as Float32Array),
    ]);
    expect([...(g.index?.array ?? [])]).toEqual([...(geometry.index?.array ?? [])]);
    expect(g.getAttribute('uv').itemSize).toBe(2);
    const m = part?.material as MeshStandardMaterial;
    expect([m.name, m.color.getHexString(), m.metalness, m.roughness]).toEqual([
      'pins',
      '336699',
      0.5,
      0.25,
    ]);
  });
});

/** An in-memory stand-in for `CacheStorage`. */
function memoryCaches(): Pick<CacheStorage, 'open'> {
  const caches = new Map<string, Map<string, Response>>();
  return {
    async open(name: string) {
      const store = caches.get(name) ?? new Map<string, Response>();
      caches.set(name, store);
      return {
        match: async (request: RequestInfo | URL) => store.get(String(request))?.clone(),
        put: async (request: RequestInfo | URL, response: Response) => {
          store.set(String(request), response.clone());
        },
      } as unknown as Cache;
    },
  };
}
