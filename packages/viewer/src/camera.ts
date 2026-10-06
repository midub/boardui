import { MathUtils, Vector3 } from 'three';

/** Camera presets: straight from above or below, or an oblique view. */
export type ViewPreset = 'top' | 'bottom' | 'iso';

/**
 * Direction from the orbit target to the camera for a preset. The orbit axis is +Y, so the top
 * and bottom views lean by a hair to fix the screen orientation: the top view shows the board as
 * in ECAD (−Z, the IPC-2581 +y, points up the screen, spec §3); the bottom view is mirrored
 * left–right, as if the board were flipped about its vertical axis.
 */
export function viewDirection(preset: ViewPreset, target = new Vector3()): Vector3 {
  switch (preset) {
    case 'top':
      return target.set(0, 1, 1e-4).normalize();
    case 'bottom':
      return target.set(0, -1, -1e-4).normalize();
    case 'iso':
      return target.set(0.35, 1, 0.9).normalize();
  }
}

/**
 * Distance from which a perspective camera sees a sphere whole.
 *
 * @param radius Sphere radius.
 * @param fov Vertical field of view in degrees.
 * @param aspect Viewport width / height.
 * @param margin Extra room around the sphere, as a factor.
 */
export function fitDistance(radius: number, fov: number, aspect: number, margin = 1.05): number {
  const halfY = MathUtils.degToRad(fov) / 2;
  const halfX = Math.atan(Math.tan(halfY) * aspect);
  return (margin * radius) / Math.sin(Math.min(halfX, halfY));
}
