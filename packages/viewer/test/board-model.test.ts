import { type Material, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BoardModel } from '../src/board-model.js';
import { loadGltf } from '../src/load.js';
import { smallBoardGlb } from './fixture/boards.js';

let model: BoardModel;

beforeAll(async () => {
  model = await BoardModel.fromGltf(await loadGltf(smallBoardGlb()));
});

const layer = (id: string) => {
  const found = model.layer(id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};

describe('metadata', () => {
  it('reads the nets, components and pins tables', () => {
    expect(model.ids('net')).toEqual(['net/GND', 'net/VCC', 'net/%2FSDA', 'net/Net-(R1-Pad2)']);
    expect(model.ids('component')).toEqual(['cmp/R1', 'cmp/R2', 'cmp/U1', 'cmp/C1', 'cmp/J1']);
    expect(model.ids('pin')).toContain('pin/U1/8');
    expect(model.board.profileVersion).toBe('0.1');
  });

  it('describes components, pins and nets, with references as IDs', () => {
    expect(model.describe('cmp/C1')).toEqual({
      id: 'cmp/C1',
      kind: 'component',
      properties: {
        refDes: 'C1',
        part: 'GRM155R71C104KA88',
        package: 'C0402',
        side: 'BOTTOM',
        mount: 'SMT',
      },
    });
    expect(model.describe('pin/U1/2')?.properties).toEqual({
      number: '2',
      name: 'SDA',
      component: 'cmp/U1',
      net: 'net/%2FSDA',
    });
    // noData values come back as null: an unconnected, unnamed pin.
    expect(model.describe('pin/U1/3')?.properties).toMatchObject({ name: null, net: null });
    expect(model.describe('net/%2FSDA')?.properties).toEqual({ name: '/SDA' });
  });

  it('describes features with their layer and derived references', () => {
    expect(model.describe('feat/F.Cu/0')).toEqual({
      id: 'feat/F.Cu/0',
      kind: 'feature',
      properties: {
        layer: 'layer/F.Cu',
        kind: 'PAD',
        source: 0,
        net: 'net/VCC',
        pin: 'pin/R1/1',
        component: 'cmp/R1',
      },
    });
    expect(model.describe('feat/In2%20Power/0')?.properties).toMatchObject({
      kind: 'FILL',
      net: 'net/VCC',
      pin: null,
    });
  });

  it('describes layers and the board', () => {
    expect(model.describe('layer/@core')?.properties).toMatchObject({
      name: '@core',
      role: 'DIELECTRIC',
      synthesized: true,
      visible: true,
      kind: 'layer',
    });
    expect(model.describe('board')?.properties).toMatchObject({ thickness: 0.0016 });
  });
});

describe('layers', () => {
  it('follow BOARDUI_board order, with drills last', () => {
    expect(model.layers.map((l) => l.id)).toEqual([
      'layer/F.SilkS',
      'layer/@soldermask-top',
      'layer/F.Cu',
      'layer/@prepreg-1',
      'layer/In1.Cu',
      'layer/@core',
      'layer/In2%20Power',
      'layer/@prepreg-2',
      'layer/B.Cu',
      'layer/@soldermask-bottom',
      'layer/B.SilkS',
      'layer/DRILL_1-4',
    ]);
  });

  it('default to the suggested visibility; drill layers are shown', () => {
    const visible = model.layers.filter((l) => l.group.visible).map((l) => l.id);
    expect(visible).toEqual([
      'layer/F.SilkS',
      'layer/@soldermask-top',
      'layer/F.Cu',
      'layer/@prepreg-1',
      'layer/@core',
      'layer/@prepreg-2',
      'layer/B.Cu',
      'layer/@soldermask-bottom',
      'layer/B.SilkS',
      'layer/DRILL_1-4',
    ]);
  });

  it('merge their primitives into one mesh per material', () => {
    for (const l of model.layers) {
      expect(l.meshes).toHaveLength(1);
      expect(l.meshes[0]?.geometry.index?.array).toBeInstanceOf(Uint32Array);
    }
  });

  it('get consecutive state texels, followed by the components', () => {
    let offset = 0;
    for (const l of model.layers) {
      expect(l.stateOffset).toBe(offset);
      offset += l.table.count;
    }
    expect(model.componentOffset).toBe(offset);
    expect(model.stateCount).toBe(offset + 5);
  });
});

describe('feature ranges', () => {
  it('cover every vertex and index of a layer, in order', () => {
    for (const l of model.layers) {
      const geometry = l.meshes[0]?.geometry;
      const { vertexStart, vertexCount, indexStart, indexCount } = l.ranges;
      let vertices = 0;
      let indices = 0;
      for (let f = 0; f < l.ranges.count; f++) {
        if (!vertexCount[f]) continue;
        expect(vertexStart[f]).toBe(vertices);
        expect(indexStart[f]).toBe(indices);
        vertices += vertexCount[f] as number;
        indices += indexCount[f] as number;
      }
      expect(vertices).toBe(geometry?.getAttribute('position').count);
      expect(indices).toBe(geometry?.index?.count);
    }
  });

  it('give each feature its bounding box', () => {
    const box = layer('layer/F.Cu').ranges.box(0);
    // R1 pad 1: 0.8 × 0.9 mm centred on (7.25, 22) mm, on top copper.
    expect(box?.min.x).toBeCloseTo(0.00685, 6);
    expect(box?.max.x).toBeCloseTo(0.00765, 6);
    expect(box?.min.z).toBeCloseTo(-0.02245, 6);
    expect(box?.max.z).toBeCloseTo(-0.02155, 6);
    expect(box?.min.y).toBeCloseTo(0.000765, 7);
    expect(box?.max.y).toBeCloseTo(0.0008, 7);
  });

  it('leave features without geometry empty', () => {
    const fcu = layer('layer/F.Cu');
    expect(fcu.table.get('kind', 19)).toBe('TRACE');
    expect(fcu.ranges.vertexCount[19]).toBe(0);
    expect(fcu.ranges.box(19)).toBeNull();
    expect(model.resolve('feat/F.Cu/19')?.box).toBeNull();
  });
});

describe('ID resolution', () => {
  it('resolves features to one texel and their box', () => {
    const fcu = layer('layer/F.Cu');
    const resolved = model.resolve('feat/F.Cu/4');
    expect(resolved?.texels).toEqual(Uint32Array.of(fcu.stateOffset + 4));
    expect(resolved?.box).toEqual(fcu.ranges.box(4));
  });

  it('maps feature sources to rows when the rows are reordered', () => {
    const drill = layer('layer/DRILL_1-4');
    expect(drill.table.get('source', 0)).toBe(2);
    expect(model.resolve('feat/DRILL_1-4/0')?.texels).toEqual(
      Uint32Array.of(drill.stateOffset + 2),
    );
    expect(model.idOfTexel(drill.stateOffset + 2)).toBe('feat/DRILL_1-4/0');
  });

  it('resolves a net to its features and barrels on every layer', () => {
    const net = model.resolve('net/GND');
    const ids = [...(net?.texels ?? [])].map((t) => model.idOfTexel(t));
    expect(ids).toEqual(
      expect.arrayContaining([
        'feat/F.Cu/3', // R2 pad 2
        'feat/F.Cu/14', // via land
        'feat/In1.Cu/0', // GND plane
        'feat/B.Cu/1', // C1 pad 2
        'feat/DRILL_1-4/2', // via barrel
      ]),
    );
    expect(ids.every((id) => model.describe(id)?.properties.net === 'net/GND')).toBe(true);
    expect(net?.box?.isEmpty()).toBe(false);
  });

  it('resolves a pin to its pads on both sides', () => {
    const pin = model.resolve('pin/J1/1');
    expect([...(pin?.texels ?? [])].map((t) => model.idOfTexel(t))).toEqual([
      'feat/F.Cu/12',
      'feat/B.Cu/2',
    ]);
    expect(pin?.box?.min.y).toBeLessThan(0);
    expect(pin?.box?.max.y).toBeGreaterThan(0);
  });

  it('resolves components to their texel and the box of their node', () => {
    const u1 = model.resolve('cmp/U1');
    expect(u1?.texels).toEqual(Uint32Array.of(model.componentOffset + 2));
    expect(u1?.box?.getCenter(new Vector3()).x).toBeCloseTo(0.024, 4);
    expect(u1?.box?.min.y).toBeCloseTo(0.0008 + 0.0001, 6); // standoff above the mounting plane
    expect(u1?.box?.max.y).toBeCloseTo(0.0008 + 0.00175 + 0.00002, 6); // up to the pin-1 marker
    const c1 = model.resolve('cmp/C1');
    expect(c1?.box?.max.y).toBeCloseTo(-0.0008, 6); // bottom side, facing down
    expect(c1?.box?.min.y).toBeCloseTo(-0.0013, 6);
  });

  it('resolves layers and the board', () => {
    const silk = layer('layer/F.SilkS');
    expect(model.resolve('layer/F.SilkS')?.texels).toHaveLength(silk.table.count);
    expect(
      model.resolve('board')?.box?.containsBox(model.resolve('cmp/J1')?.box ?? model.bounds),
    ).toBe(true);
  });

  it('returns null for unknown or malformed IDs', () => {
    for (const id of ['cmp/R99', 'feat/F.Cu/999', 'feat/NOPE/0', 'net/', 'foo', 'layer/X']) {
      expect(model.resolve(id), id).toBeNull();
      expect(model.describe(id), id).toBeNull();
    }
  });

  it('knows which texels belong to an element', () => {
    const u1 = model.resolve('cmp/U1');
    const gnd = model.resolve('net/GND');
    if (!u1 || !gnd) throw new Error('unresolved');
    const fcu = layer('layer/F.Cu');
    expect(model.contains(u1, model.componentOffset + 2)).toBe(true);
    expect(model.contains(u1, fcu.stateOffset + 4)).toBe(true); // U1 pad 1
    expect(model.contains(u1, fcu.stateOffset + 0)).toBe(false);
    expect(model.contains(gnd, fcu.stateOffset + 14)).toBe(true);
  });
});

describe('components', () => {
  it('are batched per shared geometry and material, with instance → row mapping', () => {
    const batches = model.componentBatches.map((b) => [
      (b.mesh.material as Material).name,
      b.mesh.count,
      [...b.rows].map((r) => model.components.get('refDes', r)).join(' '),
    ]);
    expect(batches).toEqual([
      ['boardui/body', 2, 'R1 R2'],
      ['boardui/pin1', 2, 'R1 R2'],
      ['boardui/body', 1, 'U1'],
      ['boardui/pin1', 1, 'U1'],
      ['boardui/body', 1, 'C1'],
      ['boardui/body', 1, 'J1'],
      ['boardui/pin1', 1, 'J1'],
    ]);
  });
});
