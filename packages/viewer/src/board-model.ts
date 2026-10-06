/**
 * The loaded board: metadata tables, merged layer meshes, batched component meshes and the
 * indices that resolve element IDs to geometry (spec §5, §8, §9). Nothing here needs a GPU.
 */
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  type Object3D,
  Vector3,
} from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import {
  type BoardDrillJson,
  type BoardExtensionJson,
  type BoardLayerJson,
  readBoardExtension,
} from './board-extension.js';
import { FeatureRanges } from './feature-ranges.js';
import { type ElementKind, featureId, idKind, parseFeatureId } from './ids.js';
import {
  PropertyTable,
  type PropertyValue,
  parsePropertyTables,
  type StructuralMetadataJson,
} from './metadata.js';

/** Row reference meaning "none" (spec §8.2). */
const NONE = 4294967295;
const IDENTITY = new Matrix4();

/** An element as reported by the `bui-hover` and `bui-select` events. */
export interface ElementInfo {
  /** Element ID (spec §5). */
  id: string;
  kind: ElementKind;
  /** Metadata of the element. References to other elements are given as their IDs. */
  properties: Record<string, unknown>;
}

/** A layer or drill layer with its geometry. */
export interface LayerModel {
  readonly id: string;
  readonly kind: 'layer' | 'drill';
  /** The layer's `BOARDUI_board` entry. */
  readonly info: BoardLayerJson | BoardDrillJson;
  readonly table: PropertyTable;
  /** State texel of the layer's first feature. */
  readonly stateOffset: number;
  readonly ranges: FeatureRanges;
  /** Holds {@link meshes}; its `visible` flag is the layer's visibility. */
  readonly group: Group;
  /** Merged meshes, one per material, in board coordinates. */
  readonly meshes: readonly Mesh[];
}

/** Component meshes that share geometry and material, drawn as one instanced mesh. */
export interface ComponentBatch {
  readonly mesh: InstancedMesh;
  /** Component row of each instance. */
  readonly rows: Uint32Array;
}

/** An element resolved to its state texels and bounding box (spec §9). */
export interface ResolvedElement {
  readonly id: string;
  readonly kind: ElementKind;
  /** Sorted state texels of the element. */
  readonly texels: Uint32Array;
  /** Bounding box in board coordinates, or `null` if the element has no geometry. */
  readonly box: Box3 | null;
}

/** Element kinds that {@link BoardModel.ids} can list. */
export type ListableKind = 'layer' | 'component' | 'pin' | 'net';

/** Compressed lists of state texels per table row. */
class RowIndex {
  constructor(
    readonly offsets: Uint32Array,
    readonly values: Uint32Array,
  ) {}

  get(row: number): Uint32Array {
    return this.values.subarray(this.offsets[row], this.offsets[row + 1]);
  }
}

/** The loaded board. Create it with {@link BoardModel.fromGltf}. */
export class BoardModel {
  /** Holds the layer groups and the component meshes. */
  readonly root = new Group();
  /** Holds the component meshes. */
  readonly componentGroup = new Group();
  /** Bounding box of the whole board. */
  readonly bounds = new Box3();
  /** State texel of component row 0. Components follow all layer features. */
  readonly componentOffset: number;
  /** Number of state texels: every feature and every component. */
  readonly stateCount: number;
  readonly componentBatches: readonly ComponentBatch[];

  readonly #layerById = new Map<string, LayerModel>();
  readonly #rows: Record<'component' | 'pin' | 'net', Map<string, number>>;
  readonly #netTexels: RowIndex;
  readonly #pinTexels: RowIndex;
  readonly #componentTexels: RowIndex;
  readonly #componentBounds: Box3[];
  readonly #sourceRows = new Map<LayerModel, Map<number, number>>();

  private constructor(
    /** The `BOARDUI_board` extension. */
    readonly board: BoardExtensionJson,
    readonly nets: PropertyTable,
    readonly components: PropertyTable,
    readonly pins: PropertyTable,
    /** Layers top to bottom, then drill layers. */
    readonly layers: readonly LayerModel[],
    nodes: ReadonlyMap<number, Object3D>,
  ) {
    for (const layer of layers) {
      this.#layerById.set(layer.id, layer);
      this.root.add(layer.group);
    }
    const last = layers.at(-1);
    this.componentOffset = last ? last.stateOffset + last.table.count : 0;
    this.stateCount = this.componentOffset + components.count;
    this.#rows = {
      component: rowsById(components),
      pin: rowsById(pins),
      net: rowsById(nets),
    };
    this.#netTexels = this.#indexFeatures('net', nets.count);
    this.#pinTexels = this.#indexFeatures('pin', pins.count);
    this.#componentTexels = this.#indexFeatures('component', components.count);

    this.#componentBounds = Array.from({ length: components.count }, () => new Box3());
    this.componentBatches = this.#batchComponents(nodes);
    this.componentGroup.name = 'components';
    this.root.add(this.componentGroup);
    this.root.updateMatrixWorld(true);
    this.bounds.setFromObject(this.root);
  }

  /**
   * Builds the model from a loaded boardui asset.
   *
   * @throws if the asset is not a boardui asset or breaks the profile's layout rules.
   */
  static async fromGltf(gltf: GLTF): Promise<BoardModel> {
    const json = gltf.parser.json as {
      extensions?: Record<string, unknown>;
    };
    const board = readBoardExtension(json);
    const metadata = json.extensions?.EXT_structural_metadata as StructuralMetadataJson | undefined;
    if (!metadata) {
      throw new Error('Not a boardui asset: EXT_structural_metadata is missing');
    }
    const views = new Map<number, ArrayBuffer>();
    for (const table of metadata.propertyTables ?? []) {
      for (const property of Object.values(table.properties ?? {})) {
        for (const view of [property.values, property.stringOffsets]) {
          if (view !== undefined && !views.has(view)) {
            views.set(view, await gltf.parser.getDependency('bufferView', view));
          }
        }
      }
    }
    const tables = parsePropertyTables(metadata, (index) => views.get(index) as ArrayBuffer);
    // Tables without rows are omitted from the asset (spec §8.2); they read as empty.
    const table = (index: number | undefined, what: string, name: string): PropertyTable => {
      if (index === undefined) return new PropertyTable(name, what, 0, new Map());
      const found = tables[index];
      if (!found) throw new Error(`BOARDUI_board refers to missing ${what} table ${index}`);
      return found;
    };

    gltf.scene.updateMatrixWorld(true);
    const nodes = new Map<number, Object3D>();
    gltf.scene.traverse((object) => {
      const index = gltf.parser.associations.get(object)?.nodes;
      if (index !== undefined) nodes.set(index, object);
    });

    let stateOffset = 0;
    const layers = [
      ...board.layers.map((info) => ['layer', info] as const),
      ...board.drills.map((info) => ['drill', info] as const),
    ].map(([kind, info]): LayerModel => {
      const node = nodes.get(info.node);
      if (!node) throw new Error(`${info.id}: node ${info.node} not found`);
      const features = table(info.featureTable, 'feature', info.id);
      const ranges = new FeatureRanges(features.count);
      const group = new Group();
      group.name = info.id;
      group.visible = kind === 'drill' || (info as BoardLayerJson).visible;
      const meshes = mergeLayer(info.id, node, ranges);
      group.add(...meshes);
      const layer = {
        id: info.id,
        kind,
        info,
        table: features,
        stateOffset,
        ranges,
        group,
        meshes,
      };
      stateOffset += features.count;
      return layer;
    });
    return new BoardModel(
      board,
      table(board.tables.nets, 'net', 'nets'),
      table(board.tables.components, 'component', 'components'),
      table(board.tables.pins, 'pin', 'pins'),
      layers,
      nodes,
    );
  }

  /** The layer or drill layer with this ID. */
  layer(id: string): LayerModel | undefined {
    return this.#layerById.get(id);
  }

  /** IDs of all elements of a kind. */
  ids(kind: ListableKind): string[] {
    return kind === 'layer' ? this.layers.map((l) => l.id) : [...this.#rows[kind].keys()];
  }

  /** Resolves an ID to its state texels and bounding box, or `null` if it is unknown. */
  resolve(id: string): ResolvedElement | null {
    const kind = idKind(id);
    switch (kind) {
      case 'board':
        return { id, kind, texels: new Uint32Array(0), box: this.bounds.clone() };
      case 'layer': {
        const layer = this.#layerById.get(id);
        if (!layer) return null;
        const texels = Uint32Array.from(
          { length: layer.table.count },
          (_, i) => layer.stateOffset + i,
        );
        const box = new Box3().setFromObject(layer.group);
        return { id, kind, texels, box: box.isEmpty() ? null : box };
      }
      case 'feature': {
        const located = this.#feature(id);
        if (!located) return null;
        const [layer, row] = located;
        return {
          id,
          kind,
          texels: Uint32Array.of(layer.stateOffset + row),
          box: layer.ranges.box(row),
        };
      }
      case 'pin':
      case 'net': {
        const row = this.#rows[kind].get(id);
        if (row === undefined) return null;
        const texels = (kind === 'pin' ? this.#pinTexels : this.#netTexels).get(row);
        return { id, kind, texels, box: this.#featureBox(texels) };
      }
      case 'component': {
        const row = this.#rows.component.get(id);
        if (row === undefined) return null;
        const bounds = this.#componentBounds[row] as Box3;
        const box = bounds.isEmpty()
          ? this.#featureBox(this.#componentTexels.get(row))
          : bounds.clone();
        return { id, kind, texels: Uint32Array.of(this.componentOffset + row), box };
      }
      default:
        return null;
    }
  }

  /** The layer whose feature owns a state texel, or `null` for a component's texel. */
  layerOfTexel(texel: number): LayerModel | null {
    return texel < this.componentOffset ? this.#layerOfTexel(texel)[0] : null;
  }

  /** The ID of the element that owns a state texel. */
  idOfTexel(texel: number): string {
    if (texel >= this.componentOffset) {
      return this.components.get('id', texel - this.componentOffset) as string;
    }
    const [layer, row] = this.#layerOfTexel(texel);
    return featureId(layer.id, layer.table.get('source', row) as number);
  }

  /** Metadata of an element, or `null` if the ID is unknown. */
  describe(id: string): ElementInfo | null {
    const kind = idKind(id);
    switch (kind) {
      case 'board': {
        const { profileVersion, source, tolerance, platingThickness, thickness } = this.board;
        return {
          id,
          kind,
          properties: { profileVersion, source, tolerance, platingThickness, thickness },
        };
      }
      case 'layer': {
        const layer = this.#layerById.get(id);
        if (!layer) return null;
        const { id: _id, node: _node, featureTable: _table, ...properties } = layer.info;
        return { id, kind, properties: { ...properties, kind: layer.kind } };
      }
      case 'feature': {
        const located = this.#feature(id);
        if (!located) return null;
        const [layer, row] = located;
        return {
          id,
          kind,
          properties: { layer: layer.id, ...this.#withIds(layer.table.row(row)) },
        };
      }
      case 'component':
      case 'pin':
      case 'net': {
        const row = this.#rows[kind].get(id);
        if (row === undefined) return null;
        const table = { component: this.components, pin: this.pins, net: this.nets }[kind];
        const { id: _id, node: _node, ...properties } = table.row(row);
        return { id, kind, properties: this.#withIds(properties) };
      }
      default:
        return null;
    }
  }

  /** Whether a state texel belongs to an element (for example a feature to its net). */
  contains(element: ResolvedElement, texel: number): boolean {
    if (element.kind === 'component' && texel < this.componentOffset) {
      const row = (element.texels[0] as number) - this.componentOffset;
      return includes(this.#componentTexels.get(row), texel);
    }
    return includes(element.texels, texel);
  }

  /** Releases the GPU-side resources of the geometry. */
  dispose(): void {
    for (const layer of this.layers) {
      for (const mesh of layer.meshes) mesh.geometry.dispose();
    }
    for (const batch of this.componentBatches) {
      batch.mesh.geometry.dispose();
      batch.mesh.dispose();
    }
  }

  #feature(id: string): readonly [LayerModel, number] | null {
    const parsed = parseFeatureId(id);
    const layer = parsed && this.#layerById.get(parsed.layerId);
    if (!parsed || !layer) return null;
    let rows = this.#sourceRows.get(layer);
    if (!rows) {
      rows = new Map();
      for (let row = 0; row < layer.table.count; row++) {
        rows.set(layer.table.get('source', row) as number, row);
      }
      this.#sourceRows.set(layer, rows);
    }
    const row = rows.get(parsed.source);
    return row === undefined ? null : [layer, row];
  }

  #layerOfTexel(texel: number): readonly [LayerModel, number] {
    let lo = 0;
    let hi = this.layers.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if ((this.layers[mid] as LayerModel).stateOffset <= texel) lo = mid;
      else hi = mid - 1;
    }
    const layer = this.layers[lo] as LayerModel;
    return [layer, texel - layer.stateOffset];
  }

  #featureBox(texels: Uint32Array): Box3 | null {
    const box = new Box3();
    const feature = new Box3();
    for (const texel of texels) {
      const [layer, row] = this.#layerOfTexel(texel);
      if (layer.ranges.box(row, feature)) box.union(feature);
    }
    return box.isEmpty() ? null : box;
  }

  /** Replaces row references (`net`, `pin`, `component`) by the IDs of the rows. */
  #withIds(properties: Record<string, PropertyValue>): Record<string, unknown> {
    const tables: Record<string, PropertyTable> = {
      net: this.nets,
      pin: this.pins,
      component: this.components,
    };
    const result: Record<string, unknown> = { ...properties };
    for (const [property, table] of Object.entries(tables)) {
      const row = properties[property];
      if (typeof row === 'number') result[property] = table.get('id', row);
    }
    return result;
  }

  /** Lists the feature texels that reference each row of a table, via a feature column. */
  #indexFeatures(column: 'net' | 'pin' | 'component', rowCount: number): RowIndex {
    const visit = (emit: (row: number, texel: number) => void) => {
      for (const layer of this.layers) {
        const values = layer.table.column(column);
        if (values?.kind !== 'number') continue;
        for (let row = 0; row < layer.table.count; row++) {
          const target = values.values[row] as number;
          if (target === NONE) continue;
          if (target >= rowCount) {
            throw new Error(`${layer.id} row ${row}: ${column} ${target} is out of range`);
          }
          emit(target, layer.stateOffset + row);
        }
      }
    };
    const offsets = new Uint32Array(rowCount + 1);
    visit((row) => {
      offsets[row + 1] = (offsets[row + 1] as number) + 1;
    });
    for (let row = 0; row < rowCount; row++) {
      offsets[row + 1] = (offsets[row + 1] as number) + (offsets[row] as number);
    }
    const values = new Uint32Array(offsets[rowCount] as number);
    const cursor = offsets.slice(0, rowCount);
    visit((row, texel) => {
      values[cursor[row] as number] = texel;
      cursor[row] = (cursor[row] as number) + 1;
    });
    return new RowIndex(offsets, values);
  }

  /** Groups component meshes by geometry and material into instanced meshes (spec §6.8). */
  #batchComponents(nodes: ReadonlyMap<number, Object3D>): ComponentBatch[] {
    const groups = new Map<string, { source: Mesh; matrices: Matrix4[]; rows: number[] }>();
    for (let row = 0; row < this.components.count; row++) {
      const node = nodes.get(this.components.get('node', row) as number);
      node?.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh || (mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
        const material = mesh.material as Material;
        const key = `${mesh.geometry.uuid}/${material.uuid}`;
        let group = groups.get(key);
        if (!group) {
          group = { source: mesh, matrices: [], rows: [] };
          groups.set(key, group);
        }
        group.matrices.push(mesh.matrixWorld.clone());
        group.rows.push(row);
      });
    }
    const box = new Box3();
    const stored = new Matrix4();
    return [...groups.values()].map(({ source, matrices, rows }) => {
      const geometry = source.geometry;
      geometry.computeBoundingBox();
      const mesh = new InstancedMesh(geometry, source.material, matrices.length);
      matrices.forEach((matrix, i) => {
        mesh.setMatrixAt(i, matrix);
        // Bound what is drawn: the instance matrix as stored, in float32.
        mesh.getMatrixAt(i, stored);
        box.copy(geometry.boundingBox as Box3).applyMatrix4(stored);
        this.#componentBounds[rows[i] as number]?.union(box);
      });
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.componentGroup.add(mesh);
      return { mesh, rows: Uint32Array.from(rows) };
    });
  }
}

/**
 * Merges the primitives of a layer node into one mesh per material, with positions in board
 * coordinates and 32-bit indices, and records the feature ranges (spec §8.1).
 */
function mergeLayer(id: string, node: Object3D, ranges: FeatureRanges): Mesh[] {
  const byMaterial = new Map<Material, Mesh[]>();
  node.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as Material;
    byMaterial.set(material, [...(byMaterial.get(material) ?? []), mesh]);
  });
  const point = new Vector3();
  return [...byMaterial].map(([material, parts]) => {
    let vertexCount = 0;
    let indexCount = 0;
    for (const part of parts) {
      const count = part.geometry.getAttribute('position').count;
      vertexCount += count;
      indexCount += part.geometry.index?.count ?? count;
    }
    const positions = new Float32Array(vertexCount * 3);
    const featureIds = new Float32Array(vertexCount);
    const index = new Uint32Array(indexCount);
    let v = 0;
    let i = 0;
    for (const part of parts) {
      const geometry = part.geometry;
      const position = geometry.getAttribute('position');
      const ids = geometry.getAttribute('_feature_id_0');
      if (!ids) throw new Error(`${id}: a primitive lacks _FEATURE_ID_0 (spec §8.1)`);
      const transform = !part.matrixWorld.equals(IDENTITY);
      for (let k = 0; k < position.count; k++) {
        point.fromBufferAttribute(position, k);
        if (transform) point.applyMatrix4(part.matrixWorld);
        point.toArray(positions, (v + k) * 3);
        featureIds[v + k] = ids.getX(k);
      }
      const source = geometry.index;
      const count = source?.count ?? position.count;
      for (let k = 0; k < count; k++) {
        index[i + k] = v + (source ? source.getX(k) : k);
      }
      ranges.scan(featureIds, positions, index, {
        vertexStart: v,
        vertexEnd: v + position.count,
        indexStart: i,
        indexEnd: i + count,
      });
      v += position.count;
      i += count;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('_feature_id_0', new BufferAttribute(featureIds, 1));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    mesh.name = id;
    return mesh;
  });
}

function rowsById(table: PropertyTable): Map<string, number> {
  const rows = new Map<string, number>();
  for (let row = 0; row < table.count; row++) {
    rows.set(table.get('id', row) as string, row);
  }
  return rows;
}

function includes(sorted: Uint32Array, value: number): boolean {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = sorted[mid] as number;
    if (v === value) return true;
    if (v < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}
