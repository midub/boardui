/**
 * Writes small STEP files (AP214) for tests: an axis-aligned box in millimetres, with a colour for
 * the whole solid and optionally another one for its top face (+z).
 */

type Rgb = readonly [number, number, number];

export interface BoxOptions {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  color?: Rgb;
  topColor?: Rgb;
}

const n = (v: number) => (Number.isInteger(v) ? `${v}.` : String(v));
const point = (p: readonly number[]) => `(${p.map(n).join(',')})`;

export function boxStep({ min, max, color = [0.2, 0.2, 0.2], topColor }: BoxOptions): string {
  const lines: string[] = [];
  let next = 1;
  const add = (entity: string): string => {
    const id = `#${next++}`;
    lines.push(`${id}=${entity};`);
    return id;
  };

  const context = add("APPLICATION_CONTEXT('automotive design')");
  add(
    `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${context})`,
  );
  const productContext = add(`PRODUCT_CONTEXT('',${context},'mechanical')`);
  const product = add(`PRODUCT('box','box','',(${productContext}))`);
  const formation = add(`PRODUCT_DEFINITION_FORMATION('','',${product})`);
  const definitionContext = add(
    `PRODUCT_DEFINITION_CONTEXT('part definition',${context},'design')`,
  );
  const definition = add(`PRODUCT_DEFINITION('design','',${formation},${definitionContext})`);
  const shape = add(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
  const mm = add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
  const rad = add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
  const sr = add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
  const uncertainty = add(
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${mm},'distance_accuracy_value','')`,
  );
  const geometryContext = add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr}))REPRESENTATION_CONTEXT('',''))`,
  );

  // Vertices: bit 0 → x, bit 1 → y, bit 2 → z.
  const corner = (i: number) => [
    i & 1 ? max[0] : min[0],
    i & 2 ? max[1] : min[1],
    i & 4 ? max[2] : min[2],
  ];
  const vertices = Array.from({ length: 8 }, (_, i) =>
    add(`VERTEX_POINT('',${add(`CARTESIAN_POINT('',${point(corner(i))})`)})`),
  );
  const edges = new Map<string, string>();
  const edge = (a: number, b: number): string => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const key = `${lo}-${hi}`;
    let id = edges.get(key);
    if (!id) {
      const p = corner(lo);
      const q = corner(hi);
      const d = q.map((v, k) => v - (p[k] as number));
      const length = Math.hypot(...d);
      const direction = add(`DIRECTION('',${point(d.map((v) => v / length))})`);
      const line = add(
        `LINE('',${add(`CARTESIAN_POINT('',${point(p)})`)},${add(`VECTOR('',${direction},${n(length)})`)})`,
      );
      id = add(`EDGE_CURVE('',${vertices[lo]},${vertices[hi]},${line},.T.)`);
      edges.set(key, id);
    }
    return add(`ORIENTED_EDGE('',*,*,${id},${a < b ? '.T.' : '.F.'})`);
  };
  // Faces as corner loops, counter-clockwise seen from outside, with their outward normal.
  const faces: [number[], number[]][] = [
    [
      [0, 2, 3, 1],
      [0, 0, -1],
    ],
    [
      [4, 5, 7, 6],
      [0, 0, 1],
    ],
    [
      [0, 1, 5, 4],
      [0, -1, 0],
    ],
    [
      [2, 6, 7, 3],
      [0, 1, 0],
    ],
    [
      [0, 4, 6, 2],
      [-1, 0, 0],
    ],
    [
      [1, 3, 7, 5],
      [1, 0, 0],
    ],
  ];
  const faceIds = faces.map(([loop, normal]) => {
    const edgeLoop = add(
      `EDGE_LOOP('',(${loop.map((v, i) => edge(v, loop[(i + 1) % 4] as number)).join(',')}))`,
    );
    const bound = add(`FACE_OUTER_BOUND('',${edgeLoop},.T.)`);
    const reference = normal[2] === 0 ? [0, 0, 1] : [1, 0, 0];
    const placement = add(
      `AXIS2_PLACEMENT_3D('',${add(`CARTESIAN_POINT('',${point(corner(loop[0] as number))})`)},${add(`DIRECTION('',${point(normal)})`)},${add(`DIRECTION('',${point(reference)})`)})`,
    );
    const plane = add(`PLANE('',${placement})`);
    return add(`ADVANCED_FACE('',(${bound}),${plane},.T.)`);
  });
  const shell = add(`CLOSED_SHELL('',(${faceIds.join(',')}))`);
  const solid = add(`MANIFOLD_SOLID_BREP('box',${shell})`);
  const origin = add(
    `AXIS2_PLACEMENT_3D('',${add("CARTESIAN_POINT('',(0.,0.,0.))")},${add("DIRECTION('',(0.,0.,1.))")},${add("DIRECTION('',(1.,0.,0.))")})`,
  );
  const representation = add(
    `ADVANCED_BREP_SHAPE_REPRESENTATION('',(${solid},${origin}),${geometryContext})`,
  );
  add(`SHAPE_DEFINITION_REPRESENTATION(${shape},${representation})`);

  const style = (rgb: Rgb, item: string) => {
    const colour = add(`COLOUR_RGB('',${rgb.map(n).join(',')})`);
    const fill = add(`FILL_AREA_STYLE('',(${add(`FILL_AREA_STYLE_COLOUR('',${colour})`)}))`);
    const side = add(`SURFACE_SIDE_STYLE('',(${add(`SURFACE_STYLE_FILL_AREA(${fill})`)}))`);
    const usage = add(`SURFACE_STYLE_USAGE(.BOTH.,${side})`);
    return add(
      `STYLED_ITEM('color',(${add(`PRESENTATION_STYLE_ASSIGNMENT((${usage}))`)}),${item})`,
    );
  };
  const styled = [style(color, solid)];
  if (topColor) styled.push(style(topColor, faceIds[1] as string));
  add(
    `MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${styled.join(',')}),${geometryContext})`,
  );

  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('boardui test box'),'2;1');",
    "FILE_NAME('box.step','2026-10-07T00:00:00',(''),(''),'boardui','boardui','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
