import { describe, expect, it } from 'vitest';
import { FeatureRanges } from '../src/feature-ranges.js';

/** Two features as quads (two triangles each), feature 1 empty, then feature 2. */
const featureIds = [0, 0, 0, 0, 2, 2, 2, 2];
const positions = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [5, 0, -1],
  [6, 0, -1],
  [6, 2, -1],
  [5, 2, -1],
].flat();
const index = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
const whole = { vertexStart: 0, vertexEnd: 8, indexStart: 0, indexEnd: 12 };

describe('FeatureRanges', () => {
  it('finds each feature’s vertex and index range in one pass', () => {
    const ranges = new FeatureRanges(3);
    ranges.scan(featureIds, positions, index, whole);
    expect([...ranges.vertexStart]).toEqual([0, 0, 4]);
    expect([...ranges.vertexCount]).toEqual([4, 0, 4]);
    expect([...ranges.indexStart]).toEqual([0, 0, 6]);
    expect([...ranges.indexCount]).toEqual([6, 0, 6]);
  });

  it('computes bounding boxes and leaves empty features without one', () => {
    const ranges = new FeatureRanges(3);
    ranges.scan(featureIds, positions, index, whole);
    expect(ranges.box(0)?.min.toArray()).toEqual([0, 0, 0]);
    expect(ranges.box(0)?.max.toArray()).toEqual([1, 1, 0]);
    expect(ranges.box(2)?.min.toArray()).toEqual([5, 0, -1]);
    expect(ranges.box(2)?.max.toArray()).toEqual([6, 2, -1]);
    expect(ranges.box(1)).toBeNull();
  });

  it('accepts features spread over several primitives, each in one', () => {
    const ranges = new FeatureRanges(3);
    ranges.scan(featureIds, positions, index, {
      vertexStart: 4,
      vertexEnd: 8,
      indexStart: 6,
      indexEnd: 12,
    });
    ranges.scan(featureIds, positions, index, {
      vertexStart: 0,
      vertexEnd: 4,
      indexStart: 0,
      indexEnd: 6,
    });
    expect([...ranges.vertexStart]).toEqual([0, 0, 4]);
  });

  it('rejects features that are not contiguous and ascending (§8.1)', () => {
    const descending = [2, 2, 2, 2, 0, 0, 0, 0];
    expect(() => new FeatureRanges(3).scan(descending, positions, index, whole)).toThrow(
      /ascending/,
    );
    const split = [0, 0, 2, 2, 0, 0, 2, 2];
    expect(() => new FeatureRanges(3).scan(split, positions, [], whole)).toThrow(/contiguous/);
  });

  it('rejects a feature in two primitives', () => {
    const ranges = new FeatureRanges(3);
    const first = { vertexStart: 0, vertexEnd: 4, indexStart: 0, indexEnd: 6 };
    ranges.scan(featureIds, positions, index, first);
    expect(() => ranges.scan(featureIds, positions, index, first)).toThrow(/contiguous/);
  });

  it('rejects triangles that mix features and IDs outside the table', () => {
    expect(() =>
      new FeatureRanges(3).scan(featureIds, positions, [0, 1, 4, 4, 5, 6], whole),
    ).toThrow(/mixes features/);
    expect(() => new FeatureRanges(2).scan(featureIds, positions, index, whole)).toThrow(
      /not a row/,
    );
  });
});
