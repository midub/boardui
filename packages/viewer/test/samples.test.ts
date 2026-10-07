import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BoardLayerJson } from '../src/board-extension.js';
import { BoardModel } from '../src/board-model.js';
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
        const id = model.idOfTexel(layer.stateOffset);
        expect(model.resolve(id)?.texels).toEqual(Uint32Array.of(layer.stateOffset));
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

describe('panels (spec §6.14)', () => {
  it('lists and describes instances', async () => {
    const model = await load('panel');
    expect(model.ids('instance')).toEqual([
      'inst/strip-1',
      'inst/board-1',
      'inst/board-2',
      'inst/strip-2',
      'inst/board-3',
      'inst/board-4',
      'inst/board-5',
      'inst/board-6',
    ]);
    expect(model.describe('inst/board-6')?.properties).toMatchObject({
      step: 'board',
      parent: null,
      angle: 90,
      side: 'BOTTOM',
    });
    expect(model.describe('inst/board-1')?.properties).toMatchObject({ parent: 'inst/strip-1' });
    expect(model.describe('cmp/board-6/R1')?.properties).toMatchObject({
      refDes: 'R1',
      side: 'BOTTOM',
      instance: 'inst/board-6',
    });
  });

  it('gives features of instances their instance in the ID', async () => {
    const model = await load('panel');
    const top = model.layer('layer/TOP');
    if (!top) throw new Error('layer/TOP');
    // The panel's own fiducials, then the strip's, then the boards'.
    expect(model.idOfTexel(top.stateOffset)).toBe('feat/TOP/0');
    expect(model.idOfTexel(top.stateOffset + 3)).toBe('feat/strip-1/TOP/0');
    expect(model.idOfTexel(top.stateOffset + 4)).toBe('feat/board-1/TOP/0');
    expect(model.resolve('feat/board-1/TOP/0')?.texels).toEqual(
      Uint32Array.of(top.stateOffset + 4),
    );
    expect(model.describe('feat/board-1/TOP/0')?.properties).toMatchObject({
      net: 'net/board-1/GND',
      instance: 'inst/board-1',
    });
    // The board's silkscreen text; the flipped board has it on the bottom.
    expect(model.describe('feat/board-1/TOP_SILK/2')?.properties).toMatchObject({
      text: 'REV A',
      instance: 'inst/board-1',
    });
    expect(model.describe('feat/board-6/BOT_SILK/2')?.properties).toMatchObject({
      text: 'REV A',
      instance: 'inst/board-6',
    });
    expect(model.describe('feat/board-6/@assembly-top/2')?.properties).toMatchObject({
      text: '1',
      component: 'cmp/board-6/C1',
    });
    expect(model.resolve('feat/board-9/TOP/0')).toBeNull();
    expect(model.resolve('feat/TOP/99')).toBeNull();
  });

  it('highlights a net in its own board only', async () => {
    const model = await load('panel');
    const gnd = model.resolve('net/board-2/GND');
    if (!gnd) throw new Error('net/board-2/GND');
    expect(gnd.texels.length).toBeGreaterThan(3);
    for (const texel of gnd.texels) {
      expect(model.idOfTexel(texel)).toMatch(/^feat\/board-2\//);
    }
  });

  it('resolves an instance with the instances placed in it', async () => {
    const model = await load('panel');
    const strip = model.resolve('inst/strip-1');
    if (!strip) throw new Error('inst/strip-1');
    const ids = [...strip.texels].map((t) => model.idOfTexel(t));
    expect(ids).toContain('feat/strip-1/TOP/0');
    expect(ids).toContain('feat/board-2/TOP/0');
    expect(ids).toContain('cmp/board-1/C1');
    expect(ids.some((id) => id.includes('board-3'))).toBe(false);
    expect([...strip.texels]).toEqual([...strip.texels].sort((a, b) => a - b));
    expect(strip.box).not.toBeNull();
    // Board 1 starts at x = 8 mm; its leftmost feature is the silkscreen at x = 8.925 mm.
    expect(strip.box?.min.x).toBeCloseTo(0.008925, 5);
    expect(strip.box?.max.z).toBeLessThan(-0.005);
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
    // A package assembly drawing's Text marking (spec §6.13).
    expect(model.describe('feat/@assembly-top/1')?.properties).toMatchObject({
      kind: 'MARKING',
      text: 'U1',
    });
    const other = await load('fiducials');
    expect(other.describe('feat/TOP/0')?.properties).not.toHaveProperty('text');
  });
});

describe('BOM attributes (spec §8.2–§8.4)', () => {
  it('describes components with their attributes and populate flag', async () => {
    const model = await load('bom-attributes');
    const r1 = model.describe('cmp/R1')?.properties;
    expect(r1).toMatchObject({ refDes: 'R1', part: 'RES-10K', populate: 'YES' });
    expect(r1?.attributes).toEqual({
      Value: '10k',
      LCSC: 'C25744',
      Power: '0.1 W',
      Temperature: '-55..155 CEL',
      Tolerance: '1%',
      Description: 'Resistor, 10 kOhm',
      MPN: 'RC0603FR-0710KL',
      Manufacturer: 'Yageo',
    });
    // In table order: characteristics first.
    expect(Object.keys(r1?.attributes as object)).toEqual([
      'Value',
      'LCSC',
      'Power',
      'Temperature',
      'Tolerance',
      'Description',
      'MPN',
      'Manufacturer',
    ]);
    expect(model.describe('cmp/C1')?.properties).toMatchObject({
      populate: 'NO',
      attributes: {
        Value: '100nF',
        Description: 'from a characteristic: it wins',
        MPN: 'GRM155R71C104KA88D',
      },
    });
    const j1 = model.describe('cmp/J1')?.properties;
    expect(j1).toMatchObject({ populate: null });
    expect(j1).not.toHaveProperty('attributes');
  });

  it('names the exporting software in the board summary', async () => {
    const model = await load('bom-attributes');
    expect(model.describe('board')?.properties.source).toMatchObject({
      software: { name: 'generate.py', revision: '1.0', vendor: 'boardui' },
    });
  });

  it('leaves boards without a BOM as they were', async () => {
    const model = await load('minimal-2layer');
    const r1 = model.describe('cmp/R1')?.properties;
    expect(r1).not.toHaveProperty('attributes');
    expect(r1).not.toHaveProperty('populate');
    expect(model.describe('board')?.properties.source).not.toHaveProperty('software');
  });
});
