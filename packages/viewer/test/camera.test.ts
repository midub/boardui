import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { fitDistance, viewDirection } from '../src/camera.js';

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

describe('fitDistance', () => {
  it('fits a sphere into the narrower field of view', () => {
    // 90° vertical, square viewport: the sphere touches the frustum at r / sin(45°).
    expect(fitDistance(1, 90, 1, 1)).toBeCloseTo(Math.SQRT2);
    // A tall viewport narrows the horizontal field of view, so the camera backs off.
    expect(fitDistance(1, 90, 0.5, 1)).toBeGreaterThan(fitDistance(1, 90, 1, 1));
    expect(fitDistance(1, 90, 2, 1)).toBeCloseTo(Math.SQRT2);
    expect(fitDistance(2, 90, 1)).toBeCloseTo(2 * Math.SQRT2 * 1.05);
  });
});
