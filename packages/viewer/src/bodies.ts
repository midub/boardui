/**
 * Component bodies: the placeholder bodies (and user models) of the asset, batched into
 * instanced meshes, and the runtime models that replace placeholder bodies (spec/README.md,
 * "Runtime models"). A component's instances all read its state texel, so hover, picking,
 * selection and highlights work the same on both.
 */
import {
  Box3,
  type BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
} from 'three';

/** Component meshes that share geometry and material, drawn as one instanced mesh. */
export class ComponentBatch {
  readonly mesh: InstancedMesh;
  /** Component row of every drawn instance, as the material reads it. */
  readonly rowAttribute: InstancedBufferAttribute;
  /** Rows and matrices of all instances, drawn or not. */
  readonly #allRows: Uint32Array;
  readonly #allMatrices: Float32Array;
  readonly #rows: Uint32Array;
  /** Index into the instances of each drawn one. */
  readonly #drawn: Uint32Array;

  constructor(
    geometry: BufferGeometry,
    material: Material,
    rows: Uint32Array,
    matrices: readonly Matrix4[],
  ) {
    this.mesh = new InstancedMesh(geometry, material, rows.length);
    matrices.forEach((matrix, i) => {
      this.mesh.setMatrixAt(i, matrix);
    });
    this.#allRows = rows.slice();
    this.#allMatrices = (this.mesh.instanceMatrix.array as Float32Array).slice();
    this.#rows = rows.slice();
    this.#drawn = Uint32Array.from(rows, (_, i) => i);
    this.rowAttribute = new InstancedBufferAttribute(Float32Array.from(rows), 1);
    this.#update();
  }

  /** Component row of each drawn instance. */
  get rows(): Uint32Array {
    return this.#rows.subarray(0, this.mesh.count);
  }

  /** Draws only the instances whose component passes `keep`. */
  filter(keep: (row: number) => boolean): void {
    const matrices = this.mesh.instanceMatrix.array as Float32Array;
    const rows = this.rowAttribute.array as Float32Array;
    let count = 0;
    let changed = false;
    this.#allRows.forEach((row, i) => {
      if (!keep(row)) return;
      if (this.#drawn[count] !== i || count >= this.mesh.count) {
        changed = true;
        this.#drawn[count] = i;
        this.#rows[count] = row;
        rows[count] = row;
        matrices.set(this.#allMatrices.subarray(i * 16, i * 16 + 16), count * 16);
      }
      count++;
    });
    if (!changed && count === this.mesh.count) return;
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.rowAttribute.needsUpdate = true;
    this.#update();
  }

  /** Releases the GPU resources of the geometry and the instances. */
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

/** The bodies of all components: the asset's batches, and runtime models replacing some. */
export class ComponentBodies {
  /** Holds every body mesh; its `visible` flag shows or hides all components. */
  readonly group: Group;
  /** The asset's batches: placeholder bodies, pin-1 markers and user models. */
  readonly placeholders: readonly ComponentBatch[];
  readonly #models = new Group();
  readonly #nodeMatrices: readonly (Matrix4 | null)[];
  readonly #replaceable: Uint8Array;
  readonly #assetBounds: Box3[];
  readonly #modelBounds: Box3[];
  /** Key of the runtime model of each row, if it has one. */
  readonly #modelKeys: (string | undefined)[];
  readonly #modelBatches = new Map<string, ComponentBatch[]>();
  #shown = true;

  /**
   * @param nodeMatrices World matrix of each component's node.
   * @param replaceable Whether a row's body is a placeholder (spec §6.8) that a runtime model
   *   may replace: it has one, and no user model.
   */
  constructor(
    group: Group,
    placeholders: ComponentBatch[],
    nodeMatrices: (Matrix4 | null)[],
    replaceable: Uint8Array,
  ) {
    this.group = group;
    this.placeholders = placeholders;
    this.#nodeMatrices = nodeMatrices;
    this.#replaceable = replaceable;
    const count = nodeMatrices.length;
    this.#assetBounds = Array.from({ length: count }, () => new Box3());
    this.#modelBounds = Array.from({ length: count }, () => new Box3());
    this.#modelKeys = new Array(count);
    for (const batch of placeholders) {
      group.add(batch.mesh);
      bound(batch, this.#assetBounds);
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
      ({ geometry, material }) => new ComponentBatch(geometry, material, rows, matrices),
    );
    for (const row of rows) {
      this.#modelKeys[row] = key;
      this.#modelBounds[row]?.makeEmpty();
    }
    for (const batch of batches) {
      bound(batch, this.#modelBounds);
      this.#models.add(batch.mesh);
    }
    this.#modelBatches.set(key, batches);
    this.#filter();
    return batches;
  }

  /**
   * Removes the runtime model of a key, showing the placeholders again.
   *
   * @returns The removed batches; the caller releases their materials. Their geometry is shared
   *   with other loads of the model, so it is not disposed.
   */
  removeModel(key: string): ComponentBatch[] {
    const batches = this.#modelBatches.get(key);
    if (!batches) return [];
    this.#modelBatches.delete(key);
    for (const batch of batches) {
      this.#models.remove(batch.mesh);
      batch.mesh.dispose();
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
    for (const batch of this.clearModels()) batch.mesh.dispose();
  }

  #filter(): void {
    const keep = (row: number) => !this.#shown || this.#modelKeys[row] === undefined;
    for (const batch of this.placeholders) batch.filter(keep);
  }
}

/** Adds the instances of a batch to their components' bounds, as stored (float32). */
function bound(batch: ComponentBatch, bounds: Box3[]): void {
  const { mesh } = batch;
  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const box = new Box3();
  const matrix = new Matrix4();
  batch.rows.forEach((row, i) => {
    mesh.getMatrixAt(i, matrix);
    box.copy(geometry.boundingBox as Box3).applyMatrix4(matrix);
    bounds[row]?.union(box);
  });
}
