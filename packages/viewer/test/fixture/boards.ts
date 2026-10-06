/**
 * The fixture boards: a small four-layer board that exercises every rule of the profile, and a
 * dense two-layer board with about 100k features for performance checks.
 */
import {
  type FixtureBoard,
  type FixtureComponent,
  type FixtureFeature,
  type FixtureLayer,
  type FixturePackage,
  writeBoard,
} from './board.js';
import {
  circle,
  place,
  prism,
  type Region,
  type Ring,
  rect,
  sheet,
  type Vec2,
} from './geometry.js';

const mm = (value: number) => value / 1000;
const THICKNESS = mm(1.6);
const COPPER = 35e-6;
const SOLDERMASK = 20e-6;
const SILKSCREEN = 10e-6;
const PLATING = 25e-6;

/** Generates the small fixture GLB. */
export function smallBoardGlb(): Uint8Array {
  return writeBoard(smallBoard());
}

/**
 * Generates the dense fixture GLB: a `grid × grid` array of cells with ten features each. The
 * default grid gives 110,253 features, and its top copper table needs FLOAT feature IDs.
 */
export function denseBoardGlb(grid = 105): Uint8Array {
  return writeBoard(denseBoard(grid));
}

type Pad = { number: string; shape: Ring; drill?: number };

interface PackageDef extends FixturePackage {
  pads: Pad[];
  /** Silkscreen outline: outer and inner rectangle as `[cx, cy, w, h, ring width]`. */
  silk: readonly [number, number, number, number, number];
}

const R0603: PackageDef = {
  name: 'R0603',
  outline: rect(0, 0, mm(1.6), mm(0.8)),
  standoff: 0,
  height: mm(0.45),
  pin1: [mm(-0.75), 0],
  pads: [
    { number: '1', shape: rect(mm(-0.75), 0, mm(0.8), mm(0.9)) },
    { number: '2', shape: rect(mm(0.75), 0, mm(0.8), mm(0.9)) },
  ],
  silk: [0, 0, mm(2.7), mm(1.3), mm(0.1)],
};

const C0402: PackageDef = {
  name: 'C0402',
  outline: rect(0, 0, mm(1), mm(0.5)),
  standoff: 0,
  height: mm(0.5),
  pads: [
    { number: '1', shape: rect(mm(-0.5), 0, mm(0.5), mm(0.55)) },
    { number: '2', shape: rect(mm(0.5), 0, mm(0.5), mm(0.55)) },
  ],
  silk: [0, 0, mm(1.9), mm(0.9), mm(0.1)],
};

const SOIC8: PackageDef = {
  name: 'SOIC-8',
  outline: rect(0, 0, mm(3.9), mm(4.9)),
  standoff: mm(0.1),
  height: mm(1.75),
  pin1: [mm(-1.4), mm(1.9)],
  pads: Array.from({ length: 8 }, (_, i): Pad => {
    const left = i < 4;
    const y = left ? 1.905 - 1.27 * i : -1.905 + 1.27 * (i - 4);
    return { number: String(i + 1), shape: rect(mm(left ? -2.7 : 2.7), mm(y), mm(1.55), mm(0.6)) };
  }),
  silk: [0, 0, mm(7.4), mm(5.4), mm(0.1)],
};

const CONN2: PackageDef = {
  name: 'CONN-2',
  outline: rect(0, mm(-1.27), mm(2.54), mm(5.08)),
  standoff: 0,
  height: mm(8.5),
  pin1: [0, 0],
  pads: [
    { number: '1', shape: [], drill: mm(1) },
    { number: '2', shape: [], drill: mm(1) },
  ],
  silk: [0, mm(-1.27), mm(3), mm(5.6), mm(0.1)],
};
const CONN2_PITCH = mm(2.54);
const CONN2_PAD = mm(1.7);

const R0402: PackageDef = {
  name: 'R0402',
  outline: rect(0, 0, mm(1), mm(0.5)),
  standoff: 0,
  height: mm(0.35),
  pin1: [mm(-0.5), 0],
  pads: [
    { number: '1', shape: rect(mm(-0.5), 0, mm(0.5), mm(0.55)) },
    { number: '2', shape: rect(mm(0.5), 0, mm(0.5), mm(0.55)) },
  ],
  silk: [0, 0, mm(2), mm(1.1), mm(0.1)],
};

/** Maps a ring from package coordinates to board coordinates (spec §6.8). */
function toBoard(component: FixtureComponent, ring: Ring): Ring {
  const local = component.side === 'TOP' ? ring : ring.map(([x, y]): Vec2 => [x, -y]);
  return place(local, component.rotation, component.x, component.y);
}

function silkRing(component: FixtureComponent, pkg: PackageDef): Region {
  const [cx, cy, w, h, width] = pkg.silk;
  return {
    outer: toBoard(component, rect(cx, cy, w, h)),
    holes: [toBoard(component, rect(cx, cy, w - 2 * width, h - 2 * width))],
  };
}

/** A straight trace between two points along one axis. */
function trace(x0: number, y0: number, x1: number, y1: number, width: number): Region {
  const outer =
    y0 === y1
      ? rect((x0 + x1) / 2, y0, Math.abs(x1 - x0), width)
      : rect(x0, (y0 + y1) / 2, width, Math.abs(y1 - y0));
  return { outer, holes: [] };
}

function annulus(c: Vec2, outer: number, inner: number, tolerance: number): Region {
  return {
    outer: circle(c[0], c[1], outer, tolerance),
    holes: [circle(c[0], c[1], inner, tolerance)],
  };
}

interface Stack {
  layers: FixtureLayer[];
  copper: Map<string, FixtureLayer>;
}

/** Builds the layer stack, top to bottom, with default thicknesses (spec §6.4, §6.5). */
function stackup(coppers: { name: string; ipcFunction: string }[], dielectrics: string[]): Stack {
  const layer = (
    name: string,
    role: FixtureLayer['role'],
    side: FixtureLayer['side'],
    zMin: number,
    zMax: number,
    ipcFunction?: string,
  ): FixtureLayer => {
    const result: FixtureLayer = {
      name,
      role,
      side,
      synthesized: ipcFunction === undefined,
      visible: role !== 'DIELECTRIC' && side !== 'INTERNAL',
      zMin,
      zMax,
      features: [],
    };
    if (ipcFunction !== undefined) result.ipcFunction = ipcFunction;
    return result;
  };
  const gap = (THICKNESS - coppers.length * COPPER) / (coppers.length - 1);
  const top = THICKNESS / 2;
  const copper = new Map<string, FixtureLayer>();
  const middle: FixtureLayer[] = [];
  coppers.forEach((c, i) => {
    const zMax = top - i * (COPPER + gap);
    const side = i === 0 ? 'TOP' : i === coppers.length - 1 ? 'BOTTOM' : 'INTERNAL';
    const l = layer(c.name, 'COPPER', side, zMax - COPPER, zMax, c.ipcFunction);
    copper.set(c.name, l);
    middle.push(l);
    const dielectric = dielectrics[i];
    if (dielectric !== undefined) {
      middle.push(layer(dielectric, 'DIELECTRIC', 'INTERNAL', zMax - COPPER - gap, zMax - COPPER));
    }
  });
  const t = -top + COPPER; // top of the dielectric above the bottom copper
  return {
    copper,
    layers: [
      layer(
        'F.SilkS',
        'SILKSCREEN',
        'TOP',
        top + SOLDERMASK,
        top + SOLDERMASK + SILKSCREEN,
        'SILKSCREEN',
      ),
      layer('@soldermask-top', 'SOLDERMASK', 'TOP', top - COPPER, top + SOLDERMASK),
      ...middle,
      layer('@soldermask-bottom', 'SOLDERMASK', 'BOTTOM', -top - SOLDERMASK, t),
      layer(
        'B.SilkS',
        'SILKSCREEN',
        'BOTTOM',
        -top - SOLDERMASK - SILKSCREEN,
        -top - SOLDERMASK,
        'SILKSCREEN',
      ),
    ],
  };
}

function byName(stack: Stack, name: string): FixtureLayer {
  const found = stack.layers.find((l) => l.name === name);
  if (!found) throw new Error(`No layer ${name}`);
  return found;
}

function add(
  layer: FixtureLayer,
  feature: Omit<FixtureFeature, 'part'>,
  region: Region | null,
): void {
  layer.features.push({ ...feature, part: region && prism(region, layer.zMin, layer.zMax) });
}

/** The small board: four layers, five components, one via, every feature kind. */
export function smallBoard(): FixtureBoard {
  const tolerance = 5e-6;
  const stack = stackup(
    [
      { name: 'F.Cu', ipcFunction: 'CONDUCTOR' },
      { name: 'In1.Cu', ipcFunction: 'PLANE' },
      { name: 'In2 Power', ipcFunction: 'PLANE' },
      { name: 'B.Cu', ipcFunction: 'CONDUCTOR' },
    ],
    ['@prepreg-1', '@core', '@prepreg-2'],
  );
  const fcu = byName(stack, 'F.Cu');
  const bcu = byName(stack, 'B.Cu');
  const outline = rect(mm(20), mm(15), mm(40), mm(30));

  const components: FixtureComponent[] = [
    {
      refDes: 'R1',
      part: 'RC0603FR-0710KL',
      package: 'R0603',
      side: 'TOP',
      mount: 'SMT',
      x: mm(8),
      y: mm(22),
      rotation: 0,
      pins: [
        { number: '1', net: 'VCC' },
        { number: '2', net: 'Net-(R1-Pad2)' },
      ],
    },
    {
      refDes: 'R2',
      part: 'RC0603FR-0710KL',
      package: 'R0603',
      side: 'TOP',
      mount: 'SMT',
      x: mm(8),
      y: mm(16),
      rotation: 90,
      pins: [
        { number: '1', net: 'Net-(R1-Pad2)' },
        { number: '2', net: 'GND' },
      ],
    },
    {
      refDes: 'U1',
      part: 'AT24C02',
      package: 'SOIC-8',
      side: 'TOP',
      mount: 'SMT',
      x: mm(24),
      y: mm(18),
      rotation: 0,
      pins: [
        { number: '1', name: 'VDD', net: 'VCC' },
        { number: '2', name: 'SDA', net: '/SDA' },
        { number: '3' },
        { number: '4', name: 'GND', net: 'GND' },
        { number: '5' },
        { number: '6' },
        { number: '7' },
        { number: '8', name: 'VDD', net: 'VCC' },
      ],
    },
    {
      refDes: 'C1',
      part: 'GRM155R71C104KA88',
      package: 'C0402',
      side: 'BOTTOM',
      mount: 'SMT',
      x: mm(20),
      y: mm(8),
      rotation: 30,
      pins: [
        { number: '1', net: 'VCC' },
        { number: '2', net: 'GND' },
      ],
    },
    {
      refDes: 'J1',
      part: 'PH-2',
      package: 'CONN-2',
      side: 'TOP',
      mount: 'THMT',
      x: mm(35),
      y: mm(12),
      rotation: 0,
      pins: [
        { number: '1', net: 'VCC' },
        { number: '2', net: 'GND' },
      ],
    },
  ];
  const packages = [R0603, C0402, SOIC8, CONN2];
  const pkgOf = (c: FixtureComponent) => packages.find((p) => p.name === c.package) as PackageDef;
  const netOf = (c: FixtureComponent, pin: string) => c.pins.find((p) => p.number === pin)?.net;

  // THT pins of J1 and the via: positions, drill diameters and nets.
  const j1 = components[4] as FixtureComponent;
  const tht = [0, 1].map((i) => ({
    at: [j1.x, j1.y - i * CONN2_PITCH] as Vec2,
    drill: mm(1),
    net: netOf(j1, String(i + 1)),
    pin: String(i + 1),
  }));
  const via = { at: [mm(15), mm(10)] as Vec2, drill: mm(0.3), land: mm(0.6), net: 'GND' };
  const holeRadius = (d: number) => d / 2 + PLATING;

  // Copper pads, in document order: SMT pads of top-side parts, THT pads, then the via land.
  const padRegions = new Map<FixtureLayer, Region[]>([
    [fcu, []],
    [bcu, []],
  ]);
  for (const c of components.filter((c) => c.mount === 'SMT')) {
    const layer = c.side === 'TOP' ? fcu : bcu;
    for (const pad of pkgOf(c).pads) {
      const region = { outer: toBoard(c, pad.shape), holes: [] };
      padRegions.get(layer)?.push(region);
      add(
        layer,
        { kind: 'PAD', pin: [c.refDes, pad.number], ...net(netOf(c, pad.number)) },
        region,
      );
    }
  }
  for (const layer of [fcu, bcu]) {
    for (const pin of tht) {
      const region = annulus(pin.at, CONN2_PAD / 2, holeRadius(pin.drill), tolerance);
      padRegions.get(layer)?.push({ outer: region.outer, holes: [] });
      add(layer, { kind: 'PAD', pin: ['J1', pin.pin], ...net(pin.net) }, region);
    }
    add(
      layer,
      { kind: 'VIA', net: via.net },
      annulus(via.at, via.land / 2, holeRadius(via.drill), tolerance),
    );
  }
  const w = mm(0.25);
  add(
    fcu,
    { kind: 'TRACE', net: 'Net-(R1-Pad2)' },
    trace(mm(8.75), mm(21.55), mm(8.75), mm(15.375), w),
  );
  add(
    fcu,
    { kind: 'TRACE', net: 'Net-(R1-Pad2)' },
    trace(mm(8.45), mm(15.25), mm(8.875), mm(15.25), w),
  );
  add(fcu, { kind: 'TRACE', net: '/SDA' }, trace(mm(17), mm(18.635), mm(20.525), mm(18.635), w));
  add(fcu, { kind: 'TRACE', net: 'VCC' }, trace(mm(27.475), mm(19.905), mm(31), mm(19.905), w));
  add(fcu, { kind: 'TRACE', net: 'GND' }, null); // fully covered by higher-priority copper
  add(fcu, { kind: 'FILL', net: 'GND' }, { outer: rect(mm(7), mm(5), mm(10), mm(6)), holes: [] });
  add(bcu, { kind: 'TRACE', net: 'GND' }, trace(mm(15.3), mm(10), mm(18), mm(10), w));

  // Planes: cut where holes pass, with clearance around holes of other nets.
  const holes = [...tht, { ...via, pin: '' }];
  const inset = rect(mm(20), mm(15), mm(39), mm(29));
  for (const [name, planeNet] of [
    ['In1.Cu', 'GND'],
    ['In2 Power', 'VCC'],
  ] as const) {
    const cut = holes.map((h) =>
      circle(h.at[0], h.at[1], h.net === planeNet ? holeRadius(h.drill) : mm(1), tolerance),
    );
    add(byName(stack, name), { kind: 'FILL', net: planeNet }, { outer: inset, holes: cut });
  }

  // Silkscreen outlines, plus one marking without a component.
  for (const c of components) {
    add(
      byName(stack, c.side === 'TOP' ? 'F.SilkS' : 'B.SilkS'),
      { kind: 'MARKING', component: c.refDes },
      silkRing(c, pkgOf(c)),
    );
  }
  add(
    byName(stack, 'F.SilkS'),
    { kind: 'MARKING' },
    { outer: rect(mm(35), mm(25), mm(4), mm(2)), holes: [] },
  );

  // Sheets: soldermask (outline − openings − holes) and dielectric (outline − holes).
  const viaHole = circle(via.at[0], via.at[1], holeRadius(via.drill), tolerance);
  for (const [mask, copper] of [
    ['@soldermask-top', fcu],
    ['@soldermask-bottom', bcu],
  ] as const) {
    const openings = (padRegions.get(copper) ?? []).map((r) => r.outer);
    add(byName(stack, mask), { kind: 'SHEET' }, { outer: outline, holes: [...openings, viaHole] });
  }
  const drilled = holes.map((h) => circle(h.at[0], h.at[1], holeRadius(h.drill), tolerance));
  for (const dielectric of ['@prepreg-1', '@core', '@prepreg-2']) {
    add(byName(stack, dielectric), { kind: 'SHEET' }, { outer: outline, holes: drilled });
  }

  // Barrels (§6.3), stored with rows in reverse document order.
  const barrels: FixtureFeature[] = holes.map((h) => ({
    kind: 'BARREL',
    ...net(h.net),
    part: prism(annulus(h.at, holeRadius(h.drill), h.drill / 2, tolerance), bcu.zMin, fcu.zMax),
  }));

  return {
    step: 'fixture-small',
    tolerance,
    thickness: THICKNESS,
    nets: ['GND', 'VCC', '/SDA', 'Net-(R1-Pad2)'],
    layers: stack.layers,
    drills: [{ name: 'DRILL_1-4', from: 'F.Cu', to: 'B.Cu', features: barrels, reverseRows: true }],
    packages,
    components,
  };
}

/**
 * The dense board: per cell one R0402 on the top side, a via, three traces, a fill, a silkscreen
 * outline and a barrel.
 */
export function denseBoard(grid: number): FixtureBoard {
  const tolerance = 25e-6;
  const pitch = mm(2.5);
  const stack = stackup(
    [
      { name: 'F.Cu', ipcFunction: 'CONDUCTOR' },
      { name: 'B.Cu', ipcFunction: 'CONDUCTOR' },
    ],
    ['@core'],
  );
  stack.layers = stack.layers.filter((l) => l.name !== 'B.SilkS');
  const fcu = byName(stack, 'F.Cu');
  const bcu = byName(stack, 'B.Cu');
  const silk = byName(stack, 'F.SilkS');
  const size = grid * pitch;
  const nets = ['GND'];
  const components: FixtureComponent[] = [];
  const barrels: FixtureFeature[] = [];
  const maskTopCaps: Region[] = [];
  const maskBottomCaps: Region[] = [];
  const maskTopWalls: Ring[] = [];
  const viaHoles: Ring[] = [];
  const drill = mm(0.3);
  const hole = drill / 2 + PLATING;
  const w = mm(0.2);

  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const k = row * grid + col;
      const cx = (col + 0.5) * pitch;
      const cy = (row + 0.5) * pitch;
      const netName = `N${k}`;
      nets.push(netName);
      const component: FixtureComponent = {
        refDes: `R${k + 1}`,
        part: 'RC0402FR-0710KL',
        package: 'R0402',
        side: 'TOP',
        mount: 'SMT',
        x: cx - mm(0.25),
        y: cy + mm(0.5),
        rotation: 0,
        pins: [
          { number: '1', net: 'GND' },
          { number: '2', net: netName },
        ],
      };
      components.push(component);
      const pads = R0402.pads.map((pad) => toBoard(component, pad.shape));
      const viaAt: Vec2 = [cx + mm(0.1), cy - mm(0.6)];
      const viaHole = circle(viaAt[0], viaAt[1], hole, tolerance);
      pads.forEach((outer, i) => {
        const pin = String(i + 1);
        add(
          fcu,
          { kind: 'PAD', pin: [component.refDes, pin], net: i ? netName : 'GND' },
          { outer, holes: [] },
        );
      });
      add(
        fcu,
        { kind: 'TRACE', net: netName },
        trace(cx + mm(0.1), cy - mm(0.325), cx + mm(0.1), cy + mm(0.225), w),
      );
      add(
        fcu,
        { kind: 'TRACE', net: 'GND' },
        trace(cx - mm(1.24), cy + mm(0.5), cx - mm(1), cy + mm(0.5), mm(0.1)),
      );
      add(fcu, { kind: 'VIA', net: netName }, annulus(viaAt, mm(0.275), hole, tolerance));
      add(
        fcu,
        { kind: 'FILL', net: 'GND' },
        { outer: rect(cx - mm(0.85), cy - mm(0.8), mm(0.7), mm(0.8)), holes: [] },
      );
      add(bcu, { kind: 'VIA', net: netName }, annulus(viaAt, mm(0.275), hole, tolerance));
      add(
        bcu,
        { kind: 'TRACE', net: netName },
        trace(cx + mm(0.375), cy - mm(0.6), cx + mm(1.1), cy - mm(0.6), w),
      );
      add(silk, { kind: 'MARKING', component: component.refDes }, silkRing(component, R0402));
      barrels.push({
        kind: 'BARREL',
        net: netName,
        part: prism(annulus(viaAt, hole, drill / 2, tolerance), bcu.zMin, fcu.zMax),
      });
      const cell = rect(cx, cy, pitch, pitch);
      maskTopCaps.push({ outer: cell, holes: [...pads, viaHole] });
      maskBottomCaps.push({ outer: cell, holes: [viaHole] });
      maskTopWalls.push(...pads, viaHole);
      viaHoles.push(viaHole);
    }
  }
  const outline = rect(size / 2, size / 2, size, size);
  const addSheet = (name: string, caps: Region[], holes: Ring[]) => {
    const layer = byName(stack, name);
    layer.features.push({
      kind: 'SHEET',
      part: sheet(caps, { outer: outline, holes }, layer.zMin, layer.zMax),
    });
  };
  addSheet('@soldermask-top', maskTopCaps, maskTopWalls);
  addSheet('@core', maskBottomCaps, viaHoles);
  addSheet('@soldermask-bottom', maskBottomCaps, viaHoles);

  return {
    step: `fixture-dense-${grid}`,
    tolerance,
    thickness: THICKNESS,
    nets,
    layers: stack.layers,
    drills: [{ name: 'DRILL_1-2', from: 'F.Cu', to: 'B.Cu', features: barrels }],
    packages: [R0402],
    components,
  };
}

function net(name: string | undefined): { net?: string } {
  return name === undefined ? {} : { net: name };
}
