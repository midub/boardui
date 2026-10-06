import { describe, expect, it } from 'vitest';
import { formatValue, isElementId, label, summary } from '../src/names.js';

describe('names', () => {
  it('labels element IDs', () => {
    expect(label('cmp/U3')).toBe('U3');
    expect(label('pin/U3/5')).toBe('U3.5');
    expect(label('net/%2FSDA')).toBe('/SDA');
    expect(label('feat/F.Cu/12')).toBe('F.Cu #12');
    expect(label('layer/%40x')).toBe('@x');
    expect(isElementId('net/GND')).toBe(true);
    expect(isElementId('GND')).toBe(false);
  });

  it('summarizes elements', () => {
    expect(
      summary({
        id: 'cmp/R1',
        kind: 'component',
        properties: { part: 'RES-10K', package: 'R0603', side: 'TOP' },
      }),
    ).toEqual({ title: 'R1', detail: 'RES-10K · R0603 · top' });
    expect(
      summary({
        id: 'feat/TOP/0',
        kind: 'feature',
        properties: { kind: 'PAD', net: 'net/N1', pin: 'pin/R1/1', layer: 'layer/TOP' },
      }),
    ).toEqual({ title: 'N1', detail: 'pad · R1.1 · TOP' });
  });

  it('formats lengths in millimetres', () => {
    expect(formatValue('thickness', 0.0016)).toBe('1.600 mm');
    expect(formatValue('zMin', 0.000765)).toBe('0.765 mm');
    expect(formatValue('count', 3)).toBe('3');
  });
});
