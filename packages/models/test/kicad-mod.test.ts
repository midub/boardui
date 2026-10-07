// biome-ignore-all lint/suspicious/noTemplateCurlyInString: KiCad's path variables, e.g. ${KISYS3DMOD}
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { KICAD_LIBRARIES } from '../src/kicad-libraries.js';
import {
  kicadFootprint,
  kicadModelMatrix,
  libraryModelPath,
  parseKicadModels,
  parseSExpr,
} from '../src/kicad-mod.js';

const footprint = (part: string, pkg: string) =>
  kicadFootprint({ part, package: pkg }, KICAD_LIBRARIES);

describe('kicadFootprint', () => {
  it('takes the package name without KiCad’s counter, confirmed by the part', () => {
    expect(footprint('Capacitor_SMD_C_0402_1005Metric_100nF', 'C_0402_1005Metric_2')).toEqual({
      library: 'Capacitor_SMD',
      footprint: 'C_0402_1005Metric',
    });
    expect(
      footprint(
        'Connector_USB_USB_C_Receptacle_HRO_TYPE-C-31-M-12_USB_C_Receptacle_USB2.0_16P',
        'USB_C_Receptacle_HRO_TYPE-C-31-M-12_13',
      ),
    ).toEqual({ library: 'Connector_USB', footprint: 'USB_C_Receptacle_HRO_TYPE-C-31-M-12' });
    expect(
      footprint(
        'Package_DFN_QFN_QFN-32-1EP_5x5mm_P0.5mm_EP3.6x3.6mm_ThermalVias_nRF52',
        'QFN-32-1EP_5x5mm_P0.5mm_EP3.6x3.6mm_ThermalVias_9',
      ),
    ).toEqual({
      library: 'Package_DFN_QFN',
      footprint: 'QFN-32-1EP_5x5mm_P0.5mm_EP3.6x3.6mm_ThermalVias',
    });
  });

  it('accepts a part without a value', () => {
    expect(footprint('Resistor_SMD_R_0402_1005Metric', 'R_0402_1005Metric_3')?.footprint).toBe(
      'R_0402_1005Metric',
    );
  });

  it('rejects parts of other libraries and other exporters', () => {
    // Libraries of the project, not KiCad's.
    expect(
      footprint(
        'nordic-lib-kicad-nrf54-modules_BM15x-LGA-45_15.8x10mm_BM15x',
        'BM15x-LGA-45_15.8x10mm_5',
      ),
    ).toBeNull();
    // The part doesn't name the footprint.
    expect(footprint('GRM155R71C104KA88', 'C0402')).toBeNull();
    expect(footprint('Capacitor_SMD_C_0603_1608Metric_1u', 'C_0402_1005Metric_2')).toBeNull();
  });
});

describe('parseKicadModels', () => {
  it('reads every model with offset, scale, rotation and hide', () => {
    const models = parseKicadModels(`(footprint "X" (version 20241229) (generator "pcbnew")
      (layer "F.Cu")
      (property "Reference" "REF**" (at 0 -1 0) (layer "F.SilkS"))
      (model "\${KICAD9_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0402_1005Metric.wrl"
        (offset (xyz 0.1 -0.2 0.3)) (scale (xyz 1 1 1)) (rotate (xyz -90 0 180)))
      (model "\${KICAD10_3DMODEL_DIR}/Other.3dshapes/Hidden.step" (hide yes)
        (offset (xyz 0 0 0)) (scale (xyz 2 2 2)) (rotate (xyz 0 0 0)))
      (model "\${KISYS3DMOD}/Old.3dshapes/Old.wrl" hide
        (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))
      (model "\${KICAD8_3DMODEL_DIR}/Shown.3dshapes/Shown.step" (hide no)))`);
    expect(models).toEqual([
      {
        path: '${KICAD9_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0402_1005Metric.wrl',
        offset: [0.1, -0.2, 0.3],
        scale: [1, 1, 1],
        rotate: [-90, 0, 180],
        hide: false,
      },
      expect.objectContaining({ scale: [2, 2, 2], hide: true }),
      expect.objectContaining({ path: '${KISYS3DMOD}/Old.3dshapes/Old.wrl', hide: true }),
      expect.objectContaining({
        offset: [0, 0, 0],
        scale: [1, 1, 1],
        rotate: [0, 0, 0],
        hide: false,
      }),
    ]);
  });

  it('reads KiCad 5 modules, whose offset is `at` in inches', () => {
    const [model] = parseKicadModels(`(module R_0402 (layer F.Cu) (tedit 5F68FEEE)
      (model \${KISYS3DMOD}/Resistor_SMD.3dshapes/R_0402_1005Metric.wrl
        (at (xyz 0.1 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0))))`);
    expect(model?.offset[0]).toBeCloseTo(2.54, 9);
  });

  it('reads quoted strings with escapes', () => {
    expect(parseSExpr('(a "b \\"c\\"" (d))')).toEqual([['a', 'b "c"', ['d']]]);
    expect(() => parseSExpr('(a (b)')).toThrow();
    expect(() => parseKicadModels('(symbol "x")')).toThrow(/footprint/);
  });
});

describe('libraryModelPath', () => {
  it('strips the library variables and asks for STEP', () => {
    expect(
      libraryModelPath('${KICAD9_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0402_1005Metric.wrl'),
    ).toBe('Resistor_SMD.3dshapes/R_0402_1005Metric.step');
    expect(libraryModelPath('${KICAD10_3DMODEL_DIR}/A.3dshapes/B.step')).toBe('A.3dshapes/B.step');
    expect(libraryModelPath('${KISYS3DMOD}/A.3dshapes/B.WRL')).toBe('A.3dshapes/B.step');
    expect(libraryModelPath('$(KISYS3DMOD)\\A.3dshapes\\B.stp')).toBe('A.3dshapes/B.step');
  });

  it('rejects models outside the library', () => {
    expect(libraryModelPath('/home/me/models/part.step')).toBeNull();
    expect(libraryModelPath('${KIPRJMOD}/3d/part.step')).toBeNull();
  });
});

describe('kicadModelMatrix', () => {
  /** A point of a KiCad model (mm, Z up) as the STEP loader delivers it (m, Y up). */
  const loaded = (x: number, y: number, z: number) => new Vector3(x * 1e-3, z * 1e-3, -y * 1e-3);
  const place = (model: Parameters<typeof kicadModelMatrix>[0], p: Vector3) =>
    p.clone().applyMatrix4(new Matrix4().fromArray(kicadModelMatrix(model)));
  const identity = { offset: [0, 0, 0], scale: [1, 1, 1], rotate: [0, 0, 0] } as const;
  const expectPoint = (actual: Vector3, expected: [number, number, number]) => {
    expect(actual.x).toBeCloseTo(expected[0], 9);
    expect(actual.y).toBeCloseTo(expected[1], 9);
    expect(actual.z).toBeCloseTo(expected[2], 9);
  };

  it('puts the model frame on the package frame (USB-C pin A1)', () => {
    // Pin A1 of USB_C_Receptacle_HRO_TYPE-C-31-M-12 is at (−3.25, −4.045) in the .kicad_mod (Y
    // down), at (−3.25, 4.045) in KiCad's 3D frame and the IPC-2581 package, so at
    // (−3.25, 0, −4.045) mm in the component node's frame (spec §6.8).
    expectPoint(place(identity, loaded(-3.25, 4.045, 0)), [-0.00325, 0, -0.004045]);
  });

  it('keeps an R_0402 model on its pads', () => {
    // The R_0402_1005Metric STEP spans x −0.5…0.5 mm; its pads are at x ±0.51 mm.
    expectPoint(place(identity, loaded(-0.5, 0, 0.35)), [-0.0005, 0.00035, 0]);
    expectPoint(place(identity, loaded(0.5, 0, 0.35)), [0.0005, 0.00035, 0]);
  });

  it('applies offset, rotation and scale as KiCad does', () => {
    // Offset in KiCad's 3D frame: +y is up in the top view, −z in the package frame.
    expectPoint(place({ ...identity, offset: [1, 2, 3] }, loaded(0, 0, 0)), [0.001, 0.003, -0.002]);
    // KiCad rotates by the negated angles: rotate z 90 turns +x to −y (top view).
    expectPoint(place({ ...identity, rotate: [0, 0, 90] }, loaded(1, 0, 0)), [0, 0, 0.001]);
    // rotate x −90 (common for WRL-era models) turns +y into +z.
    expectPoint(place({ ...identity, rotate: [-90, 0, 0] }, loaded(0, 1, 0)), [0, 0.001, 0]);
    // Scale first, then rotate, then offset.
    expectPoint(
      place({ offset: [1, 0, 0], scale: [2, 2, 2], rotate: [0, 0, 90] }, loaded(1, 0, 0)),
      [0.001, 0, 0.002],
    );
  });
});
