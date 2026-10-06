import { Ray, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BoardModel } from '../src/board-model.js';
import { loadGltf } from '../src/load.js';
import { Picker } from '../src/picking.js';
import { smallBoardGlb } from './fixture/boards.js';

let model: BoardModel;
let picker: Picker;

beforeAll(async () => {
  model = await BoardModel.fromGltf(await loadGltf(smallBoardGlb()));
  picker = new Picker(model);
});

/** A ray straight down onto IPC-2581 point (x, y), in millimetres. */
const down = (x: number, y: number) =>
  new Ray(new Vector3(x / 1000, 0.05, -y / 1000), new Vector3(0, -1, 0));
const up = (x: number, y: number) =>
  new Ray(new Vector3(x / 1000, -0.05, -y / 1000), new Vector3(0, 1, 0));
const idAt = (ray: Ray, skip?: (texel: number) => boolean, through: string[] = []) => {
  const layers = model.layers.filter((l) => !through.includes(l.id));
  const hit = picker.pick(ray, skip, layers);
  return hit && model.idOfTexel(hit.texel);
};

describe('Picker', () => {
  it('finds the soldermask over bare board, and copper under it when looking through', () => {
    expect(idAt(down(8.75, 18))).toBe('feat/@soldermask-top/0');
    expect(idAt(down(8.75, 18), undefined, ['layer/@soldermask-top'])).toBe('feat/F.Cu/15');
  });

  it('finds pads in mask openings and components above them', () => {
    expect(idAt(down(21.3, 19.905))).toBe('feat/F.Cu/4'); // U1 pad 1
    expect(idAt(down(24, 18))).toBe('cmp/U1');
    expect(idAt(up(20, 8))).toBe('cmp/C1'); // bottom side, from below
  });

  it('reports the hit point and distance', () => {
    const hit = picker.pick(down(21.3, 19.905));
    expect(hit?.point.y).toBeCloseTo(0.0008, 7);
    expect(hit?.distance).toBeCloseTo(0.05 - 0.0008, 7);
  });

  it('looks through skipped texels and hidden layers', () => {
    const pad = model.resolve('feat/F.Cu/4')?.texels[0];
    const skipPad = (texel: number) => texel === pad;
    expect(idAt(down(21.3, 19.905), skipPad)).toBe('feat/@soldermask-bottom/0');
    const mask = model.layer('layer/@soldermask-bottom');
    if (!mask) throw new Error('no mask');
    mask.group.visible = false;
    try {
      expect(idAt(down(21.3, 19.905), skipPad)).toBeNull();
    } finally {
      mask.group.visible = true;
    }
  });

  it('builds one BVH per layer mesh and reuses it', () => {
    const mesh = model.layer('layer/F.Cu')?.meshes[0];
    if (!mesh) throw new Error('no mesh');
    expect(picker.bvh(mesh)).toBe(picker.bvh(mesh));
  });
});
