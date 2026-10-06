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
 * built on first use; component batches use three's instanced-mesh ray cast.
 */
export class Picker {
  readonly #model: BoardModel;
  readonly #bvhs = new WeakMap<BufferGeometry, MeshBVH>();
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
        const ids = mesh.geometry.getAttribute('_feature_id_0');
        for (const hit of this.bvh(mesh).raycast(ray, FrontSide)) {
          if (hit.face) consider(layer.stateOffset + ids.getX(hit.face.a), hit.point, hit.distance);
        }
      }
    }
    if (this.#model.componentGroup.visible) {
      this.#raycaster.ray.copy(ray);
      for (const { mesh, rows } of this.#model.componentBatches) {
        for (const hit of this.#raycaster.intersectObject(mesh, false)) {
          const row = rows[hit.instanceId ?? -1];
          if (row !== undefined)
            consider(this.#model.componentOffset + row, hit.point, hit.distance);
        }
      }
    }
    return best;
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
