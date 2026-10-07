import { createRequire } from 'node:module';
import type { MeshStandardMaterial } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { STEP_TESSELLATION, stepPart } from '../src/step.js';
import { type Occt, type OcctResult, readStep } from '../src/step-mesh.js';
import { boxStep } from './fixture/step.js';

describe('readStep', () => {
  it('groups triangles by face colour and turns Z-up millimetres into Y-up metres', () => {
    const result: OcctResult = {
      success: true,
      meshes: [
        {
          color: [0.5, 0.5, 0.5],
          brep_faces: [
            { first: 0, last: 0, color: [1, 0, 0] },
            { first: 1, last: 1, color: null },
          ],
          attributes: {
            position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
            normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0] },
          },
          index: { array: [0, 1, 2, 0, 1, 3] },
        },
      ],
    };
    const occt: Occt = { ReadStepFile: () => result };
    const [red, grey] = readStep(occt, new Uint8Array(), STEP_TESSELLATION);
    expect(red?.color).toEqual([1, 0, 0]);
    expect([...(red?.index ?? [])]).toEqual([0, 1, 2]);
    const round = (values: ArrayLike<number> = []) =>
      Array.from(values, (v) => Math.round(v * 1e6) / 1e6 + 0);
    expect(round(red?.positions)).toEqual([0, 0, 0, 0.001, 0, 0, 0, 0, -0.001]);
    expect(round(red?.normals).slice(0, 3)).toEqual([0, 1, 0]);
    // The second face falls back to the mesh's colour and has its own vertices.
    expect(grey?.color).toEqual([0.5, 0.5, 0.5]);
    expect([...(grey?.index ?? [])]).toEqual([0, 1, 2]);
    expect(grey?.positions[7]).toBeCloseTo(0.001, 9);
  });

  it('fails on a file occt can’t read', () => {
    const occt: Occt = { ReadStepFile: () => ({ success: false, meshes: [] }) };
    expect(() => readStep(occt, new Uint8Array(), STEP_TESSELLATION)).toThrow(/STEP/);
  });
});

describe('readStep with OpenCascade', () => {
  let occt: Occt;
  beforeAll(async () => {
    const factory = createRequire(import.meta.url)('occt-import-js') as () => Promise<Occt>;
    occt = await factory();
  });

  it('reads a box with face colours', () => {
    const step = boxStep({
      min: [-0.5, -0.25, 0],
      max: [0.5, 0.25, 0.35],
      color: [0.2, 0.2, 0.2],
      topColor: [0.8, 0.7, 0.1],
    });
    const meshes = readStep(occt, new TextEncoder().encode(step), STEP_TESSELLATION);
    // OpenCascade reads the file's colours as sRGB and reports them linear.
    const byColor = Object.fromEntries(
      meshes.map((m) => [(stepPart(m).material as MeshStandardMaterial).color.getHexString(), m]),
    );
    expect(Object.keys(byColor).sort()).toEqual(['333333', 'ccb31a']);
    const sides = byColor['333333'];
    const top = byColor.ccb31a;
    expect((sides?.index.length ?? 0) / 3).toBe(10);
    expect((top?.index.length ?? 0) / 3).toBe(2);
    // The top face (z = 0.35 mm) is at y = 0.35 mm, and KiCad's −y is +z.
    for (let i = 1; i < (top?.positions.length ?? 0); i += 3)
      expect(top?.positions[i]).toBeCloseTo(0.00035, 9);
    const part = stepPart(sides as NonNullable<typeof sides>);
    part.geometry.computeBoundingBox();
    const box = part.geometry.boundingBox;
    expect(box?.min.toArray().map((v) => +v.toFixed(6))).toEqual([-0.0005, 0, -0.00025]);
    expect(box?.max.toArray().map((v) => +v.toFixed(6))).toEqual([0.0005, 0.00035, 0.00025]);
    expect((part.material as MeshStandardMaterial).color.getHexString()).toBe('333333');
  });
});
