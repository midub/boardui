import { type Box3, MathUtils, Vector3 } from 'three';

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
 * Distance from the centre of `box` at which a perspective camera, looking at that centre from
 * `direction`, sees the whole box.
 *
 * @param direction From the box centre towards the camera.
 * @param up The camera's up vector; must not be parallel to `direction`.
 * @param fov Vertical field of view in degrees.
 * @param aspect Viewport width / height.
 * @param margin Extra room around the box, as a factor of its projected size.
 */
export function fitBoxDistance(
  box: Box3,
  direction: Vector3,
  up: Vector3,
  fov: number,
  aspect: number,
  margin = 1.05,
): number {
  const back = direction.clone().normalize();
  const right = new Vector3().crossVectors(up, back).normalize();
  const top = new Vector3().crossVectors(back, right);
  const tanY = Math.tan(MathUtils.degToRad(fov) / 2);
  const tanX = tanY * aspect;
  const center = box.getCenter(new Vector3());
  const corner = new Vector3();
  let distance = 0;
  for (let i = 0; i < 8; i++) {
    corner
      .set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      )
      .sub(center);
    // The camera sits at `distance` along `back`; this corner lies `distance − z` in front of it.
    const z = corner.dot(back);
    const x = Math.abs(corner.dot(right)) * margin;
    const y = Math.abs(corner.dot(top)) * margin;
    distance = Math.max(distance, z + x / tanX, z + y / tanY);
  }
  return distance;
}
