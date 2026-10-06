import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BoardLayerJson } from '../src/board-extension.js';
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

const load = async (name: string) => {
  const bytes = readFileSync(path.join(samples, name, `${name}.glb`));
  const glb = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return BoardModel.fromGltf(await loadGltf(glb));
};

describe('fiducials', () => {
  it('describes fiducials with their type (spec §8.2)', async () => {
    const model = await load('fiducials');
    expect(model.describe('feat/TOP/0')?.properties).toMatchObject({
      kind: 'FIDUCIAL',
      fiducial: 'GLOBAL',
    });
    expect(model.describe('feat/TOP/3')?.properties).toMatchObject({ fiducial: 'BAD_BOARD' });
    expect(model.describe('feat/TOP/4')?.properties).toMatchObject({ fiducial: 'GOOD_PANEL' });
    const other = await load('hatch-fill');
    expect(other.describe('feat/TOP/0')?.properties).not.toHaveProperty('fiducial');
  });
});

describe('optional layers', () => {
  const roles = (model: BoardModel) =>
    Object.fromEntries(
      model.layers
        .filter((l) => 'role' in l.info)
        .map((l) => [l.id, [(l.info as BoardLayerJson).role, l.group.visible]]),
    );

  it('starts paste and drawing layers hidden (spec §8.3)', async () => {
    expect(roles(await load('paste-layer'))).toMatchObject({
      'layer/TOP_PASTE': ['PASTE', false],
      'layer/TOP_SILK': ['SILKSCREEN', true],
      'layer/TOP': ['COPPER', true],
      'layer/BOT_PASTE': ['PASTE', false],
    });
    expect(roles(await load('drawing-layers'))).toMatchObject({
      'layer/NOTES': ['DOCUMENTATION', false],
      'layer/CRT_TOP': ['COURTYARD', false],
      'layer/FAB_TOP': ['ASSEMBLY', false],
      'layer/FAB_BOT': ['ASSEMBLY', false],
    });
    const model = await load('assembly-drawing');
    expect(roles(model)).toMatchObject({ 'layer/@assembly-top': ['ASSEMBLY', false] });
    const assembly = model.layer('layer/@assembly-top');
    expect(assembly?.color).toBe('#7db2c4');
    // Toggling is the group's visibility, as for any layer.
    if (assembly) assembly.group.visible = true;
    expect(roles(model)['layer/@assembly-top']).toEqual(['ASSEMBLY', true]);
  });

  it('emphasizes a component with its drawings (spec §6.13)', async () => {
    const model = await load('assembly-drawing');
    const d1 = model.resolve('cmp/D1');
    if (!d1) throw new Error('cmp/D1');
    const emphasis = [...model.emphasis(d1)];
    expect(emphasis).toContain(d1.texels[0]);
    expect(emphasis.map((t) => model.idOfTexel(t)).sort()).toEqual([
      'cmp/D1',
      'feat/@assembly-top/0',
      'feat/@assembly-top/1',
      'feat/@assembly-top/2',
    ]);
    // Boards without drawing layers: the component alone.
    const other = await load('minimal-2layer');
    const r1 = other.resolve('cmp/R1');
    if (!r1) throw new Error('cmp/R1');
    expect([...other.emphasis(r1)]).toEqual([...r1.texels]);
  });
});

describe('text', () => {
  it('describes features with the strings of their text (spec §8.2)', async () => {
    const model = await load('text');
    expect(model.describe('feat/SILK/0')?.properties).toMatchObject({
      kind: 'MARKING',
      text: 'BOARD Ø2',
    });
    expect(model.describe('feat/SILK/2')?.properties).toMatchObject({
      text: 'Ærøskøbing µ±0.1° Ω',
    });
    expect(model.describe('feat/TOP/0')?.properties).toMatchObject({ kind: 'TRACE', text: 'GND' });
    expect(model.describe('feat/TOP/1')?.properties).toMatchObject({ kind: 'FILL', text: null });
    const other = await load('fiducials');
    expect(other.describe('feat/TOP/0')?.properties).not.toHaveProperty('text');
  });
});
