/**
 * Component bodies: the placeholder bodies (and user models) of the asset, and the runtime models
 * that replace placeholder bodies (spec/README.md, "Runtime models").
 *
 * The asset's bodies are merged into one static mesh per material, so that a board draws them
 * with a few meshes however many packages it has; only large meshes that repeat stay instanced
 * (see {@link MERGE_MAX_COPIED_VERTICES}). Runtime models are instanced. Every vertex (merged) or
 * instance carries its component's state texel ({@link STATE_ATTRIBUTE}), so hover, picking,
 * selection and highlights work the same on all bodies, and they share their materials.
 */
import {
  BackSide,
  Box3,
  BufferAttribute,
  BufferGeometry,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix3,
  Matrix4,
  Mesh,
  type Raycaster,
  type Side,
  Sphere,
  Vector3,
} from 'three';
import { STATE_ATTRIBUTE } from './state.js';

/**
 * The asset's meshes are merged unless the copies of a mesh would add more vertices than this
 * (vertices × (instances − 1)); then they are instanced. Placeholder bodies have tens of vertices.
 */
export const MERGE_MAX_COPIED_VERTICES = 1 << 18;

/** Receives a component instance that a ray hits. */
export type BodyHit = (row: number, point: Vector3, distance: number) => void;

/** Component meshes drawn as one: an instanced mesh, or a merged one. */
export interface ComponentBatch {
  /** The mesh; it has the source material until the viewer gives it its own. */
  readonly mesh: Mesh;
  /** Component row of each drawn instance. */
  readonly rows: Uint32Array;
  /** Draws only the instances whose component passes `keep`. */
  filter(keep: (row: number) => boolean): void;
  /** Adds the bounding box of each instance to its component's, as stored (float32). */
  addBounds(bounds: Box3[]): void;
  /** Reports the drawn instances hit by the ray of `raycaster`, as three's ray casts do. */
  raycast(raycaster: Raycaster, hit: BodyHit): void;
  /** Releases the GPU resources of the batch. */
  dispose(): void;
}

/** Meshes of the asset's components that share geometry and material, with their instances. */
export interface BodyGroup {
  readonly geometry: BufferGeometry;
  readonly material: Material;
  /** Component row of each instance. */
  readonly rows: readonly number[];
  /** World matrix of each instance. */
  readonly matrices: readonly Matrix4[];
}

/**
 * Batches the asset's component meshes: merged per material and vertex layout, except large
 * meshes that repeat, which are instanced.
 *
 * @param texelOffset State texel of component row 0.
 */
export function batchBodies(groups: readonly BodyGroup[], texelOffset: number): ComponentBatch[] {
  const merged = new Map<string, BodyGroup[]>();
  const instanced: ComponentBatch[] = [];
  for (const group of groups) {
    const { geometry, material, rows, matrices } = group;
    const copies = geometry.getAttribute('position').count * (rows.length - 1);
    if (copies > MERGE_MAX_COPIED_VERTICES || !mergeable(geometry)) {
      instanced.push(
        new InstancedBatch(geometry, material, Uint32Array.from(rows), matrices, texelOffset),
      );
      continue;
    }
    const key = `${material.uuid}|${layout(geometry)}`;
    const list = merged.get(key);
    if (list) list.push(group);
    else merged.set(key, [group]);
  }
  return [...[...merged.values()].map((list) => new MergedBatch(list, texelOffset)), ...instanced];
}

/** Component meshes that share geometry and material, drawn as one instanced mesh. */
export class InstancedBatch implements ComponentBatch {
  readonly mesh: InstancedMesh;
  /** State texel of every drawn instance, as the material reads it. */
  readonly #texels: InstancedBufferAttribute;
  readonly #texelOffset: number;
  /** Rows and matrices of all instances, drawn or not. */
  readonly #allRows: Uint32Array;
  readonly #allMatrices: Float32Array;
  readonly #rows: Uint32Array;
  /** Index into the instances of each drawn one. */
  readonly #drawn: Uint32Array;

  /**
   * @param geometry Not modified: the batch draws a copy that shares its attributes.
   * @param texelOffset State texel of component row 0.
   */
  constructor(
    geometry: BufferGeometry,
    material: Material,
    rows: Uint32Array,
    matrices: readonly Matrix4[],
    texelOffset: number,
  ) {
    const own = shallowCopy(geometry);
    this.#texelOffset = texelOffset;
    this.#texels = new InstancedBufferAttribute(
      Float32Array.from(rows, (row) => row + texelOffset),
      1,
    );
    own.setAttribute(STATE_ATTRIBUTE, this.#texels);
    this.mesh = new InstancedMesh(own, material, rows.length);
    matrices.forEach((matrix, i) => {
      this.mesh.setMatrixAt(i, matrix);
    });
    this.#allRows = rows.slice();
    this.#allMatrices = (this.mesh.instanceMatrix.array as Float32Array).slice();
    this.#rows = rows.slice();
    this.#drawn = Uint32Array.from(rows, (_, i) => i);
    this.#update();
  }

  get rows(): Uint32Array {
    return this.#rows.subarray(0, this.mesh.count);
  }

  filter(keep: (row: number) => boolean): void {
    const matrices = this.mesh.instanceMatrix.array as Float32Array;
    const texels = this.#texels.array as Float32Array;
    let count = 0;
    let changed = false;
    this.#allRows.forEach((row, i) => {
      if (!keep(row)) return;
      if (this.#drawn[count] !== i || count >= this.mesh.count) {
        changed = true;
        this.#drawn[count] = i;
        this.#rows[count] = row;
        texels[count] = row + this.#texelOffset;
        matrices.set(this.#allMatrices.subarray(i * 16, i * 16 + 16), count * 16);
      }
      count++;
    });
    if (!changed && count === this.mesh.count) return;
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.#texels.needsUpdate = true;
    this.#update();
  }

  addBounds(bounds: Box3[]): void {
    const { mesh } = this;
    const geometry = mesh.geometry;
    geometry.computeBoundingBox();
    const box = new Box3();
    const matrix = new Matrix4();
    this.rows.forEach((row, i) => {
      mesh.getMatrixAt(i, matrix);
      box.copy(geometry.boundingBox as Box3).applyMatrix4(matrix);
      bounds[row]?.union(box);
    });
  }

  raycast(raycaster: Raycaster, hit: BodyHit): void {
    for (const h of raycaster.intersectObject(this.mesh, false)) {
      const row = this.rows[h.instanceId ?? -1];
      if (row !== undefined) hit(row, h.point, h.distance);
    }
  }

  /**
   * Releases the batch's geometry and instances. three then also releases the GPU buffers of
   * attributes shared with the source geometry; it uploads them again if they are drawn later.
   */
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }

  #update(): void {
    this.mesh.computeBoundingBox();
    this.mesh.computeBoundingSphere();
    this.mesh.visible = this.mesh.count > 0;
  }
}

/**
 * Instances of component meshes baked into one static mesh with one material: positions (and
 * normals) in board coordinates, and a state texel per vertex. Hiding instances shortens the
 * index buffer.
 */
export class MergedBatch implements ComponentBatch {
  readonly mesh: Mesh;
  /** Component row of each instance. */
  readonly #rows: Uint32Array;
  /** Component row of each drawn instance. */
  readonly #drawnRows: Uint32Array;
  #drawnCount: number;
  /** Whether each instance is drawn. */
  readonly #drawn: Uint8Array;
  /** Indices of all instances; instance `i` owns `#indexStart[i]` up to `#indexStart[i + 1]`. */
  readonly #allIndex: Uint32Array;
  readonly #indexStart: Uint32Array;
  /** Box of each instance's vertices, to skip instances in ray casts. */
  readonly #boxes: Box3[];
  /** Bounding box of each instance as {@link InstancedBatch} computes it. */
  readonly #bounds: Box3[];
  readonly #positions: Float32Array;
  readonly #side: Side;

  /**
   * @param groups Groups with one material and the same vertex attributes.
   * @param texelOffset State texel of component row 0.
   */
  constructor(groups: readonly BodyGroup[], texelOffset: number) {
    const first = groups[0];
    if (!first) throw new Error('MergedBatch needs a group');
    const material = first.material;
    const names = Object.keys(first.geometry.attributes);
    let vertexCount = 0;
    let indexCount = 0;
    let instances = 0;
    for (const { geometry, rows } of groups) {
      const count = geometry.getAttribute('position').count;
      vertexCount += count * rows.length;
      indexCount += (geometry.index?.count ?? count) * rows.length;
      instances += rows.length;
    }
    const arrays = new Map<string, Float32Array>();
    for (const name of names) {
      const itemSize = first.geometry.getAttribute(name).itemSize;
      arrays.set(name, new Float32Array(vertexCount * itemSize));
    }
    const texels = new Float32Array(vertexCount);
    this.#positions = arrays.get('position') as Float32Array;
    this.#allIndex = new Uint32Array(indexCount);
    this.#indexStart = new Uint32Array(instances + 1);
    this.#rows = new Uint32Array(instances);
    this.#boxes = [];
    this.#bounds = [];

    const point = new Vector3();
    const matrix = new Matrix4();
    const normalMatrix = new Matrix3();
    let v = 0;
    let i = 0;
    let instance = 0;
    for (const { geometry, rows, matrices } of groups) {
      geometry.computeBoundingBox();
      const position = geometry.getAttribute('position');
      const index = geometry.index;
      const count = index?.count ?? position.count;
      rows.forEach((row, k) => {
        // Rounded like an instance matrix, so that bounds are as an instanced batch stores them.
        matrix.fromArray(Float32Array.from((matrices[k] as Matrix4).elements));
        normalMatrix.getNormalMatrix(matrix);
        const box = new Box3();
        for (const name of names) {
          const source = geometry.getAttribute(name);
          const target = arrays.get(name) as Float32Array;
          const size = source.itemSize;
          for (let j = 0; j < position.count; j++) {
            const at = (v + j) * size;
            if (name === 'position') {
              point.fromBufferAttribute(source, j).applyMatrix4(matrix).toArray(target, at);
              box.expandByPoint(point);
            } else if (name === 'normal') {
              point.fromBufferAttribute(source, j).applyNormalMatrix(normalMatrix);
              point.toArray(target, at);
            } else {
              for (let c = 0; c < size; c++) target[at + c] = source.getComponent(j, c);
            }
          }
        }
        texels.fill(row + texelOffset, v, v + position.count);
        // A mirroring matrix turns the triangles over; restore their winding.
        const mirrored = matrix.determinant() < 0;
        for (let j = 0; j < count; j += 3) {
          const a = index ? index.getX(j) : j;
          const b = index ? index.getX(j + 1) : j + 1;
          const c = index ? index.getX(j + 2) : j + 2;
          this.#allIndex[i + j] = v + a;
          this.#allIndex[i + j + 1] = v + (mirrored ? c : b);
          this.#allIndex[i + j + 2] = v + (mirrored ? b : c);
        }
        this.#rows[instance] = row;
        this.#boxes.push(box);
        this.#bounds.push((geometry.boundingBox as Box3).clone().applyMatrix4(matrix));
        v += position.count;
        i += count;
        instance++;
        this.#indexStart[instance] = i;
      });
    }

    const merged = new BufferGeometry();
    for (const name of names) {
      const itemSize = first.geometry.getAttribute(name).itemSize;
      merged.setAttribute(name, new BufferAttribute(arrays.get(name) as Float32Array, itemSize));
    }
    merged.setAttribute(STATE_ATTRIBUTE, new BufferAttribute(texels, 1));
    merged.setIndex(new BufferAttribute(this.#allIndex.slice(), 1));
    this.mesh = new Mesh(merged, material);
    this.mesh.name = material.name;
    this.#side = material.side;
    this.#drawn = new Uint8Array(instances).fill(1);
    this.#drawnRows = this.#rows.slice();
    this.#drawnCount = instances;
    this.#update();
  }

  get rows(): Uint32Array {
    return this.#drawnRows.subarray(0, this.#drawnCount);
  }

  filter(keep: (row: number) => boolean): void {
    let changed = false;
    this.#rows.forEach((row, i) => {
      const drawn = keep(row) ? 1 : 0;
      if (this.#drawn[i] !== drawn) {
        this.#drawn[i] = drawn;
        changed = true;
      }
    });
    if (!changed) return;
    const index = this.mesh.geometry.index as BufferAttribute;
    const array = index.array as Uint32Array;
    let length = 0;
    let count = 0;
    this.#rows.forEach((row, i) => {
      if (!this.#drawn[i]) return;
      const start = this.#indexStart[i] as number;
      const end = this.#indexStart[i + 1] as number;
      array.set(this.#allIndex.subarray(start, end), length);
      length += end - start;
      this.#drawnRows[count++] = row;
    });
    this.#drawnCount = count;
    this.mesh.geometry.setDrawRange(0, length);
    index.needsUpdate = true;
    this.#update();
  }

  addBounds(bounds: Box3[]): void {
    this.#rows.forEach((row, i) => {
      bounds[row]?.union(this.#bounds[i] as Box3);
    });
  }

  raycast(raycaster: Raycaster, hit: BodyHit): void {
    const { ray, near, far } = raycaster;
    const positions = this.#positions;
    const index = this.#allIndex;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const point = new Vector3();
    const cull = this.#side === FrontSide;
    this.#rows.forEach((row, i) => {
      if (!this.#drawn[i] || !ray.intersectsBox(this.#boxes[i] as Box3)) return;
      const end = this.#indexStart[i + 1] as number;
      for (let j = this.#indexStart[i] as number; j < end; j += 3) {
        a.fromArray(positions, (index[j] as number) * 3);
        b.fromArray(positions, (index[j + 1] as number) * 3);
        c.fromArray(positions, (index[j + 2] as number) * 3);
        const found =
          this.#side === BackSide
            ? ray.intersectTriangle(c, b, a, true, point)
            : ray.intersectTriangle(a, b, c, cull, point);
        if (!found) continue;
        const distance = ray.origin.distanceTo(point);
        if (distance >= near && distance <= far) hit(row, point.clone(), distance);
      }
    });
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }

  /** Bounds of the drawn instances, for frustum culling and the board's bounds. */
  #update(): void {
    const geometry = this.mesh.geometry;
    geometry.boundingBox ??= new Box3();
    const box = geometry.boundingBox.makeEmpty();
    this.#rows.forEach((_, i) => {
      if (this.#drawn[i]) box.union(this.#boxes[i] as Box3);
    });
    geometry.boundingSphere = box.getBoundingSphere(geometry.boundingSphere ?? new Sphere());
    this.mesh.visible = this.#drawnCount > 0;
  }
}

/** The bodies of all components: the asset's batches, and runtime models replacing some. */
export class ComponentBodies {
  /** Holds every body mesh; its `visible` flag shows or hides all components. */
  readonly group: Group;
  /** The asset's batches: placeholder bodies, pin-1 markers and user models. */
  readonly placeholders: readonly ComponentBatch[];
  readonly #models = new Group();
  readonly #texelOffset: number;
  readonly #nodeMatrices: readonly (Matrix4 | null)[];
  readonly #replaceable: Uint8Array;
  readonly #assetBounds: Box3[];
  readonly #modelBounds: Box3[];
  /** Key of the runtime model of each row, if it has one. */
  readonly #modelKeys: (string | undefined)[];
  readonly #modelBatches = new Map<string, InstancedBatch[]>();
  #shown = true;

  /**
   * @param texelOffset State texel of component row 0.
   * @param nodeMatrices World matrix of each component's node.
   * @param replaceable Whether a row's body is a placeholder (spec §6.8) that a runtime model
   *   may replace: it has one, and no user model.
   */
  constructor(
    group: Group,
    placeholders: ComponentBatch[],
    texelOffset: number,
    nodeMatrices: (Matrix4 | null)[],
    replaceable: Uint8Array,
  ) {
    this.group = group;
    this.placeholders = placeholders;
    this.#texelOffset = texelOffset;
    this.#nodeMatrices = nodeMatrices;
    this.#replaceable = replaceable;
    const count = nodeMatrices.length;
    this.#assetBounds = Array.from({ length: count }, () => new Box3());
    this.#modelBounds = Array.from({ length: count }, () => new Box3());
    this.#modelKeys = new Array(count);
    for (const batch of placeholders) {
      group.add(batch.mesh);
      batch.addBounds(this.#assetBounds);
    }
    this.#models.name = 'models';
    group.add(this.#models);
  }

  /** The batches drawn and picked. */
  get batches(): ComponentBatch[] {
    const batches = [...this.placeholders];
    if (this.#shown) for (const list of this.#modelBatches.values()) batches.push(...list);
    return batches;
  }

  /** Whether runtime models are shown instead of the placeholders they replace. */
  get modelsShown(): boolean {
    return this.#shown;
  }

  /** Number of components that have a runtime model. */
  get modelCount(): number {
    return this.#modelKeys.filter((key) => key !== undefined).length;
  }

  /** Bounding box of a component's body as drawn (empty if it has none). */
  bounds(row: number): Box3 {
    return (
      this.#shown && this.#modelKeys[row] !== undefined ? this.#modelBounds : this.#assetBounds
    )[row] as Box3;
  }

  /** Whether a runtime model may replace the component's body. */
  replaceable(row: number): boolean {
    return this.#replaceable[row] === 1;
  }

  /** World matrix of a component's node, or `null` if the component has no node. */
  nodeMatrix(row: number): Matrix4 | null {
    return this.#nodeMatrices[row] ?? null;
  }

  /**
   * Shows a runtime model on components, replacing their placeholder bodies, and any batches of
   * the same key shown before.
   *
   * @param matrices Each instance's world matrix (node and model transform).
   * @returns The new batches (one per part); their meshes have the parts' materials.
   */
  setModel(
    key: string,
    parts: readonly { geometry: BufferGeometry; material: Material }[],
    rows: Uint32Array,
    matrices: readonly Matrix4[],
  ): ComponentBatch[] {
    this.removeModel(key);
    const batches = parts.map(
      ({ geometry, material }) =>
        new InstancedBatch(geometry, material, rows, matrices, this.#texelOffset),
    );
    for (const row of rows) {
      this.#modelKeys[row] = key;
      this.#modelBounds[row]?.makeEmpty();
    }
    for (const batch of batches) {
      batch.addBounds(this.#modelBounds);
      this.#models.add(batch.mesh);
    }
    this.#modelBatches.set(key, batches);
    this.#filter();
    return batches;
  }

  /**
   * Removes the runtime model of a key, showing the placeholders again.
   *
   * @returns The removed batches, disposed; the caller releases their materials. The parts'
   *   geometry is shared with other loads of the model, so it is not disposed.
   */
  removeModel(key: string): ComponentBatch[] {
    const batches = this.#modelBatches.get(key);
    if (!batches) return [];
    this.#modelBatches.delete(key);
    for (const batch of batches) {
      this.#models.remove(batch.mesh);
      batch.dispose();
      for (const row of batch.rows) {
        if (this.#modelKeys[row] === key) this.#modelKeys[row] = undefined;
      }
    }
    this.#filter();
    return batches;
  }

  /** Removes every runtime model; see {@link removeModel}. */
  clearModels(): ComponentBatch[] {
    return [...this.#modelBatches.keys()].flatMap((key) => this.removeModel(key));
  }

  /** Shows the runtime models, or the placeholders they replace. */
  showModels(on: boolean): void {
    this.#shown = on;
    this.#models.visible = on;
    this.#filter();
  }

  dispose(): void {
    for (const batch of this.placeholders) batch.dispose();
    this.clearModels();
  }

  #filter(): void {
    const keep = (row: number) => !this.#shown || this.#modelKeys[row] === undefined;
    for (const batch of this.placeholders) batch.filter(keep);
  }
}

/**
 * Whether a geometry's instances can be merged: no morph targets or tangents. Groups don't matter
 * with one material.
 */
function mergeable(geometry: BufferGeometry): boolean {
  return (
    !Object.keys(geometry.morphAttributes).length &&
    !geometry.hasAttribute('tangent') &&
    !geometry.hasAttribute(STATE_ATTRIBUTE)
  );
}

/** The vertex attributes of a geometry, by name and size. */
function layout(geometry: BufferGeometry): string {
  return Object.entries(geometry.attributes)
    .map(([name, attribute]) => `${name}:${attribute.itemSize}`)
    .sort()
    .join(',');
}

/** A geometry that shares the attributes and index of `geometry`. */
function shallowCopy(geometry: BufferGeometry): BufferGeometry {
  const copy = new BufferGeometry();
  copy.setIndex(geometry.index);
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    copy.setAttribute(name, attribute);
  }
  copy.morphAttributes = geometry.morphAttributes;
  copy.morphTargetsRelative = geometry.morphTargetsRelative;
  for (const { start, count, materialIndex } of geometry.groups) {
    copy.addGroup(start, count, materialIndex);
  }
  copy.boundingBox = geometry.boundingBox?.clone() ?? null;
  copy.boundingSphere = geometry.boundingSphere?.clone() ?? null;
  copy.name = geometry.name;
  return copy;
}
