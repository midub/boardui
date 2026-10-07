import {
  type BufferGeometry,
  FrontSide,
  type Mesh,
  type Ray,
  Raycaster,
  type Vector3,
} from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { BoardModel, LayerModel } from './board-model.js';
import { STATE_ATTRIBUTE } from './state.js';

/** The element found by {@link Picker.pick}. */
export interface PickHit {
  /** State texel of the element. */
  texel: number;
  /** Hit point in board coordinates. */
  point: Vector3;
  distance: number;
}

/**
 * Finds the element under a ray. Layer meshes are searched with a `three-mesh-bvh` BVH each,
 * built on first use; component batches search their instances (see `bodies.ts`).
 */
export class Picker {
  readonly #model: BoardModel;
  readonly #bvhs = new WeakMap<BufferGeometry, MeshBVH>();
  /** Meshes whose BVH is being built elsewhere (a worker); they are skipped meanwhile. */
  readonly #pending = new WeakSet<BufferGeometry>();
  readonly #raycaster = new Raycaster();

  constructor(model: BoardModel) {
    this.#model = model;
  }

  /**
   * Returns the nearest element of a visible layer or component hit by `ray`.
   *
   * @param ray Ray in board coordinates.
   * @param skip Texels to look through, for example those of hidden elements.
   * @param layers Layers to search; default all.
   */
  pick(
    ray: Ray,
    skip: (texel: number) => boolean = () => false,
    layers: readonly LayerModel[] = this.#model.layers,
  ): PickHit | null {
    let best: PickHit | null = null;
    const consider = (texel: number, point: Vector3, distance: number) => {
      if ((!best || distance < best.distance) && !skip(texel)) {
        best = { texel, point, distance };
      }
    };
    for (const layer of layers) {
      if (!layer.group.visible) continue;
      for (const mesh of layer.meshes) {
        if (this.#pending.has(mesh.geometry)) continue;
        const texels = mesh.geometry.getAttribute(STATE_ATTRIBUTE);
        for (const hit of this.bvh(mesh).raycast(ray, FrontSide)) {
          if (hit.face) consider(texels.getX(hit.face.a), hit.point, hit.distance);
        }
      }
    }
    if (this.#model.componentGroup.visible) {
      this.#raycaster.ray.copy(ray);
      const offset = this.#model.componentOffset;
      for (const batch of this.#model.componentBatches) {
        batch.raycast(this.#raycaster, (row, point, distance) =>
          consider(offset + row, point, distance),
        );
      }
    }
    return best;
  }

  /** Whether a mesh's BVH exists. */
  has(mesh: Mesh): boolean {
    return this.#bvhs.has(mesh.geometry);
  }

  /**
   * Marks a mesh's BVH as being built elsewhere (`pending`), so {@link pick} skips the mesh
   * instead of building it, or clears the mark.
   */
  setPending(mesh: Mesh, pending: boolean): void {
    if (pending) this.#pending.add(mesh.geometry);
    else this.#pending.delete(mesh.geometry);
  }

  /** Sets a BVH built elsewhere; it must be indirect, so the index buffer stays as it is. */
  setBvh(mesh: Mesh, bvh: MeshBVH): void {
    this.#bvhs.set(mesh.geometry, bvh);
    this.#pending.delete(mesh.geometry);
  }

  /** The BVH of a layer mesh, built on first use. It leaves the index buffer as it is. */
  bvh(mesh: Mesh): MeshBVH {
    let bvh = this.#bvhs.get(mesh.geometry);
    if (!bvh) {
      bvh = new MeshBVH(mesh.geometry, { indirect: true });
      this.#bvhs.set(mesh.geometry, bvh);
    }
    return bvh;
  }
}
