/**
 * KiCad footprints: finding a component's footprint from its IPC-2581 names, reading the 3D
 * models of a `.kicad_mod` file, and placing them like KiCad does.
 */

/** A footprint of a KiCad library. */
export interface KicadFootprint {
  /** E.g. `Capacitor_SMD`. */
  readonly library: string;
  /** E.g. `C_0402_1005Metric`. */
  readonly footprint: string;
}

/**
 * The footprint of a component exported by KiCad, or `null`. KiCad names the IPC-2581 package
 * `<footprint>_<n>` and the part `<library>_<footprint>_<value>`; the footprint is the package
 * name without the `_<n>`, confirmed by the part, whose library must be one of `libraries`.
 */
export function kicadFootprint(
  component: { readonly part: string; readonly package: string },
  libraries: Iterable<string>,
): KicadFootprint | null {
  const { part } = component;
  const suffix = /^(.+)_\d+$/.exec(component.package);
  const candidates = suffix ? [suffix[1] as string, component.package] : [component.package];
  for (const footprint of candidates) {
    for (const library of libraries) {
      const prefix = `${library}_${footprint}`;
      if (
        part.startsWith(prefix) &&
        (part.length === prefix.length || part[prefix.length] === '_')
      ) {
        return { library, footprint };
      }
    }
  }
  return null;
}

/** A `(model …)` of a footprint. */
export interface KicadModel {
  /** The path as written, e.g. `${KICAD9_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0402_1005Metric.wrl`. */
  readonly path: string;
  /** Millimetres, in KiCad's 3D frame (x right, y up in the top view, z up from the board). */
  readonly offset: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  /** Degrees. */
  readonly rotate: readonly [number, number, number];
  readonly hide: boolean;
}

/** An s-expression: an atom (symbol or string) or a list. */
export type SExpr = string | SExpr[];

/** Parses an s-expression file (KiCad's format) into nested lists. Strings lose their quotes. */
export function parseSExpr(text: string): SExpr[] {
  const root: SExpr[] = [];
  const stack: SExpr[][] = [root];
  const pattern = /\s*(?:(\()|(\))|"((?:[^"\\]|\\.)*)"|([^\s()"]+))/gy;
  for (;;) {
    const at = pattern.lastIndex;
    const match = pattern.exec(text);
    if (!match) {
      if (text.slice(at).trim()) throw new Error(`Unexpected input at ${at}`);
      break;
    }
    const top = stack[stack.length - 1] as SExpr[];
    if (match[1]) {
      const list: SExpr[] = [];
      top.push(list);
      stack.push(list);
    } else if (match[2]) {
      if (stack.length === 1) throw new Error(`Unbalanced ) at ${at}`);
      stack.pop();
    } else if (match[3] !== undefined) {
      top.push(match[3].replace(/\\(.)/g, '$1'));
    } else {
      top.push(match[4] as string);
    }
  }
  if (stack.length !== 1) throw new Error('Unbalanced (');
  return root;
}

const head = (list: SExpr): string | undefined =>
  Array.isArray(list) && typeof list[0] === 'string' ? list[0] : undefined;

function xyz(
  list: SExpr[],
  name: string,
  fallback: [number, number, number],
): [number, number, number] {
  const entry = list.find((e) => head(e) === name) as SExpr[] | undefined;
  const values = (entry?.find((e) => head(e) === 'xyz') as SExpr[] | undefined)?.slice(1);
  if (!values || values.length < 3) return fallback;
  const numbers = values.slice(0, 3).map(Number);
  return numbers.every(Number.isFinite) ? (numbers as [number, number, number]) : fallback;
}

/**
 * The `(model …)` entries of a `.kicad_mod` file (KiCad 5 to 10), in file order. KiCad 5's
 * `(at (xyz …))` is in inches and becomes `offset` in millimetres.
 */
export function parseKicadModels(text: string): KicadModel[] {
  const footprint = parseSExpr(text).find((e) => head(e) === 'footprint' || head(e) === 'module');
  if (!Array.isArray(footprint)) throw new Error('Not a KiCad footprint');
  return footprint
    .filter((e): e is SExpr[] => head(e) === 'model')
    .map((model) => {
      const path = typeof model[1] === 'string' ? model[1] : '';
      const at = xyz(model, 'at', [0, 0, 0]);
      const offset = model.some((e) => head(e) === 'offset')
        ? xyz(model, 'offset', [0, 0, 0])
        : (at.map((v) => v * 25.4) as [number, number, number]);
      const hideEntry = model.find((e) => head(e) === 'hide') as SExpr[] | undefined;
      const hide = model.includes('hide') || (!!hideEntry && hideEntry[1] !== 'no');
      return {
        path,
        offset,
        scale: xyz(model, 'scale', [1, 1, 1]),
        rotate: xyz(model, 'rotate', [0, 0, 0]),
        hide,
      };
    });
}

/**
 * The path of a model in `kicad-packages3D`, e.g. `Resistor_SMD.3dshapes/R_0402_1005Metric.step`,
 * or `null` if it is not in KiCad's library (no `${KICAD<n>_3DMODEL_DIR}` or `${KISYS3DMOD}`
 * prefix). WRL references become STEP: the library has STEP for every model since KiCad 6.
 */
export function libraryModelPath(path: string): string | null {
  const match = /^(?:\$\{KICAD\d*_3DMODEL_DIR\}|\$\{KISYS3DMOD\}|\$\(KISYS3DMOD\))[/\\](.+)$/.exec(
    path,
  );
  if (!match) return null;
  return (match[1] as string).replace(/\\/g, '/').replace(/\.(wrl|stp|step)$/i, '.step');
}

/**
 * The transform of a KiCad model into the package frame (column-major 4×4, metres, Y up), for a
 * model delivered Y-up in metres as the STEP loader does.
 *
 * KiCad places a model at `T(offset) · Rz(−rz) · Ry(−ry) · Rx(−rx) · S(scale)` in its 3D frame
 * (millimetres, Z up, Y up in the top view): KiCad's 3D viewer and exporters negate the rotation.
 * The package frame is the same frame with (x, y, z) → (x, z, −y), in metres.
 */
export function kicadModelMatrix(model: Pick<KicadModel, 'offset' | 'scale' | 'rotate'>): number[] {
  const [ox, oy, oz] = model.offset;
  const [sx, sy, sz] = model.scale;
  const [rx, ry, rz] = model.rotate.map((d) => (-d * Math.PI) / 180) as [number, number, number];
  const m = multiply(
    multiply(
      multiply(translation(ox * 1e-3, oy * 1e-3, oz * 1e-3), rotation('z', rz)),
      rotation('y', ry),
    ),
    multiply(rotation('x', rx), scaling(sx, sy, sz)),
  );
  // Conjugate with the change of frame C: (x, y, z) → (x, z, −y).
  return multiply(multiply(ZUP_TO_YUP, m), YUP_TO_ZUP);
}

/** 4×4 matrices, column-major. */
type Mat = number[];

/** (x, y, z) → (x, z, −y). */
const ZUP_TO_YUP: Mat = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
/** (x, y, z) → (x, −z, y). */
const YUP_TO_ZUP: Mat = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];

function multiply(a: Mat, b: Mat): Mat {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function translation(x: number, y: number, z: number): Mat {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function scaling(x: number, y: number, z: number): Mat {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

function rotation(axis: 'x' | 'y' | 'z', angle: number): Mat {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (axis === 'x') return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
  if (axis === 'y') return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
