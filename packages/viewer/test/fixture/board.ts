/**
 * Writes a fixture board description as a boardui GLB, following spec/README.md: scene structure
 * (§4), IDs (§5), materials (§7), `EXT_mesh_features` (§8.1), `EXT_structural_metadata` (§8.2),
 * `BOARDUI_board` (§8.3) and component extras (§8.4).
 */
import metadataSchema from '../../../../spec/schema/structural-metadata.json' with { type: 'json' };
import { encodeIdSegment } from '../../src/ids.js';
import { type Part, prism, type Vec2 } from './geometry.js';
import { ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, type GltfPrimitive, GltfWriter } from './gltf.js';

export type FeatureKind =
  | 'PAD'
  | 'VIA'
  | 'TRACE'
  | 'FILL'
  | 'BARREL'
  | 'MARKING'
  | 'SHEET'
  | 'OTHER';
export type MaterialName = 'copper' | 'soldermask' | 'silkscreen' | 'dielectric' | 'body' | 'pin1';

/** One source feature of a layer, in document order. */
export interface FixtureFeature {
  kind: FeatureKind;
  /** `null` for a feature whose region became empty (spec §6.2). */
  part: Part | null;
  net?: string;
  /** Pin as `[refDes, pin number]`. */
  pin?: readonly [string, string];
  component?: string;
}

export interface FixtureLayer {
  name: string;
  role: 'COPPER' | 'DIELECTRIC' | 'SOLDERMASK' | 'SILKSCREEN';
  side: 'TOP' | 'BOTTOM' | 'INTERNAL';
  ipcFunction?: string;
  synthesized: boolean;
  visible: boolean;
  zMin: number;
  zMax: number;
  features: FixtureFeature[];
}

export interface FixtureDrill {
  name: string;
  from: string;
  to: string;
  features: FixtureFeature[];
  /** Store the feature table rows in reverse document order (row order is free, spec §8.2). */
  reverseRows?: boolean;
}

export interface FixturePackage {
  name: string;
  /** Body outline in package coordinates (metres). */
  outline: readonly Vec2[];
  standoff: number;
  height: number;
  pin1?: Vec2;
}

export interface FixtureComponent {
  refDes: string;
  part: string;
  package: string;
  side: 'TOP' | 'BOTTOM';
  mount: 'SMT' | 'THMT';
  /** Location in board coordinates (metres). */
  x: number;
  y: number;
  /** Degrees, counter-clockwise in the top view. */
  rotation: number;
  pins: { number: string; name?: string; net?: string }[];
}

export interface FixtureBoard {
  step: string;
  tolerance: number;
  thickness: number;
  nets: string[];
  layers: FixtureLayer[];
  drills: FixtureDrill[];
  packages: FixturePackage[];
  components: FixtureComponent[];
}

/** Spec §7 material defaults: sRGB base colour, alpha, metallic, roughness. */
const MATERIALS: Record<MaterialName, readonly [string, number, number, number]> = {
  copper: ['#C9A15A', 1, 1, 0.35],
  soldermask: ['#1E6B2E', 0.85, 0, 0.4],
  silkscreen: ['#F2F2F2', 1, 0, 0.8],
  dielectric: ['#C7B98A', 1, 0, 0.9],
  body: ['#2B2B2B', 1, 0, 0.6],
  pin1: ['#E0E0E0', 1, 0, 0.6],
};

const LAYER_MATERIAL: Record<FixtureLayer['role'], MaterialName> = {
  COPPER: 'copper',
  DIELECTRIC: 'dielectric',
  SOLDERMASK: 'soldermask',
  SILKSCREEN: 'silkscreen',
};

const FEATURE_KINDS: Record<FeatureKind, number> = {
  PAD: 0,
  VIA: 1,
  TRACE: 2,
  FILL: 3,
  BARREL: 4,
  MARKING: 5,
  SHEET: 6,
  OTHER: 255,
};

const NONE = 4294967295;
const MAX_PRIMITIVE_VERTICES = 65535;
const PLATING = 25e-6;

type Column = { strings: string[] } | { u32: number[] } | { u8: number[] };

/** Writes the board as a GLB. */
export function writeBoard(board: FixtureBoard): Uint8Array<ArrayBuffer> {
  const w = new GltfWriter();
  const json = w.json;
  json.extensionsUsed = ['BOARDUI_board', 'EXT_mesh_features', 'EXT_structural_metadata'];

  const materials = new Map<MaterialName, number>();
  const material = (name: MaterialName): number => {
    let index = materials.get(name);
    if (index === undefined) {
      const [hex, alpha, metallic, roughness] = MATERIALS[name];
      const entry: Record<string, unknown> = {
        name: `boardui/${name}`,
        pbrMetallicRoughness: {
          baseColorFactor: [...srgbToLinear(hex), alpha],
          metallicFactor: metallic,
          roughnessFactor: roughness,
        },
      };
      if (alpha < 1) entry.alphaMode = 'BLEND';
      index = json.materials.push(entry) - 1;
      materials.set(name, index);
    }
    return index;
  };

  const netRow = new Map(board.nets.map((net, row) => [net, row]));
  const componentRow = new Map(board.components.map((c, row) => [c.refDes, row]));
  const pinRows = new Map<string, number>();
  const pins: { refDes: string; number: string; name: string; net: number }[] = [];
  const pinRow = (refDes: string, number: string): number => {
    const key = `${refDes}\u0000${number}`;
    let row = pinRows.get(key);
    if (row === undefined) {
      const component = board.components.find((c) => c.refDes === refDes);
      const pin = component?.pins.find((p) => p.number === number);
      if (!component || !pin) throw new Error(`Unknown pin ${refDes}.${number}`);
      row = pins.push({
        refDes,
        number,
        name: pin.name ?? '',
        net: pin.net === undefined ? NONE : rowOf(netRow, pin.net),
      });
      row -= 1;
      pinRows.set(key, row);
    }
    return row;
  };

  // nets, components and pins come first, so that `BOARDUI_board.tables` is stable; they are
  // filled in last, once the features have referenced their pins.
  const [netsTable, componentsTable, pinsTable] = [0, 1, 2];
  const tables: Record<string, unknown>[] = [{}, {}, {}];
  const addTable = (
    name: string,
    className: string,
    count: number,
    columns: Record<string, Column>,
    index = tables.length,
  ) => {
    const properties: Record<string, unknown> = {};
    for (const [property, column] of Object.entries(columns)) {
      if ('strings' in column) {
        if (column.strings.every((v) => v === '')) {
          continue; // all noData; glTF forbids empty buffer views
        }
        const encoder = new TextEncoder();
        const encoded = column.strings.map((s) => encoder.encode(s));
        const offsets = new Uint32Array(count + 1);
        encoded.forEach((bytes, i) => {
          offsets[i + 1] = (offsets[i] as number) + bytes.byteLength;
        });
        const values = new Uint8Array(offsets[count] as number);
        encoded.forEach((bytes, i) => {
          values.set(bytes, offsets[i]);
        });
        properties[property] = {
          values: w.bufferView(values),
          stringOffsets: w.bufferView(offsets),
        };
      } else if ('u32' in column) {
        properties[property] = { values: w.bufferView(Uint32Array.from(column.u32)) };
      } else {
        properties[property] = { values: w.bufferView(Uint8Array.from(column.u8)) };
      }
    }
    tables[index] = { name, class: className, count, properties };
    return index;
  };

  // Scene skeleton (§4).
  const root = w.node({ name: 'board', children: [] });
  const layersGroup = w.node({ name: 'layers', children: [] });
  const drillsGroup = w.node({ name: 'drills', children: [] });
  const componentsGroup = w.node({ name: 'components', children: [] });
  json.nodes[root]?.children?.push(layersGroup, drillsGroup, componentsGroup);
  json.scenes[0]?.nodes.push(root);

  const layerEntries: Record<string, unknown>[] = [];
  for (const layer of board.layers) {
    // Synthesized layer names keep their leading `@` unencoded (§5).
    const id = layer.synthesized
      ? `layer/@${encodeIdSegment(layer.name.slice(1))}`
      : `layer/${encodeIdSegment(layer.name)}`;
    const node = w.node({ name: id });
    json.nodes[layersGroup]?.children?.push(node);
    const table = writeFeatures(
      id,
      layer.features,
      false,
      material(LAYER_MATERIAL[layer.role]),
      node,
    );
    const entry: Record<string, unknown> = {
      id,
      name: layer.name,
      role: layer.role,
      side: layer.side,
      zMin: layer.zMin,
      zMax: layer.zMax,
      thicknessSource: 'DEFAULT',
      synthesized: layer.synthesized,
      visible: layer.visible,
      node,
      featureTable: table,
    };
    if (layer.ipcFunction !== undefined) entry.ipcFunction = layer.ipcFunction;
    layerEntries.push(entry);
  }
  const drillEntries = board.drills.map((drill) => {
    const id = `layer/${encodeIdSegment(drill.name)}`;
    const node = w.node({ name: id });
    json.nodes[drillsGroup]?.children?.push(node);
    const table = writeFeatures(
      id,
      drill.features,
      drill.reverseRows ?? false,
      material('copper'),
      node,
    );
    return {
      id,
      name: drill.name,
      from: `layer/${encodeIdSegment(drill.from)}`,
      to: `layer/${encodeIdSegment(drill.to)}`,
      node,
      featureTable: table,
    };
  });

  // Components (§6.8, §8.4): one node each, one shared mesh per package.
  const packageMeshes = new Map<string, number>();
  const componentNodes = board.components.map((component, row) => {
    let mesh = packageMeshes.get(component.package);
    if (mesh === undefined) {
      const pkg = board.packages.find((p) => p.name === component.package);
      if (!pkg) throw new Error(`Unknown package ${component.package}`);
      mesh = writePackageMesh(pkg);
      packageMeshes.set(component.package, mesh);
    }
    const id = `cmp/${encodeIdSegment(component.refDes)}`;
    const half = (component.rotation * Math.PI) / 360;
    // Rotation by θ about +Y; bottom side (mirrored, KiCad's order): R_y(θ) · R_z(180°).
    const rotation =
      component.side === 'TOP'
        ? [0, Math.sin(half), 0, Math.cos(half)]
        : [Math.sin(half), 0, Math.cos(half), 0];
    const node = w.node({
      name: component.refDes,
      mesh,
      translation: [
        component.x,
        (component.side === 'TOP' ? 1 : -1) * (board.thickness / 2),
        -component.y,
      ],
      rotation,
      extras: {
        boardui: {
          id,
          row,
          refDes: component.refDes,
          part: component.part,
          package: component.package,
          side: component.side,
          mount: component.mount,
        },
      },
    });
    json.nodes[componentsGroup]?.children?.push(node);
    return node;
  });

  addTable(
    'nets',
    'net',
    board.nets.length,
    {
      id: { strings: board.nets.map((n) => `net/${encodeIdSegment(n)}`) },
      name: { strings: board.nets },
    },
    netsTable,
  );
  addTable(
    'components',
    'component',
    board.components.length,
    {
      id: { strings: board.components.map((c) => `cmp/${encodeIdSegment(c.refDes)}`) },
      refDes: { strings: board.components.map((c) => c.refDes) },
      part: { strings: board.components.map((c) => c.part) },
      package: { strings: board.components.map((c) => c.package) },
      side: { u8: board.components.map((c) => (c.side === 'TOP' ? 0 : 1)) },
      mount: { u8: board.components.map((c) => (c.mount === 'SMT' ? 0 : 1)) },
      node: { u32: componentNodes },
    },
    componentsTable,
  );
  addTable(
    'pins',
    'pin',
    pins.length,
    {
      id: {
        strings: pins.map((p) => `pin/${encodeIdSegment(p.refDes)}/${encodeIdSegment(p.number)}`),
      },
      number: { strings: pins.map((p) => p.number) },
      name: { strings: pins.map((p) => p.name) },
      component: { u32: pins.map((p) => rowOf(componentRow, p.refDes)) },
      net: { u32: pins.map((p) => p.net) },
    },
    pinsTable,
  );

  json.extensions.EXT_structural_metadata = { schema: metadataSchema, propertyTables: tables };
  json.extensions.BOARDUI_board = {
    profileVersion: '0.2',
    source: {
      format: 'IPC-2581',
      revision: 'C',
      step: board.step,
      functionMode: 'ASSEMBLY',
      sha256: '5f0c3a1e9b7d2c4f6a8e0b1d3c5f7a9e2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1a',
    },
    tolerance: board.tolerance,
    platingThickness: PLATING,
    thickness: board.thickness,
    layers: layerEntries,
    drills: drillEntries,
    tables: { nets: netsTable, components: componentsTable, pins: pinsTable },
  };
  return w.glb();

  /** Writes a layer's mesh and feature table; returns the table index. */
  function writeFeatures(
    layerId: string,
    features: FixtureFeature[],
    reverseRows: boolean,
    materialIndex: number,
    node: number,
  ): number {
    const rows = reverseRows ? [...features].reverse() : features;
    const source = (row: number) => (reverseRows ? features.length - 1 - row : row);
    const float = rows.length >= 65536;
    const primitives: GltfPrimitive[] = [];
    let positions: number[] = [];
    let indices: number[] = [];
    let ids: number[] = [];
    let featureCount = 0;
    const flush = () => {
      if (!positions.length) return;
      const vertices = positions.length / 3;
      primitives.push({
        attributes: {
          POSITION: w.accessor(Float32Array.from(positions), 'VEC3', ARRAY_BUFFER, {
            minMax: true,
          }),
          _FEATURE_ID_0: float
            ? w.accessor(Float32Array.from(ids), 'SCALAR', ARRAY_BUFFER)
            : w.accessor(Uint16Array.from(ids), 'SCALAR', ARRAY_BUFFER, { byteStride: 4 }),
        },
        indices: w.accessor(
          vertices > 65535 ? Uint32Array.from(indices) : Uint16Array.from(indices),
          'SCALAR',
          ELEMENT_ARRAY_BUFFER,
        ),
        material: materialIndex,
        mode: 4,
        extensions: {
          EXT_mesh_features: {
            featureIds: [{ featureCount, attribute: 0, propertyTable: tables.length }],
          },
        },
      });
      positions = [];
      indices = [];
      ids = [];
      featureCount = 0;
    };
    rows.forEach((feature, row) => {
      const part = feature.part;
      if (!part?.indices.length) return;
      const vertices = part.positions.length / 3;
      if (positions.length / 3 + vertices > MAX_PRIMITIVE_VERTICES) flush();
      const base = positions.length / 3;
      for (const value of part.positions) positions.push(value);
      for (const i of part.indices) indices.push(base + i);
      for (let i = 0; i < vertices; i++) ids.push(row);
      featureCount++;
    });
    flush();
    json.nodes[node] = { name: layerId, mesh: json.meshes.length };
    json.meshes.push({ name: layerId, primitives });
    const ref = (map: Map<string, number>, key: string | undefined) =>
      key === undefined ? NONE : rowOf(map, key);
    return addTable(layerId, 'feature', rows.length, {
      kind: { u8: rows.map((f) => FEATURE_KINDS[f.kind]) },
      source: { u32: rows.map((_, row) => source(row)) },
      net: { u32: rows.map((f) => ref(netRow, f.net)) },
      pin: { u32: rows.map((f) => (f.pin ? pinRow(f.pin[0], f.pin[1]) : NONE)) },
      component: { u32: rows.map((f) => ref(componentRow, f.component ?? f.pin?.[0])) },
    });
  }

  function writePackageMesh(pkg: FixturePackage): number {
    const body = packagePrism(pkg.outline, pkg.standoff, pkg.height);
    const parts: [Part, MaterialName][] = [[body, 'body']];
    if (pkg.pin1) {
      const [x, y] = pkg.pin1;
      const s = 0.15e-3;
      const marker: Vec2[] = [
        [x - s, y - s],
        [x + s, y - s],
        [x + s, y + s],
        [x - s, y + s],
      ];
      parts.push([packagePrism(marker, pkg.height, pkg.height + 0.02e-3), 'pin1']);
    }
    const primitives = parts.map(([part, name]): GltfPrimitive => {
      return {
        attributes: {
          POSITION: w.accessor(Float32Array.from(part.positions), 'VEC3', ARRAY_BUFFER, {
            minMax: true,
          }),
        },
        indices: w.accessor(Uint16Array.from(part.indices), 'SCALAR', ELEMENT_ARRAY_BUFFER),
        material: material(name),
        mode: 4,
      };
    });
    return json.meshes.push({ name: pkg.name, primitives }) - 1;
  }
}

/**
 * A package body or marker. Package coordinates are the component node's local frame: the same
 * mapping as board coordinates, with the mounting plane at height 0 (spec §6.8, §6.9).
 */
function packagePrism(outline: readonly Vec2[], zMin: number, zMax: number): Part {
  return prism({ outer: outline, holes: [] }, zMin, zMax);
}

function rowOf(map: Map<string, number>, key: string): number {
  const row = map.get(key);
  if (row === undefined) throw new Error(`Unknown reference ${key}`);
  return row;
}

function srgbToLinear(hex: string): number[] {
  return [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    const linear = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return Math.round(linear * 1e4) / 1e4;
  });
}
