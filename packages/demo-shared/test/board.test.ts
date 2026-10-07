import type { LayerState } from '@boardui/viewer';
import { describe, expect, it } from 'vitest';
import { layerRows, nextHighlightColor, searchNets, shortcut } from '../src/board.js';
import { DEMOS, demoHref } from '../src/frameworks.js';
import { SAMPLES, sampleLabel } from '../src/samples.js';
import { StatsMeter } from '../src/stats.js';

describe('panels', () => {
  it('lists paste and drawings after the board layers', () => {
    const layers: LayerState[] = [
      { id: 'layer/TOP', name: 'TOP', kind: 'layer', role: 'COPPER', side: 'TOP', visible: true },
      { id: 'layer/PASTE', name: 'PASTE', kind: 'layer', role: 'PASTE', visible: false },
      { id: 'drill/D1', name: 'D1', kind: 'drill', color: '#123456', visible: true },
    ];
    const { board, extra } = layerRows(layers);
    expect(board.map((r) => [r.layer.id, r.color, r.role])).toEqual([
      ['layer/TOP', '#c9a15a', 'copper'],
      ['drill/D1', '#123456', 'drill'],
    ]);
    expect(extra.map((r) => r.role)).toEqual(['paste']);
  });

  it('searches nets', () => {
    const nets = Array.from({ length: 45 }, (_, i) => ({ id: `net/N${i}`, name: `N${i}` }));
    expect(searchNets(nets, '').matches).toEqual([]);
    expect(searchNets(nets, ' n1 ').matches.map((n) => n.name)).toEqual([
      'N1',
      ...Array.from({ length: 10 }, (_, i) => `N1${i}`),
    ]);
    const all = searchNets(nets, 'n');
    expect([all.matches.length, all.more]).toEqual([40, 5]);
  });

  it('picks the first free highlight colour', () => {
    expect(nextHighlightColor([])).toBe('#ffd400');
    expect(nextHighlightColor(['#ffd400'])).toBe('#00e5ff');
  });

  it('maps keys to shortcuts', () => {
    const key = (key: string, init: Partial<KeyboardEvent> = {}) =>
      ({
        key,
        target: null,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        ...init,
      }) as KeyboardEvent;
    expect(shortcut(key('t'))).toBe('top');
    expect(shortcut(key('Escape'))).toBe('clear');
    expect(shortcut(key('t', { ctrlKey: true }))).toBeNull();
    expect(shortcut(key('q'))).toBeNull();
    const input = { closest: (s: string) => (s.includes('input') ? {} : null) };
    expect(shortcut(key('x', { target: input as unknown as EventTarget }))).toBeNull();
  });

  it('labels samples and links the other demos', () => {
    const sample = SAMPLES.find((s) => s.id === 'minimal-2layer');
    expect(sample && sampleLabel(sample, { [sample.xml]: 2500 })).toBe('minimal-2layer (3 kB)');
    expect(DEMOS[0]?.id).toBe('react');
    expect(demoHref('angular', { search: '?sample=slots&stats', hash: '#x' })).toBe(
      '../angular/?sample=slots&stats#x',
    );
  });

  it('measures the frame rate', () => {
    const meter = new StatsMeter();
    const stats = { backend: 'WebGL2' as const, drawCalls: 3, triangles: 1200, frames: 0 };
    expect(meter.update(0, null)).toBe('no frame yet');
    for (let t = 16; t <= 1200; t += 16) meter.update(t, { ...stats, frames: t / 16 });
    expect(meter.fps).toBeCloseTo(62.5, 0);
    expect(meter.update(1500, { ...stats, frames: 94 })).toContain('fps\n3 draw calls');
  });
});
