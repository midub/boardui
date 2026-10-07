import type { ModelStatus } from '@boardui/viewer';
import { describe, expect, it } from 'vitest';
import { DemoModels, modelAttributions, modelProblems, modelSummary } from '../src/models.js';

const status = (patch: Partial<ModelStatus> = {}): ModelStatus => ({
  total: 56,
  done: 56,
  loaded: 41,
  sources: [
    { name: 'models.json', loaded: 0, missing: 0, failed: 0 },
    { name: 'KiCad', loaded: 41, missing: 6, failed: 1 },
  ],
  failures: [{ source: 'KiCad', component: 'cmp/U1', message: 'offline' }],
  failureCount: 1,
  models: 11,
  cached: 0,
  requests: 0,
  bytes: 0,
  triangles: 25930,
  ms: 4000,
  complete: true,
  ...patch,
});

describe('the 3D models panel', () => {
  it('sums up how loading went', () => {
    expect(modelSummary(null)).toBe('looking for models…');
    expect(modelSummary(status())).toBe('41 of 56 components (41 from KiCad)');
    expect(modelSummary(status({ complete: false, done: 20, loaded: 12 }))).toBe(
      'loading… 20 of 56 tried, 12 of 56 components (41 from KiCad)',
    );
    expect(modelSummary(status({ loaded: 0, sources: [] }))).toBe('none of 56 components');
    expect(modelSummary(status({ total: 0 }))).toBe('no components with a placeholder body');
    expect(modelProblems(status())).toBe('6 named models missing, 1 failed (cmp/U1: offline)');
    expect(modelProblems(status({ failureCount: 0, failures: [], sources: [] }))).toBe('');
  });

  it('credits the sources that supplied models, or all before any did', () => {
    const models = new DemoModels('?models=https%3A%2F%2Fmodels.example%2Fmodels.json');
    expect(models.sources.map((s) => s.name)).toEqual(['models.json', 'KiCad']);
    expect(modelAttributions(models.sources, null).map((a) => a.text)).toEqual(['KiCad libraries']);
    expect(modelAttributions(models.sources, status()).map((a) => a.text)).toEqual([
      'KiCad libraries',
    ]);
    expect(new DemoModels('').sources.map((s) => s.name)).toEqual(['KiCad']);
  });

  it('keeps the toggle and resets the status for a new board', () => {
    const models = new DemoModels('');
    const seen: unknown[] = [];
    models.subscribe(() => seen.push(models.getState()));
    models.update(status());
    models.setShown(false);
    models.reset();
    expect(models.getState()).toEqual({ status: null, shown: false });
    expect(seen).toHaveLength(3);
  });
});
