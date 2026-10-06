/**
 * Builds `three-mesh-bvh` BVHs off the main thread (see `bvh-builder.ts`). Receives copies of a
 * mesh's positions and indices and returns the serialized BVH. BVHs are indirect, so the index
 * buffer is left as it is and the main thread's geometry stays usable meanwhile.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/** A build request. */
export interface BvhRequest {
  id: number;
  position: Float32Array;
  index: Uint32Array;
}

/** A finished build: the root buffers and the indirect triangle buffer of an indirect BVH. */
export interface BvhResponse {
  id: number;
  roots: ArrayBuffer[];
  indirectBuffer: Uint32Array;
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BvhRequest>) => void) | null;
  postMessage(message: BvhResponse, transfer: Transferable[]): void;
};

scope.onmessage = ({ data: { id, position, index } }) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  const bvh = new MeshBVH(geometry, { indirect: true });
  const { roots, indirectBuffer } = MeshBVH.serialize(bvh, { cloneBuffers: false });
  const indirect = indirectBuffer as Uint32Array;
  scope.postMessage({ id, roots, indirectBuffer: indirect }, [...roots, indirect.buffer]);
};
