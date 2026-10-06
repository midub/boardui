import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { fitBoxDistance, viewDirection } from '../src/camera.js';

/** Projects a point with a camera placed along a preset direction, looking at the origin. */
function screen(preset: 'top' | 'bottom', point: Vector3): Vector3 {
  const camera = new PerspectiveCamera(40, 1, 0.01, 100);
  camera.position.copy(viewDirection(preset).multiplyScalar(5));
  camera.lookAt(0, 0, 0); // up = +Y, as OrbitControls keeps it
  camera.updateMatrixWorld();
  return point.clone().project(camera);
}

describe('view presets', () => {
  it('show the top like ECAD: IPC +y (glTF −Z) up, +x right', () => {
    expect(screen('top', new Vector3(0, 0, -1)).y).toBeGreaterThan(0.1);
    expect(screen('top', new Vector3(1, 0, 0)).x).toBeGreaterThan(0.1);
  });

  it('show the bottom mirrored left–right', () => {
    expect(screen('bottom', new Vector3(0, 0, -1)).y).toBeGreaterThan(0.1);
    expect(screen('bottom', new Vector3(1, 0, 0)).x).toBeLessThan(-0.1);
  });

  it('look from above, below, or obliquely from the front', () => {
    expect(viewDirection('top').y).toBeCloseTo(1);
    expect(viewDirection('bottom').y).toBeCloseTo(-1);
    const iso = viewDirection('iso');
    expect(iso.length()).toBeCloseTo(1);
    expect(iso.y).toBeGreaterThan(0);
    expect(iso.z).toBeGreaterThan(0);
  });
});

describe('fitBoxDistance', () => {
  const up = new Vector3(0, 1, 0);

  it('backs off until the nearest face fits', () => {
    const cube = new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
    // 90° field of view: the front face (half size 0.5, 0.5 in front of the centre) needs 0.5 more.
    expect(fitBoxDistance(cube, new Vector3(0, 0, 1), up, 90, 1, 1)).toBeCloseTo(1);
    // A wide viewport has room to the sides, a tall one backs off further.
    const flat = new Box3(new Vector3(-2, -0.1, -1), new Vector3(2, 0.1, 1));
    const from = new Vector3(0, 0, 1);
    expect(fitBoxDistance(flat, from, up, 90, 2, 1)).toBeLessThan(
      fitBoxDistance(flat, from, up, 90, 1, 1),
    );
  });

  it('puts every corner of a board-shaped box inside the view, touching its edge', () => {
    const board = new Box3(new Vector3(0.01, -0.001, -0.08), new Vector3(0.11, 0.009, -0.02));
    for (const preset of ['top', 'bottom', 'iso'] as const) {
      const direction = viewDirection(preset);
      const camera = new PerspectiveCamera(35, 16 / 9, 1e-4, 10);
      const center = board.getCenter(new Vector3());
      const distance = fitBoxDistance(board, direction, up, camera.fov, camera.aspect, 1.1);
      camera.position.copy(center).addScaledVector(direction, distance);
      camera.lookAt(center);
      camera.updateMatrixWorld();
      let extent = 0;
      for (let i = 0; i < 8; i++) {
        const corner = new Vector3(
          i & 1 ? board.max.x : board.min.x,
          i & 2 ? board.max.y : board.min.y,
          i & 4 ? board.max.z : board.min.z,
        ).project(camera);
        extent = Math.max(extent, Math.abs(corner.x), Math.abs(corner.y));
      }
      expect(extent, preset).toBeLessThanOrEqual(1 / 1.1 + 1e-9);
      expect(extent, preset).toBeGreaterThan(0.85);
    }
  });
});
