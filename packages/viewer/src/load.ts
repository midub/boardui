import { LoaderUtils } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** What {@link loadGltf} accepts: a URL, or the bytes of a GLB. */
export type BoardSource = string | URL | ArrayBuffer | Uint8Array;

/**
 * Loads a glTF asset with `GLTFLoader`, with `EXT_meshopt_compression` support.
 *
 * @param source URL of a `.glb`/`.gltf`, or the bytes of a GLB.
 * @param signal Aborts a pending download.
 * @param base URL that relative URIs in the bytes of a glTF resolve against.
 */
export async function loadGltf(
  source: BoardSource,
  signal?: AbortSignal,
  base = '',
): Promise<GLTF> {
  let data: ArrayBuffer;
  let path = base;
  if (typeof source === 'string' || source instanceof URL) {
    const url = String(source);
    const response = await fetch(url, signal ? { signal } : {});
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
    }
    data = await response.arrayBuffer();
    path = LoaderUtils.extractUrlBase(url);
  } else if (source instanceof Uint8Array) {
    data = source.slice().buffer;
  } else {
    data = source;
  }
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(data, path);
}
