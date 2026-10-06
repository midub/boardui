// Node smoke test of the WASM converter (docs/architecture.md, "Testing and CI"): converts
// hand-written samples with the module that `pnpm build` produced and validates the output.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { convertBytes, stepFraction, validateBytes } from '../src/core.js';
import type { ConvertProgress } from '../src/types.js';
import * as wasm from '../wasm/boardui_wasm.js';

const samples = new URL('../../../spec/samples/hand-written/', import.meta.url);
const read = (path: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(path, samples))));

beforeAll(() => {
  wasm.initSync({ module: readFileSync(new URL('../wasm/boardui_wasm_bg.wasm', import.meta.url)) });
});

describe('WASM converter', () => {
  it('converts the minimal sample, reporting every step', async () => {
    const events: ConvertProgress[] = [];
    const result = await convertBytes(wasm, read('minimal-2layer/minimal-2layer.xml'), {}, (p) =>
      events.push(p),
    );
    expect(new TextDecoder().decode(result.glb.subarray(0, 4))).toBe('glTF');
    expect(result.stats.glbBytes).toBe(result.glb.byteLength);
    expect(result.stats.features).toBeGreaterThan(0);
    expect(result.stats.pinsMisplaced).toBe(0);
    expect(events.map((e) => e.step)).toEqual(wasm.steps());
    expect(events.map((e) => e.index)).toEqual(wasm.steps().map((_, i) => i));
    expect(events[0]?.fraction).toBe(0);
    expect(result.timings.map((t) => t.step)).toEqual(wasm.steps());
    expect(validateBytes(wasm, result.glb)).toMatchObject({ valid: true, errors: 0 });
  });

  it('writes the same GLB as the native converter', async () => {
    const result = await convertBytes(wasm, read('slots/slots.xml'));
    const expected = read('slots/slots.glb');
    // Only `asset.generator` differs ("boardui x (wasm)"), so compare the JSON without it.
    const json = (glb: Uint8Array) => {
      const length = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
      const parsed = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
      delete parsed.asset.generator;
      return parsed;
    };
    expect(json(result.glb)).toEqual(json(expected));
  });

  it('applies options and user models', async () => {
    const mapping = new TextDecoder().decode(read('user-models/models.json'));
    const model = read('user-models/r0603.gltf');
    const result = await convertBytes(wasm, read('user-models/user-models.xml'), {
      tolerance: 20e-6,
      models: { mapping, files: [{ path: 'models/r0603.gltf', data: model }] },
    });
    const length = new DataView(result.glb.buffer, result.glb.byteOffset).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(result.glb.subarray(20, 20 + length)));
    expect(json.extensions.BOARDUI_board.tolerance).toBe(20e-6);
    expect(json.meshes.some((m: { name?: string }) => m.name?.includes('r0603'))).toBe(true);
  });

  it('rejects broken input and missing model files', async () => {
    await expect(convertBytes(wasm, new TextEncoder().encode('<IPC-2581'))).rejects.toThrow(
      /IPC-2581/,
    );
    await expect(
      convertBytes(wasm, read('user-models/user-models.xml'), {
        models: { mapping: new TextDecoder().decode(read('user-models/models.json')), files: [] },
      }),
    ).rejects.toThrow(/r0603/);
  });

  it('reports invalid assets', () => {
    expect(validateBytes(wasm, new Uint8Array([1, 2, 3]))).toMatchObject({ valid: false });
  });

  it('estimates progress fractions', () => {
    const steps = wasm.steps();
    const fractions = steps.map((_, i) => stepFraction(steps, i));
    expect(fractions[0]).toBe(0);
    expect(fractions.every((f, i) => i === 0 || f > (fractions[i - 1] ?? 0))).toBe(true);
    expect(stepFraction(steps, steps.length)).toBeCloseTo(1);
  });
});
