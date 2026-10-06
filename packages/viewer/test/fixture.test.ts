/**
 * The fixtures must be conformant boardui assets (spec §2). The Khronos validator checks glTF
 * itself; it doesn't know EXT_mesh_features or EXT_structural_metadata, so the profile rules
 * on top are checked here.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import { validateBytes } from 'gltf-validator';
import { beforeAll, describe, expect, it } from 'vitest';
import boardSchema from '../../../spec/schema/BOARDUI_board.schema.json' with { type: 'json' };
import extrasSchema from '../../../spec/schema/component-extras.schema.json' with { type: 'json' };
import metadataSchema from '../../../spec/schema/structural-metadata.json' with { type: 'json' };
import type { BoardExtensionJson } from '../src/board-extension.js';
import { BoardModel } from '../src/board-model.js';
import { loadGltf } from '../src/load.js';
import { denseBoardGlb, smallBoardGlb } from './fixture/boards.js';

interface Json {
  extensionsUsed: string[];
  extensionsRequired?: string[];
  extensions: {
    BOARDUI_board: BoardExtensionJson;
    EXT_structural_metadata: { schema: unknown; propertyTables: { count: number }[] };
  };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: {
    name: string;
    children?: number[];
    mesh?: number;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
    extras?: { boardui?: Record<string, unknown> };
  }[];
  meshes: {
    primitives: {
      attributes: Record<string, number>;
      extensions?: {
        EXT_mesh_features?: {
          featureIds: { attribute: number; propertyTable: number; featureCount: number }[];
        };
      };
    }[];
  }[];
  materials: { name: string }[];
  accessors: { bufferView: number; componentType: number }[];
  bufferViews: { byteStride?: number }[];
}

function glbJson(glb: Uint8Array): Json {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
}

describe.each([
  ['small', smallBoardGlb],
  ['dense (4 × 4)', () => denseBoardGlb(4)],
  ['realistic dense (4 × 4)', () => denseBoardGlb(4, { realistic: true })],
])('%s fixture', (_, generate) => {
  const glb = generate();
  const json = glbJson(glb);
  const board = json.extensions.BOARDUI_board;
  let model: BoardModel;

  beforeAll(async () => {
    model = await BoardModel.fromGltf(await loadGltf(glb));
  });

  it('passes the Khronos glTF validator', async () => {
    const report = await validateBytes(glb, { format: 'glb', maxIssues: 50 });
    const messages = report.issues.messages
      .filter((m) => m.severity <= 1)
      .map((m) => `${m.code} ${m.pointer ?? ''}: ${m.message}`);
    expect(messages).toEqual([]);
  });

  it('declares the extensions as used but not required (§2)', () => {
    expect(json.extensionsUsed).toEqual(
      expect.arrayContaining(['BOARDUI_board', 'EXT_mesh_features', 'EXT_structural_metadata']),
    );
    expect(json.extensionsRequired).toBeUndefined();
  });

  it('has the scene structure of §4, with layer nodes named by ID', () => {
    const root = json.nodes[json.scenes[json.scene]?.nodes[0] as number];
    expect(json.scenes[json.scene]?.nodes).toHaveLength(1);
    expect(root?.name).toBe('board');
    expect(root?.children?.map((i) => json.nodes[i]?.name)).toEqual([
      'layers',
      'drills',
      'components',
    ]);
    for (const layer of [...board.layers, ...board.drills]) {
      const node = json.nodes[layer.node];
      expect(node?.name).toBe(layer.id);
      expect(node).not.toHaveProperty('translation');
      expect(node).not.toHaveProperty('rotation');
      expect(node).not.toHaveProperty('scale');
      expect(node).not.toHaveProperty('matrix');
    }
  });

  it('matches the BOARDUI_board schema (§8.3)', () => {
    const validate = new Ajv2020({ allErrors: true }).compile(boardSchema);
    expect(validate(board), JSON.stringify(validate.errors)).toBe(true);
  });

  it('embeds the boardui metadata schema (§8.2)', () => {
    expect(json.extensions.EXT_structural_metadata.schema).toEqual(metadataSchema);
  });

  it('gives every layer primitive one feature ID set of its layer table (§8.1)', () => {
    for (const layer of [...board.layers, ...board.drills]) {
      const mesh = json.meshes[json.nodes[layer.node]?.mesh as number];
      const rows =
        json.extensions.EXT_structural_metadata.propertyTables[layer.featureTable ?? -1]?.count;
      let features = 0;
      for (const primitive of mesh?.primitives ?? []) {
        const ids = primitive.extensions?.EXT_mesh_features?.featureIds;
        expect(ids).toHaveLength(1);
        expect(ids?.[0]).toMatchObject({ attribute: 0, propertyTable: layer.featureTable });
        features += ids?.[0]?.featureCount ?? 0;
        const accessor = json.accessors[primitive.attributes._FEATURE_ID_0 as number];
        if ((rows as number) < 65536) {
          // UNSIGNED_SHORT, padded to the 4-byte vertex attribute alignment of glTF.
          expect(accessor?.componentType).toBe(5123);
          expect(json.bufferViews[accessor?.bufferView as number]?.byteStride).toBe(4);
        } else {
          expect(accessor?.componentType).toBe(5126);
        }
      }
      // Features never span primitives, so the counts add up to the features with geometry.
      const ranges = model.layer(layer.id)?.ranges;
      const withGeometry = ranges?.vertexCount.filter((n) => n > 0).length;
      expect(features, layer.id).toBe(withGeometry);
    }
  });

  it('uses each material name once (§7)', () => {
    const names = json.materials.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.startsWith('boardui/'))).toBe(true);
  });

  it('gives component nodes extras that match the schema and the table (§8.4)', () => {
    const validate = new Ajv2020({ allErrors: true }).compile(extrasSchema);
    const components = json.nodes.find((n) => n.name === 'components');
    expect(components?.children?.length).toBe(model.components.count);
    for (const index of components?.children ?? []) {
      const node = json.nodes[index];
      expect(validate(node?.extras), JSON.stringify(validate.errors)).toBe(true);
      const { id, row, ...rest } = node?.extras?.boardui ?? {};
      expect(model.components.get('id', row as number)).toBe(id);
      expect(model.components.get('node', row as number)).toBe(index);
      expect(model.describe(id as string)?.properties).toEqual(rest);
    }
  });

  it('shares one mesh among components of a package (§6.8)', () => {
    const meshByPackage = new Map<unknown, number>();
    for (const node of json.nodes.filter((n) => n.extras?.boardui)) {
      const pkg = node.extras?.boardui?.package;
      expect(meshByPackage.get(pkg) ?? node.mesh).toBe(node.mesh);
      meshByPackage.set(pkg, node.mesh as number);
    }
  });
});
