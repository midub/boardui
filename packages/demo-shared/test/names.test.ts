import { describe, expect, it } from 'vitest';
import { formatValue, isElementId, label, summary } from '../src/names.js';

describe('names', () => {
  it('labels element IDs', () => {
    expect(label('cmp/U3')).toBe('U3');
    expect(label('pin/U3/5')).toBe('U3.5');
    expect(label('net/%2FSDA')).toBe('/SDA');
    expect(label('feat/F.Cu/12')).toBe('F.Cu #12');
    expect(label('layer/%40x')).toBe('@x');
    expect(label('cmp/board-2/U3')).toBe('U3 (board-2)');
    expect(label('pin/board-2/U3/5')).toBe('U3.5 (board-2)');
    expect(label('net/board%201-2/%2FSDA')).toBe('/SDA (board 1-2)');
    expect(label('feat/board-2/F.Cu/12')).toBe('F.Cu #12 (board-2)');
    expect(label('inst/board-2')).toBe('board-2');
    expect(isElementId('inst/board-2')).toBe(true);
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
    expect(
      summary({
        id: 'inst/board-6',
        kind: 'instance',
        properties: { step: 'board', side: 'BOTTOM', angle: 90 },
      }),
    ).toEqual({ title: 'board-6', detail: 'step board · flipped' });
  });

  it('formats lengths in millimetres', () => {
    expect(formatValue('thickness', 0.0016)).toBe('1.600 mm');
    expect(formatValue('zMin', 0.000765)).toBe('0.765 mm');
    expect(formatValue('count', 3)).toBe('3');
    expect(formatValue('x', 0.0935)).toBe('93.500 mm');
    expect(formatValue('angle', 90.00000000001)).toBe('90°');
  });
});
