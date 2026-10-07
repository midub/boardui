import {
  Box3,
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  type BodyGroup,
  batchBodies,
  type ComponentBatch,
  MERGE_MAX_COPIED_VERTICES,
  MergedBatch,
} from '../src/bodies.js';
import { STATE_ATTRIBUTE } from '../src/state.js';

const OFFSET = 100;
const material = new MeshStandardMaterial({ name: 'body' });
const at = (x: number, z = 0) => new Matrix4().makeTranslation(x, 0.5, z);

/** Rows hit by a ray straight down at `x` (off the boxes' diagonals). */
function hits(batch: ComponentBatch, x: number): number[] {
  const raycaster = new Raycaster(new Vector3(x, 10, 0.1), new Vector3(0, -1, 0));
  const rows: number[] = [];
  batch.raycast(raycaster, (row) => rows.push(row));
  return rows;
}

describe('merged component batches', () => {
  const box = new BoxGeometry(1, 1, 1);
  const small = new BoxGeometry(0.5, 0.5, 0.5).toNonIndexed();
  const groups: BodyGroup[] = [
    { geometry: box, material, rows: [0, 2], matrices: [at(0), at(3)] },
    { geometry: small, material, rows: [1], matrices: [at(6)] },
  ];

  it('bake the instances in board coordinates, with a state texel per vertex', () => {
    const batch = new MergedBatch(groups, OFFSET);
    const geometry = batch.mesh.geometry;
    const vertices = box.getAttribute('position').count;
    expect(batch.mesh).not.toBeInstanceOf(InstancedMesh);
    expect(geometry.getAttribute('position').count).toBe(2 * vertices + 36);
    expect(geometry.getAttribute('normal').count).toBe(2 * vertices + 36);
    const texels = geometry.getAttribute(STATE_ATTRIBUTE);
    expect([texels.getX(0), texels.getX(vertices), texels.getX(2 * vertices)]).toEqual([
      OFFSET,
      OFFSET + 2,
      OFFSET + 1,
    ]);
    expect(geometry.index?.count).toBe(2 * (box.index?.count ?? 0) + 36);
    expect([...batch.rows]).toEqual([0, 2, 1]);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox?.min.toArray()).toEqual([-0.5, 0, -0.5]);
    expect(geometry.boundingBox?.max.toArray()).toEqual([6.25, 1, 0.5]);
  });

  it('pick and bound each instance, and leave out filtered ones', () => {
    const batch = new MergedBatch(groups, OFFSET);
    expect(hits(batch, 0)).toEqual([0]); // the top face only: the bottom one faces away
    expect(hits(batch, 3.2)).toEqual([2]);
    expect(hits(batch, 6.05)).toEqual([1]);
    expect(hits(batch, 4.5)).toEqual([]);
    const bounds = [new Box3(), new Box3(), new Box3()];
    batch.addBounds(bounds);
    expect(bounds[2]?.min.toArray()).toEqual([2.5, 0, -0.5]);

    batch.filter((row) => row !== 2);
    expect([...batch.rows]).toEqual([0, 1]);
    expect(hits(batch, 3.2)).toEqual([]);
    expect(batch.mesh.geometry.drawRange.count).toBe((box.index?.count ?? 0) + 36);
    expect(batch.mesh.geometry.boundingBox?.max.x).toBe(6.25);
    batch.filter((row) => row === 2);
    expect([...batch.rows]).toEqual([2]);
    expect(batch.mesh.geometry.boundingBox?.min.x).toBe(2.5);
    batch.filter(() => false);
    expect(batch.mesh.visible).toBe(false);
    batch.filter(() => true);
    expect(batch.mesh.visible).toBe(true);
    expect(batch.mesh.geometry.drawRange.count).toBe(2 * (box.index?.count ?? 0) + 36);
    expect(hits(batch, 3.2)).toEqual([2]);
  });

  it('keep the triangles facing out under a mirroring matrix', () => {
    const mirror = at(0).multiply(new Matrix4().makeScale(1, -1, 1));
    const batch = new MergedBatch([{ geometry: box, material, rows: [0], matrices: [mirror] }], 0);
    const position = batch.mesh.geometry.getAttribute('position');
    const normal = batch.mesh.geometry.getAttribute('normal');
    const index = batch.mesh.geometry.index;
    const [a, b, c, n] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
    for (let i = 0; i < (index?.count ?? 0); i += 3) {
      a.fromBufferAttribute(position, index?.getX(i) ?? 0);
      b.fromBufferAttribute(position, index?.getX(i + 1) ?? 0);
      c.fromBufferAttribute(position, index?.getX(i + 2) ?? 0);
      n.fromBufferAttribute(normal, index?.getX(i) ?? 0);
      const face = b.sub(a).cross(c.sub(a));
      expect(face.dot(n), `triangle ${i / 3}`).toBeGreaterThan(0);
    }
    expect(hits(batch, 0)).toEqual([0]);
  });
});

describe('batchBodies', () => {
  it('merges per material and vertex layout, and instances large repeated meshes', () => {
    const other = new MeshStandardMaterial({ name: 'pin1' });
    const big = new BoxGeometry(1, 1, 1, 64, 64, 64);
    const vertices = big.getAttribute('position').count;
    const copies = Math.floor(MERGE_MAX_COPIED_VERTICES / vertices) + 2;
    const batches = batchBodies(
      [
        { geometry: new BoxGeometry(), material, rows: [0], matrices: [at(0)] },
        { geometry: new BoxGeometry(), material: other, rows: [0], matrices: [at(0)] },
        {
          geometry: new BoxGeometry().deleteAttribute('uv'),
          material,
          rows: [1],
          matrices: [at(1)],
        },
        { geometry: new BoxGeometry(2, 2, 2), material, rows: [2, 3], matrices: [at(2), at(3)] },
        {
          geometry: big,
          material,
          rows: Array.from({ length: copies }, (_, i) => i),
          matrices: Array.from({ length: copies }, (_, i) => at(i)),
        },
        // Used once: merged however large.
        { geometry: big, material: other, rows: [4], matrices: [at(4)] },
      ],
      OFFSET,
    );
    expect(batches.map((b) => [b.mesh.constructor.name, b.mesh.material, [...b.rows]])).toEqual([
      ['Mesh', material, [0, 2, 3]],
      ['Mesh', other, [0, 4]],
      ['Mesh', material, [1]],
      ['InstancedMesh', material, Array.from({ length: copies }, (_, i) => i)],
    ]);
    const instanced = batches[3]?.mesh as InstancedMesh;
    // The instanced batch reads its texels per instance from its own copy of the geometry.
    expect(instanced.geometry).not.toBe(big);
    expect(big.hasAttribute(STATE_ATTRIBUTE)).toBe(false);
    expect(instanced.geometry.getAttribute(STATE_ATTRIBUTE).getX(3)).toBe(OFFSET + 3);
    expect(instanced.geometry.getAttribute('position')).toBe(big.getAttribute('position'));
  });
});
