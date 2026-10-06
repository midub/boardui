/**
 * A minimal glTF 2.0 / GLB writer for the test fixtures. It knows just enough of glTF to write
 * boardui assets: buffer views, accessors, meshes, nodes and root extensions.
 */

export const ARRAY_BUFFER = 34962;
export const ELEMENT_ARRAY_BUFFER = 34963;
export const UNSIGNED_SHORT = 5123;
export const UNSIGNED_INT = 5125;
export const FLOAT = 5126;

export interface GltfJson {
  asset: { version: '2.0'; generator: string };
  extensionsUsed: string[];
  extensions: Record<string, unknown>;
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: GltfNode[];
  meshes: { name: string; primitives: GltfPrimitive[] }[];
  materials: Record<string, unknown>[];
  accessors: Record<string, unknown>[];
  bufferViews: Record<string, unknown>[];
  buffers: { byteLength: number }[];
}

export interface GltfNode {
  name: string;
  children?: number[];
  mesh?: number;
  translation?: number[];
  rotation?: number[];
  extras?: Record<string, unknown>;
}

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices: number;
  material: number;
  mode: 4;
  extensions?: Record<string, unknown>;
}

/** Collects binary data and JSON, then packs a GLB. */
export class GltfWriter {
  readonly json: GltfJson = {
    asset: { version: '2.0', generator: 'boardui viewer test fixture' },
    extensionsUsed: [],
    extensions: {},
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };
  readonly #chunks: Uint8Array[] = [];
  #byteLength = 0;

  /** Appends a buffer view, aligned to 8 bytes as `EXT_structural_metadata` requires. */
  bufferView(data: ArrayBufferView, target?: number, byteStride?: number): number {
    const padding = (8 - (this.#byteLength % 8)) % 8;
    if (padding) {
      this.#chunks.push(new Uint8Array(padding));
      this.#byteLength += padding;
    }
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.#chunks.push(bytes);
    const view: Record<string, unknown> = {
      buffer: 0,
      byteOffset: this.#byteLength,
      byteLength: bytes.byteLength,
    };
    if (target !== undefined) view.target = target;
    if (byteStride !== undefined) view.byteStride = byteStride;
    this.#byteLength += bytes.byteLength;
    return this.json.bufferViews.push(view) - 1;
  }

  /** Appends an accessor over a new buffer view. */
  accessor(
    data: Float32Array | Uint16Array | Uint32Array,
    type: 'SCALAR' | 'VEC3',
    target: number,
    options: { minMax?: boolean; byteStride?: number } = {},
  ): number {
    const components = type === 'VEC3' ? 3 : 1;
    let view: ArrayBufferView = data;
    if (options.byteStride !== undefined) {
      const elementBytes = data.BYTES_PER_ELEMENT * components;
      const strided = new Uint8Array((data.length / components) * options.byteStride);
      const source = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      for (let i = 0; i < data.length / components; i++) {
        strided.set(
          source.subarray(i * elementBytes, (i + 1) * elementBytes),
          i * options.byteStride,
        );
      }
      view = strided;
    }
    const accessor: Record<string, unknown> = {
      bufferView: this.bufferView(view, target, options.byteStride),
      componentType:
        data instanceof Float32Array
          ? FLOAT
          : data instanceof Uint16Array
            ? UNSIGNED_SHORT
            : UNSIGNED_INT,
      count: data.length / components,
      type,
    };
    if (options.minMax) {
      const min = new Array<number>(components).fill(Number.POSITIVE_INFINITY);
      const max = new Array<number>(components).fill(Number.NEGATIVE_INFINITY);
      data.forEach((value, i) => {
        const c = i % components;
        min[c] = Math.min(min[c] as number, value);
        max[c] = Math.max(max[c] as number, value);
      });
      accessor.min = min;
      accessor.max = max;
    }
    return this.json.accessors.push(accessor) - 1;
  }

  /** Appends a node and returns its index. */
  node(node: GltfNode): number {
    return this.json.nodes.push(node) - 1;
  }

  /** Packs the GLB. */
  glb(): Uint8Array {
    const bin = new Uint8Array(align4(this.#byteLength));
    let offset = 0;
    for (const chunk of this.#chunks) {
      bin.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.json.buffers[0] = { byteLength: this.#byteLength };
    const jsonText = new TextEncoder().encode(JSON.stringify(this.json));
    const jsonChunk = new Uint8Array(align4(jsonText.byteLength)).fill(0x20);
    jsonChunk.set(jsonText);

    const glb = new Uint8Array(12 + 8 + jsonChunk.byteLength + 8 + bin.byteLength);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true); // 'glTF'
    view.setUint32(4, 2, true);
    view.setUint32(8, glb.byteLength, true);
    view.setUint32(12, jsonChunk.byteLength, true);
    view.setUint32(16, 0x4e4f534a, true); // 'JSON'
    glb.set(jsonChunk, 20);
    const binOffset = 20 + jsonChunk.byteLength;
    view.setUint32(binOffset, bin.byteLength, true);
    view.setUint32(binOffset + 4, 0x004e4942, true); // 'BIN\0'
    glb.set(bin, binOffset + 8);
    return glb;
  }
}

function align4(n: number): number {
  return Math.ceil(n / 4) * 4;
}
