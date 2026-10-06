import { describe, expect, it } from 'vitest';
import { encodeIdSegment, featureId, idKind, parseFeatureId } from '../src/ids.js';

describe('encodeIdSegment', () => {
  it('encodes %, /, #, @, whitespace and control characters (§5)', () => {
    expect(encodeIdSegment('/SDA')).toBe('%2FSDA');
    expect(encodeIdSegment('In2 Power')).toBe('In2%20Power');
    expect(encodeIdSegment('A#1@2%3')).toBe('A%231%402%253');
    expect(encodeIdSegment('tab\there\nnew')).toBe('tab%09here%0Anew');
    expect(encodeIdSegment(' nbsp')).toBe('%C2%A0nbsp');
  });

  it('keeps every other character', () => {
    expect(encodeIdSegment('Net-(R1-Pad2)')).toBe('Net-(R1-Pad2)');
    expect(encodeIdSegment('F.Cu')).toBe('F.Cu');
    expect(encodeIdSegment('N$1+~')).toBe('N$1+~');
    expect(encodeIdSegment('Ω-Ü')).toBe('Ω-Ü');
  });
});

describe('idKind', () => {
  it('derives the kind from the prefix', () => {
    expect(idKind('board')).toBe('board');
    expect(idKind('layer/@core')).toBe('layer');
    expect(idKind('cmp/C12')).toBe('component');
    expect(idKind('pin/C12/1')).toBe('pin');
    expect(idKind('net/GND')).toBe('net');
    expect(idKind('feat/TOP/3')).toBe('feature');
  });

  it('rejects malformed IDs', () => {
    for (const id of ['', 'boards', 'cmp/', 'CMP/C1', 'part/X']) {
      expect(idKind(id), id).toBeNull();
    }
  });
});

describe('feature IDs', () => {
  it('derive from the layer ID and the source index', () => {
    expect(featureId('layer/TOP', 12)).toBe('feat/TOP/12');
    expect(featureId('layer/@soldermask-top', 0)).toBe('feat/@soldermask-top/0');
    expect(featureId('layer/In2%20Power', 3)).toBe('feat/In2%20Power/3');
  });

  it('parse back into layer ID and source index', () => {
    expect(parseFeatureId('feat/In2%20Power/3')).toEqual({
      layerId: 'layer/In2%20Power',
      source: 3,
    });
    expect(parseFeatureId('feat/@core/0')).toEqual({ layerId: 'layer/@core', source: 0 });
  });

  it('reject malformed feature IDs', () => {
    for (const id of [
      'feat/TOP',
      'feat/TOP/',
      'feat/TOP/01',
      'feat/TOP/-1',
      'feat/A/B/1',
      'net/X/1',
    ]) {
      expect(parseFeatureId(id), id).toBeNull();
    }
  });
});
