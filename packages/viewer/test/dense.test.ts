/**
 * The dense fixture (~110k features): checks that the board stays at one mesh per layer and
 * logs load and picking timings.
 */
import { Ray, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BoardModel } from '../src/board-model.js';
import { loadGltf } from '../src/load.js';
import { Picker } from '../src/picking.js';
import { denseBoardGlb } from './fixture/boards.js';

const GRID = 105;
const timings: Record<string, number> = {};
let model: BoardModel;

const time = async <T>(label: string, work: () => T | Promise<T>): Promise<T> => {
  const start = performance.now();
  const result = await work();
  timings[label] = Math.round(performance.now() - start);
  return result;
};

beforeAll(async () => {
  const glb = await time('generate', () => denseBoardGlb(GRID));
  const gltf = await time('GLTFLoader.parse', () => loadGltf(glb));
  model = await time('BoardModel.fromGltf', () => BoardModel.fromGltf(gltf));
});

describe('dense fixture', () => {
  it('has about 110k features; top copper needs FLOAT feature IDs', () => {
    const features = model.layers.reduce((n, l) => n + l.table.count, 0);
    expect(features).toBe(GRID * GRID * 10 + 3);
    expect(model.layer('layer/F.Cu')?.table.count).toBeGreaterThanOrEqual(65536);
    expect(model.stateCount).toBe(features + GRID * GRID);
  });

  it('merges every layer into one mesh, however many primitives it had', () => {
    for (const layer of model.layers) {
      expect(layer.meshes, layer.id).toHaveLength(1);
    }
    const triangles = model.layers.reduce(
      (n, l) => n + (l.meshes[0]?.geometry.index?.count ?? 0) / 3,
      0,
    );
    timings.layerTriangles = triangles;
  });

  it('draws all components in two instanced meshes (body, pin-1 marker)', () => {
    expect(model.componentBatches.map((b) => b.mesh.count)).toEqual([GRID * GRID, GRID * GRID]);
  });

  it('picks with a BVH', async () => {
    const picker = new Picker(model);
    const mesh = model.layer('layer/F.Cu')?.meshes[0];
    if (!mesh) throw new Error('no F.Cu');
    await time('BVH F.Cu', () => picker.bvh(mesh));
    // Pad 1 of R1 in cell (0, 0) spans x 0.25–0.75 mm at y = 1.75 mm; the body starts at 0.5 mm.
    const ray = new Ray(new Vector3(0.0003, 0.05, -0.00175), new Vector3(0, -1, 0));
    const layers = model.layers.filter((l) => l.id !== 'layer/@soldermask-top');
    const hit = await time('first pick (builds remaining BVHs)', () =>
      picker.pick(ray, undefined, layers),
    );
    expect(hit && model.idOfTexel(hit.texel)).toBe('feat/F.Cu/0');
    const start = performance.now();
    for (let i = 0; i < 100; i++) picker.pick(ray, undefined, layers);
    timings['pick (mean of 100)'] = (performance.now() - start) / 100;
  });

  it('resolves the largest net quickly', async () => {
    const gnd = await time('resolve net/GND', () => model.resolve('net/GND'));
    expect(gnd?.texels.length).toBe(GRID * GRID * 3);
    console.log('dense fixture timings (ms)', timings);
  });
});
