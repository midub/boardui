import type { ModelBoard, ModelComponent } from '@boardui/viewer';
import { describe, expect, it } from 'vitest';
import { expand, glob, type MappingFile, mappingSource, matches } from '../src/mapping.js';

const component = (patch: Partial<ModelComponent> = {}): ModelComponent => ({
  id: 'cmp/C25',
  refDes: 'C25',
  part: 'GRM155R71C104KA88',
  package: 'C0402',
  side: 'TOP',
  mount: 'SMT',
  attributes: { MPN: 'GRM155R71C104KA88D', LCSC: 'C1525' },
  ...patch,
});
const board: ModelBoard = { profileVersion: '0.8', source: { format: 'IPC-2581', sha256: '' } };
const signal = new AbortController().signal;

describe('matching', () => {
  it('globs', () => {
    expect(glob('C0402', 'C0402')).toBe(true);
    expect(glob('C04*', 'C0402')).toBe(true);
    expect(glob('C0?02', 'C0402')).toBe(true);
    expect(glob('C0.02', 'C0402')).toBe(false);
    expect(glob('*', '')).toBe(true);
  });

  it('needs every field to match, attributes too', () => {
    expect(matches({ package: 'C04*', refDes: 'C2?' }, component())).toBe(true);
    expect(matches({ package: 'C04*', refDes: 'R*' }, component())).toBe(false);
    expect(matches({ attributes: { MPN: 'GRM155*' } }, component())).toBe(true);
    expect(matches({ attributes: { MPN: 'GRM155*', Value: '*' } }, component())).toBe(false);
    expect(matches({ attributes: { toString: '*' } }, component())).toBe(false);
  });

  it('fills templates, URL-encoded, and refuses missing values', () => {
    expect(expand('https://m.example/{package}/{MPN}.step', component())).toBe(
      'https://m.example/C0402/GRM155R71C104KA88D.step',
    );
    expect(expand('{part}.glb', component({ part: 'A/B #1' }))).toBe('A%2FB%20%231.glb');
    expect(expand('{Datasheet}.glb', component())).toBeNull();
  });
});

describe('mappingSource', () => {
  const mapping: MappingFile = {
    version: 1,
    models: [
      { match: { package: 'C*' }, file: 'packages/{package}.step', scale: 2 },
      { match: { attributes: { LCSC: 'C1525' } }, file: 'lcsc/{LCSC}.obj', offsetMm: [0, 1, 0] },
      { match: { part: 'LM358' }, file: 'https://other.example/lm358.glb' },
      { match: { package: 'R*' }, file: 'r.bin', format: 'glb' },
    ],
  };

  it('tries specific rules before package rules and resolves URLs against the mapping', async () => {
    const source = mappingSource(mapping, { baseUrl: 'https://models.example/lib/' });
    expect(await source.resolve(component(), board, signal)).toEqual({
      key: 'https://models.example/lib/lcsc/C1525.obj',
      url: 'https://models.example/lib/lcsc/C1525.obj',
      format: 'obj',
      transform: { offsetMm: [0, 1, 0], rotationDeg: [0, 0, 0], scale: 1 },
    });
    expect(await source.resolve(component({ attributes: {} }), board, signal)).toMatchObject({
      url: 'https://models.example/lib/packages/C0402.step',
      format: 'step',
      transform: { scale: 2 },
    });
    expect(
      await source.resolve(
        component({ part: 'LM358', package: 'SOIC-8', attributes: {} }),
        board,
        signal,
      ),
    ).toMatchObject({
      url: 'https://other.example/lm358.glb',
      format: 'glb',
    });
    expect(
      await source.resolve(component({ package: 'R0402', attributes: {} }), board, signal),
    ).toMatchObject({
      format: 'glb',
    });
    expect(
      await source.resolve(component({ package: 'SOT-23', attributes: {} }), board, signal),
    ).toBeNull();
  });

  it('loads the mapping from a URL once, relative paths against it', async () => {
    const requests: string[] = [];
    const fetch = (async (url: string) => {
      requests.push(String(url));
      return new Response(JSON.stringify(mapping));
    }) as unknown as typeof globalThis.fetch;
    const source = mappingSource('https://models.example/lib/models.json', { fetch });
    expect(source.name).toBe('models.json');
    const [a, b] = await Promise.all([
      source.resolve(component(), board, signal),
      source.resolve(component({ attributes: {} }), board, signal),
    ]);
    expect(a?.url).toBe('https://models.example/lib/lcsc/C1525.obj');
    expect(b?.url).toBe('https://models.example/lib/packages/C0402.step');
    expect(requests).toEqual(['https://models.example/lib/models.json']);
  });

  it('rejects a malformed mapping once per run, and tries again in the next run', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      return calls === 1 ? new Response('{"version":2}') : new Response(JSON.stringify(mapping));
    }) as unknown as typeof globalThis.fetch;
    const source = mappingSource('https://models.example/models.json', { fetch });
    await expect(source.resolve(component(), board, signal)).rejects.toThrow(/mapping/);
    await expect(source.resolve(component(), board, signal)).rejects.toThrow(/mapping/);
    expect(calls).toBe(1);
    const next = new AbortController().signal;
    expect(await source.resolve(component(), board, next)).not.toBeNull();
    expect(calls).toBe(2);
  });

  it('loads the mapping again when the run that started the load is cancelled', async () => {
    const fetch = (async (_url: string, init?: RequestInit) => {
      await Promise.resolve();
      init?.signal?.throwIfAborted();
      return new Response(JSON.stringify(mapping));
    }) as unknown as typeof globalThis.fetch;
    const source = mappingSource('https://models.example/models.json', { fetch });
    const old = new AbortController();
    const first = source.resolve(component(), board, old.signal);
    const second = source.resolve(component(), board, signal);
    old.abort();
    await expect(first).rejects.toThrow();
    expect(await second).not.toBeNull();
  });
});
