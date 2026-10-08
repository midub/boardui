import { Box3 } from 'three';

/** One primitive's span inside a layer's (merged) vertex and index buffers. */
export interface PrimitiveSpan {
  vertexStart: number;
  vertexEnd: number;
  indexStart: number;
  indexEnd: number;
}

/**
 * Vertex ranges, index ranges and bounding boxes of every feature of one layer.
 *
 * Spec §8.1 makes each feature's vertices and triangles contiguous and ascending within a
 * primitive, so one pass over a primitive finds them all. Features without geometry (spec §6.2)
 * have empty ranges and no box.
 */
export class FeatureRanges {
  /** First vertex of each feature. */
  readonly vertexStart: Uint32Array;
  /** Vertex count of each feature. */
  readonly vertexCount: Uint32Array;
  /** First index (not triangle) of each feature. */
  readonly indexStart: Uint32Array;
  /** Index count of each feature (three per triangle). */
  readonly indexCount: Uint32Array;
  /** Bounding boxes, six floats per feature: min x, y, z, max x, y, z. */
  readonly bounds: Float32Array;

  /** @param count Number of rows of the layer's feature table. */
  constructor(readonly count: number) {
    this.vertexStart = new Uint32Array(count);
    this.vertexCount = new Uint32Array(count);
    this.indexStart = new Uint32Array(count);
    this.indexCount = new Uint32Array(count);
    this.bounds = new Float32Array(count * 6);
  }

  /** Bounding box of a feature, or `null` if it has no geometry. */
  box(feature: number, target = new Box3()): Box3 | null {
    if (!(this.vertexCount[feature] ?? 0)) {
      return null;
    }
    const b = this.bounds;
    const o = feature * 6;
    target.min.set(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0);
    target.max.set(b[o + 3] ?? 0, b[o + 4] ?? 0, b[o + 5] ?? 0);
    return target;
  }

  /**
   * Records the features of one primitive.
   *
   * @param featureIds `_FEATURE_ID_0` per vertex, plus `offset`.
   * @param positions Vertex positions, three floats per vertex.
   * @param index Triangle indices into the same vertex buffers.
   * @param span Where the primitive lies in these buffers.
   * @param offset Added to every feature ID in `featureIds` (the layer's first state texel).
   * @throws if the primitive breaks the layout rules of spec §8.1.
   */
  scan(
    featureIds: ArrayLike<number>,
    positions: ArrayLike<number>,
    index: ArrayLike<number>,
    span: PrimitiveSpan,
    offset = 0,
  ): void {
    const { vertexStart, vertexCount, indexStart, indexCount, bounds } = this;
    let current = -1;
    for (let v = span.vertexStart; v < span.vertexEnd; v++) {
      const feature = (featureIds[v] as number) - offset;
      if (feature !== current) {
        this.#checkNext(feature, current, vertexCount, `vertex ${v}`);
        current = feature;
        vertexStart[feature] = v;
        const o = feature * 6;
        bounds.fill(Number.POSITIVE_INFINITY, o, o + 3);
        bounds.fill(Number.NEGATIVE_INFINITY, o + 3, o + 6);
      }
      vertexCount[feature] = (vertexCount[feature] as number) + 1;
      const o = current * 6;
      for (let axis = 0; axis < 3; axis++) {
        const value = positions[v * 3 + axis] as number;
        if (value < (bounds[o + axis] as number)) bounds[o + axis] = value;
        if (value > (bounds[o + 3 + axis] as number)) bounds[o + 3 + axis] = value;
      }
    }
    current = -1;
    for (let i = span.indexStart; i < span.indexEnd; i += 3) {
      const id = featureIds[index[i] as number] as number;
      if (featureIds[index[i + 1] as number] !== id || featureIds[index[i + 2] as number] !== id) {
        throw new Error(`Triangle at index ${i} mixes features (spec §8.1)`);
      }
      const feature = id - offset;
      if (feature !== current) {
        this.#checkNext(feature, current, indexCount, `index ${i}`);
        current = feature;
        indexStart[feature] = i;
      }
      indexCount[feature] = (indexCount[feature] as number) + 3;
    }
  }

  #checkNext(feature: number, previous: number, counts: Uint32Array, where: string): void {
    if (!Number.isInteger(feature) || feature < 0 || feature >= this.count) {
      throw new Error(`Feature ID ${feature} at ${where} is not a row of the feature table`);
    }
    if (feature < previous || counts[feature] !== 0) {
      throw new Error(
        `Feature ${feature} at ${where} is not contiguous and ascending within its primitive (spec §8.1)`,
      );
    }
  }
}
