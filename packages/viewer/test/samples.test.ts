import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BoardModel } from '../src/board-model.js';
import { featureId } from '../src/ids.js';
import { loadGltf } from '../src/load.js';

// The converter's expected outputs (spec/samples/hand-written/*/*.glb), so the viewer is
// tested on real assets, including ones that omit empty tables (spec §8.2).
const samples = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../spec/samples/hand-written',
);
const glbs = readdirSync(samples, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map(({ name }) => path.join(samples, name, `${name}.glb`));

describe('converter samples', () => {
  it('finds the samples', () => {
    expect(glbs.length).toBeGreaterThanOrEqual(8);
  });

  it.each(glbs.map((file) => [path.basename(file), file]))('loads %s', async (_, file) => {
    const bytes = readFileSync(file);
    const glb = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const model = await BoardModel.fromGltf(await loadGltf(glb));
    expect(model.layers.length).toBeGreaterThan(0);
    for (const layer of model.layers) {
      expect(model.resolve(layer.id)).not.toBeNull();
      if (layer.kind === 'layer' && layer.table.count > 0) {
        const source = layer.table.get('source', 0) as number;
        expect(model.resolve(featureId(layer.id, source))).not.toBeNull();
      }
    }
    for (const id of model.ids('component')) {
      expect(model.describe(id)?.kind).toBe('component');
    }
    expect(model.board.tables.components === undefined).toBe(model.ids('component').length === 0);
  });

  it('gives layers the colour of their material (spec §6.10)', async () => {
    const bytes = readFileSync(path.join(samples, 'colours', 'colours.glb'));
    const glb = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const model = await BoardModel.fromGltf(await loadGltf(glb));
    const colors = Object.fromEntries(model.layers.map((l) => [l.id, l.color]));
    expect(colors).toMatchObject({
      'layer/SST': '#eed33a',
      'layer/SMT': '#5a1e78',
      'layer/TOP': '#c9a15a',
      'layer/SMB': '#151515',
      'layer/SSB': '#f2f2f2',
    });
  });
});
