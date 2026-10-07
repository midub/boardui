import type { ModelBoard, ModelComponent } from '@boardui/viewer';
import { describe, expect, it } from 'vitest';
import { RateLimitError } from '../src/http.js';
import { KICAD_CACHE_NAME, kicadSource, kicadTag } from '../src/kicad.js';
import { memoryCaches } from './fixture/cache.js';

const component = (part: string, pkg: string): ModelComponent => ({
  id: 'cmp/X',
  refDes: 'X',
  part,
  package: pkg,
  side: 'TOP',
  mount: 'SMT',
  attributes: {},
});
const C25 = component('Capacitor_SMD_C_0402_1005Metric_100nF', 'C_0402_1005Metric_2');
const kicad9: ModelBoard = {
  profileVersion: '0.8',
  source: {
    format: 'IPC-2581',
    sha256: '',
    software: { name: 'KiCad', revision: '9.0.9', vendor: 'KiCad EDA' },
  },
};
const unknown: ModelBoard = { profileVersion: '0.7', source: { format: 'IPC-2581', sha256: '' } };

const FOOTPRINT = `(footprint "C_0402_1005Metric" (layer "F.Cu")
  (model "\${KICAD9_3DMODEL_DIR}/Capacitor_SMD.3dshapes/C_0402_1005Metric.wrl"
    (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0))))`;

/** A fake GitLab: footprints by file name, 404 otherwise; records requests and concurrency. */
function gitlab(files: Record<string, string | number> = {}, delay = 0) {
  const requests: string[] = [];
  let active = 0;
  let maxActive = 0;
  const fetch = (async (input: string) => {
    const url = String(input);
    requests.push(url);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active--;
    const path = decodeURIComponent(/files\/([^/]+)\/raw/.exec(url)?.[1] ?? '');
    const file = files[path.split('/').pop() ?? ''];
    if (typeof file === 'number') return new Response('', { status: file });
    return file === undefined ? new Response('', { status: 404 }) : new Response(file);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests, maxActive: () => maxActive };
}

const signal = new AbortController().signal;

describe('kicadTag', () => {
  it('takes the newest tag of the KiCad major version', () => {
    expect(kicadTag({ name: 'KiCad', revision: '9.0.9' })).toBe('9.0.9.1');
    expect(kicadTag({ name: 'KiCad', revision: '10.0.1' })).toBe('10.0.7');
    expect(kicadTag({ name: 'KiCad', revision: '8.0.4' })).toBe('8.0.9');
    expect(kicadTag({ name: 'KiCad', revision: '9.99.0-123-g1' })).toBe('10.0.7');
    expect(kicadTag({ name: 'KiCad', revision: '7.0.11' })).toBe('10.0.7');
    expect(kicadTag({ name: 'Altium Designer', revision: '24.1' })).toBe('10.0.7');
    expect(kicadTag(undefined)).toBe('10.0.7');
  });
});

describe('kicadSource', () => {
  it('resolves a footprint’s model through the GitLab API at the board’s tag', async () => {
    const server = gitlab({
      'C_0402_1005Metric.kicad_mod': FOOTPRINT,
      'C_0402_1005Metric.step': 'STEP',
    });
    const source = kicadSource({ fetch: server.fetch, cache: null });
    const ref = await source.resolve(C25, kicad9, signal);
    expect(server.requests).toEqual([
      'https://gitlab.com/api/v4/projects/kicad%2Flibraries%2Fkicad-footprints/repository/files/Capacitor_SMD.pretty%2FC_0402_1005Metric.kicad_mod/raw?ref=9.0.9.1',
    ]);
    expect(ref).toMatchObject({
      key: 'kicad/9.0.9.1/Capacitor_SMD.3dshapes/C_0402_1005Metric.step',
      format: 'step',
      immutable: true,
      attribution: { text: 'KiCad libraries' },
    });
    expect(ref?.transform?.matrix).toHaveLength(16);
    const data = await ref?.load?.(signal);
    expect(new TextDecoder().decode(data ?? undefined)).toBe('STEP');
    expect(server.requests[1]).toBe(
      'https://gitlab.com/api/v4/projects/kicad%2Flibraries%2Fkicad-packages3D/repository/files/Capacitor_SMD.3dshapes%2FC_0402_1005Metric.step/raw?ref=9.0.9.1',
    );
    expect(source.stats).toMatchObject({ requests: 2, bytes: FOOTPRINT.length + 4 });
  });

  it('makes no request for components outside KiCad’s libraries', async () => {
    const server = gitlab();
    const source = kicadSource({ fetch: server.fetch, cache: null });
    expect(
      await source.resolve(component('GRM155R71C104KA88', 'C0402'), unknown, signal),
    ).toBeNull();
    expect(await source.resolve(component('mylib_Thing_1', 'Thing_3'), unknown, signal)).toBeNull();
    expect(server.requests).toEqual([]);
  });

  it('reads each footprint once, and at most four files at a time', async () => {
    const files: Record<string, string> = { 'C_0402_1005Metric.kicad_mod': FOOTPRINT };
    const parts = Array.from({ length: 10 }, (_, i) =>
      component(`Resistor_SMD_R_${i}_1k`, `R_${i}_${i + 1}`),
    );
    for (let i = 0; i < 10; i++) files[`R_${i}.kicad_mod`] = FOOTPRINT;
    const server = gitlab(files, 5);
    const source = kicadSource({ fetch: server.fetch, cache: null, ref: '10.0.7' });
    const refs = await Promise.all(
      [C25, C25, C25, ...parts].map((c) => source.resolve(c, unknown, signal)),
    );
    expect(
      refs.every((r) => r?.key === 'kicad/10.0.7/Capacitor_SMD.3dshapes/C_0402_1005Metric.step'),
    ).toBe(true);
    expect(server.requests).toHaveLength(11);
    expect(server.maxActive()).toBe(4);
  });

  it('remembers footprints, missing ones too, in Cache Storage', async () => {
    const caches = memoryCaches();
    const first = gitlab({ 'C_0402_1005Metric.kicad_mod': FOOTPRINT });
    const missing = component('Diode_SMD_D_0402_1005Metric_1N4148', 'D_0402_1005Metric_4');
    let source = kicadSource({ fetch: first.fetch, cache: caches });
    expect(await source.resolve(C25, kicad9, signal)).not.toBeNull();
    expect(await source.resolve(missing, kicad9, signal)).toBeNull();
    expect(first.requests).toHaveLength(2);
    // Writes to the cache are not awaited by resolve.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(caches.entries.get(KICAD_CACHE_NAME)?.size).toBe(2);
    const second = gitlab();
    source = kicadSource({ fetch: second.fetch, cache: caches });
    expect(await source.resolve(C25, kicad9, signal)).not.toBeNull();
    expect(await source.resolve(missing, kicad9, signal)).toBeNull();
    expect(second.requests).toEqual([]);
    expect(source.stats.cached).toBe(2);
  });

  it('stops asking after HTTP 429', async () => {
    const server = gitlab({ 'C_0402_1005Metric.kicad_mod': 429 });
    const source = kicadSource({ fetch: server.fetch, cache: null });
    await expect(source.resolve(C25, kicad9, signal)).rejects.toBeInstanceOf(RateLimitError);
    const other = component('Resistor_SMD_R_0402_1005Metric_1k', 'R_0402_1005Metric_3');
    await expect(source.resolve(other, kicad9, signal)).rejects.toThrow(/429/);
    expect(server.requests).toHaveLength(1);
  });

  it('uses another base URL', async () => {
    const server = gitlab({ 'C_0402_1005Metric.kicad_mod': FOOTPRINT });
    const source = kicadSource({
      fetch: server.fetch,
      cache: null,
      baseUrl: 'https://mirror.example/api/v4/',
    });
    await source.resolve(C25, unknown, signal);
    expect(server.requests[0]).toMatch(
      /^https:\/\/mirror\.example\/api\/v4\/projects\/.*ref=10\.0\.7$/,
    );
  });
});
