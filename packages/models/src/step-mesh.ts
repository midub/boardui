/**
 * Turns the result of occt-import-js into meshes per colour, Y-up in metres. Used by the STEP
 * worker; free of DOM and three.js so that it runs anywhere.
 */

/** The tessellation settings (see `stepLoader`). */
export interface StepTessellation {
  /** Largest distance between the mesh and the surface, in millimetres. */
  readonly linearDeflection: number;
  /** Largest angle between neighbouring facets, in radians. */
  readonly angularDeflection: number;
}

/** occt-import-js's `ReadStepFile` result (the parts used here). */
export interface OcctResult {
  success: boolean;
  meshes: {
    color?: readonly number[];
    brep_faces?: { first: number; last: number; color: readonly number[] | null }[];
    attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } };
    index: { array: ArrayLike<number> };
  }[];
}

/** occt-import-js's module (the parts used here). */
export interface Occt {
  ReadStepFile(content: Uint8Array, params: Record<string, unknown> | null): OcctResult;
}

/** A mesh of one colour: positions and normals Y-up in metres, 32-bit indices. */
export interface StepMesh {
  /**
   * Linear RGB `0…1`, as OpenCascade reports it (it reads the file's `COLOUR_RGB` as sRGB);
   * `null` where the file has no colour.
   */
  color: [number, number, number] | null;
  positions: Float32Array;
  normals: Float32Array;
  index: Uint32Array;
}

/** Parameters of `ReadStepFile` for the tessellation. */
export function occtParams(tessellation: StepTessellation): Record<string, unknown> {
  return {
    linearUnit: 'millimeter',
    linearDeflectionType: 'absolute_value',
    linearDeflection: tessellation.linearDeflection,
    angularDeflection: tessellation.angularDeflection,
  };
}

/**
 * Reads a STEP file and groups its triangles by face colour. Converts KiCad's (and most ECAD
 * models') frame, Z up in millimetres, to Y up in metres: (x, y, z) mm → (x, z, −y) m.
 *
 * @throws if the file can't be read.
 */
export function readStep(occt: Occt, data: Uint8Array, tessellation: StepTessellation): StepMesh[] {
  const result = occt.ReadStepFile(data, occtParams(tessellation));
  if (!result.success) throw new Error('Not a readable STEP file');
  /** Triangles (as index triples) per colour key. */
  const groups = new Map<
    string,
    {
      color: StepMesh['color'];
      parts: { mesh: OcctResult['meshes'][number]; first: number; last: number }[];
    }
  >();
  const add = (
    color: readonly number[] | null | undefined,
    mesh: OcctResult['meshes'][number],
    first: number,
    last: number,
  ) => {
    const rgb =
      color && color.length >= 3
        ? ([color[0], color[1], color[2]] as [number, number, number])
        : null;
    const key = rgb ? rgb.map((c) => c.toFixed(4)).join(',') : 'none';
    let group = groups.get(key);
    if (!group) {
      group = { color: rgb, parts: [] };
      groups.set(key, group);
    }
    group.parts.push({ mesh, first, last });
  };
  for (const mesh of result.meshes) {
    const triangles = mesh.index.array.length / 3;
    const faces = mesh.brep_faces ?? [];
    if (!faces.length) {
      add(mesh.color, mesh, 0, triangles - 1);
      continue;
    }
    for (const face of faces) add(face.color ?? mesh.color, mesh, face.first, face.last);
  }
  return [...groups.values()].map(({ color, parts }) => {
    let triangles = 0;
    for (const { first, last } of parts) triangles += last - first + 1;
    const index = new Uint32Array(triangles * 3);
    // Vertices are copied per mesh as they are first used.
    const positions: number[] = [];
    const normals: number[] = [];
    let at = 0;
    const remaps = new Map<OcctResult['meshes'][number], Int32Array>();
    for (const { mesh, first, last } of parts) {
      const source = mesh.attributes.position.array;
      const sourceNormals = mesh.attributes.normal?.array;
      let remap = remaps.get(mesh);
      if (!remap) {
        remap = new Int32Array(source.length / 3).fill(-1);
        remaps.set(mesh, remap);
      }
      for (let t = first; t <= last; t++) {
        for (let k = 0; k < 3; k++) {
          const v = mesh.index.array[t * 3 + k] as number;
          let mapped = remap[v] as number;
          if (mapped < 0) {
            mapped = positions.length / 3;
            remap[v] = mapped;
            const x = source[v * 3] as number;
            const y = source[v * 3 + 1] as number;
            const z = source[v * 3 + 2] as number;
            positions.push(x * 1e-3, z * 1e-3, -y * 1e-3);
            if (sourceNormals) {
              normals.push(
                sourceNormals[v * 3] as number,
                sourceNormals[v * 3 + 2] as number,
                -(sourceNormals[v * 3 + 1] as number),
              );
            }
          }
          index[at++] = mapped;
        }
      }
    }
    return {
      color,
      positions: Float32Array.from(positions),
      normals:
        normals.length === positions.length ? Float32Array.from(normals) : new Float32Array(0),
      index,
    };
  });
}
