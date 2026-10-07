/**
 * The persistent cache of runtime models: fetched files, and for expensive formats (STEP) the
 * parsed geometry, in Cache Storage. Every error is swallowed: without a cache, models load from
 * their sources.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type Material,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three';
import type { ModelPart } from './model-sources.js';

/** Bumped when what the cache stores changes; part of the cache's name. */
export const MODEL_CACHE_VERSION = 1;
/** Name of the Cache Storage cache. */
export const MODEL_CACHE_NAME = `boardui-models-v${MODEL_CACHE_VERSION}`;
/** Keys are stored as (never fetched) URLs below this one. */
const ORIGIN = 'https://boardui-model-cache.invalid/';

/** What the cache holds for a model. */
export type CachedModel =
  | { kind: 'missing' }
  | { kind: 'file'; data: ArrayBuffer }
  | { kind: 'parsed'; parts: ModelPart[] };

/** The part of `CacheStorage` the cache uses (a fake in tests). */
export type CacheStorageLike = Pick<CacheStorage, 'open'>;

const ATTRIBUTES = ['position', 'normal', 'color', 'uv'] as const;
const ARRAYS = { f32: Float32Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array };
type ArrayName = keyof typeof ARRAYS;

export class ModelCache {
  readonly #cache: Promise<Cache | null>;

  /** @param storage Defaults to `globalThis.caches` (secure contexts only); `null` disables it. */
  constructor(storage: CacheStorageLike | null | undefined = globalThis.caches) {
    this.#cache = storage
      ? storage.open(MODEL_CACHE_NAME).catch(() => null)
      : Promise.resolve(null);
  }

  /**
   * The cached model of a key: the parsed geometry of loader version `parsed` if there is one,
   * else the file, else `missing` if the file is known not to exist, else `null`.
   */
  async get(key: string, parsed: string | number | undefined): Promise<CachedModel | null> {
    const cache = await this.#cache;
    if (!cache) return null;
    try {
      if (parsed !== undefined) {
        const response = await cache.match(url('parsed', key, parsed));
        if (response) return { kind: 'parsed', parts: decodeParts(await response.arrayBuffer()) };
      }
      const response = await cache.match(url('file', key));
      if (!response) return null;
      if (response.headers.get('x-boardui-missing')) return { kind: 'missing' };
      return { kind: 'file', data: await response.arrayBuffer() };
    } catch {
      return null;
    }
  }

  /** Stores a file. */
  putFile(key: string, data: ArrayBuffer): Promise<void> {
    return this.#put(url('file', key), () => new Response(data));
  }

  /** Remembers that a model's file doesn't exist. */
  putMissing(key: string): Promise<void> {
    return this.#put(
      url('file', key),
      () => new Response('', { headers: { 'x-boardui-missing': '1' } }),
    );
  }

  /** Stores parsed geometry. */
  putParsed(key: string, version: string | number, parts: readonly ModelPart[]): Promise<void> {
    return this.#put(url('parsed', key, version), () => new Response(encodeParts(parts)));
  }

  async #put(request: string, response: () => Response): Promise<void> {
    try {
      await (await this.#cache)?.put(request, response());
    } catch {
      // Full, or not allowed: models load from their sources next time.
    }
  }
}

function url(kind: string, key: string, version?: string | number): string {
  return `${ORIGIN}${kind}/${encodeURIComponent(version ?? 0)}/${encodeURIComponent(key)}`;
}

interface PartHeader {
  material: { name: string; color: string; opacity: number; metalness: number; roughness: number };
  attributes: {
    name: string;
    itemSize: number;
    normalized: boolean;
    array: ArrayName;
    offset: number;
    length: number;
  }[];
  index?: { array: ArrayName; offset: number; length: number };
}

function arrayName(array: ArrayLike<number>): ArrayName {
  if (array instanceof Float32Array) return 'f32';
  if (array instanceof Uint8Array) return 'u8';
  if (array instanceof Uint16Array) return 'u16';
  if (array instanceof Uint32Array) return 'u32';
  throw new Error('Unsupported attribute array');
}

/**
 * Serializes parts: a little-endian `u32` header length, the JSON header, then the arrays, each
 * 4-byte aligned. Keeps the attributes of {@link ATTRIBUTES} and the material's colour, opacity,
 * metalness and roughness.
 */
export function encodeParts(parts: readonly ModelPart[]): ArrayBuffer {
  const chunks: ArrayBufferView[] = [];
  let offset = 0;
  const add = (array: ArrayBufferView): number => {
    const at = offset;
    chunks.push(array);
    offset += Math.ceil(array.byteLength / 4) * 4;
    return at;
  };
  const headers = parts.map(({ geometry, material }): PartHeader => {
    const m = material as Partial<MeshStandardMaterial>;
    const header: PartHeader = {
      material: {
        name: material.name,
        color: `#${(m.color ?? new Color(1, 1, 1)).getHexString(SRGBColorSpace)}`,
        opacity: material.opacity,
        metalness: m.metalness ?? 0,
        roughness: m.roughness ?? 1,
      },
      attributes: [],
    };
    for (const name of ATTRIBUTES) {
      const attribute = geometry.getAttribute(name) as BufferAttribute | undefined;
      if (!attribute?.array) continue;
      const array = attribute.array as unknown as ArrayBufferView & ArrayLike<number>;
      header.attributes.push({
        name,
        itemSize: attribute.itemSize,
        normalized: attribute.normalized,
        array: arrayName(array),
        offset: add(array),
        length: array.length,
      });
    }
    const index = geometry.index?.array as (ArrayBufferView & ArrayLike<number>) | undefined;
    if (index) header.index = { array: arrayName(index), offset: add(index), length: index.length };
    return header;
  });
  const json = new TextEncoder().encode(JSON.stringify(headers));
  const start = 4 + Math.ceil(json.byteLength / 4) * 4;
  const bytes = new Uint8Array(start + offset);
  new DataView(bytes.buffer).setUint32(0, json.byteLength, true);
  bytes.set(json, 4);
  let at = start;
  for (const chunk of chunks) {
    bytes.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), at);
    at += Math.ceil(chunk.byteLength / 4) * 4;
  }
  return bytes.buffer;
}

/** The inverse of {@link encodeParts}. */
export function decodeParts(buffer: ArrayBuffer): ModelPart[] {
  const length = new DataView(buffer).getUint32(0, true);
  const headers = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 4, length)),
  ) as PartHeader[];
  const start = 4 + Math.ceil(length / 4) * 4;
  const view = (name: ArrayName, offset: number, count: number) =>
    new ARRAYS[name](
      buffer.slice(start + offset, start + offset + count * ARRAYS[name].BYTES_PER_ELEMENT),
    );
  return headers.map((header) => {
    const geometry = new BufferGeometry();
    for (const a of header.attributes) {
      geometry.setAttribute(
        a.name,
        new BufferAttribute(view(a.array, a.offset, a.length), a.itemSize, a.normalized),
      );
    }
    if (header.index) {
      geometry.setIndex(
        new BufferAttribute(view(header.index.array, header.index.offset, header.index.length), 1),
      );
    }
    const { name, color, opacity, metalness, roughness } = header.material;
    const material: Material = new MeshStandardMaterial({
      name,
      color: new Color().setStyle(color, SRGBColorSpace),
      opacity,
      transparent: opacity < 1,
      metalness,
      roughness,
      vertexColors: geometry.hasAttribute('color'),
    });
    return { geometry, material };
  });
}
