/**
 * 2D regions and their extrusion into closed prisms (spec §6.1).
 *
 * Regions are in IPC-2581 board coordinates (x right, y up, metres). A point `(x, y)` at height
 * `h` becomes the glTF position `(x, h, −y)` (spec §3).
 */
import { ShapeUtils, Vector2 } from 'three';

export type Vec2 = readonly [number, number];
/** A closed ring of points; the closing edge is implicit. */
export type Ring = readonly Vec2[];

/** A region: an outer ring with holes. */
export interface Region {
  outer: Ring;
  holes: Ring[];
}

/** Triangles of one feature, in glTF coordinates. */
export interface Part {
  positions: number[];
  indices: number[];
}

/** Axis-aligned rectangle centred on `(cx, cy)`. */
export function rect(cx: number, cy: number, width: number, height: number): Ring {
  const w = width / 2;
  const h = height / 2;
  return [
    [cx - w, cy - h],
    [cx + w, cy - h],
    [cx + w, cy + h],
    [cx - w, cy + h],
  ];
}

/**
 * Circle tessellated with a maximum chord deviation of `tolerance` and at least 8 segments
 * (spec §6.1).
 */
export function circle(cx: number, cy: number, radius: number, tolerance: number): Ring {
  const n = Math.max(8, Math.ceil(Math.PI / Math.acos(1 - Math.min(1, tolerance / radius))));
  return Array.from({ length: n }, (_, i): Vec2 => {
    const a = (2 * Math.PI * i) / n;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  });
}

/** Rotates a ring by `degrees` counter-clockwise about the origin, then moves it by `(dx, dy)`. */
export function place(ring: Ring, degrees: number, dx: number, dy: number): Ring {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return ring.map(([x, y]): Vec2 => [dx + x * c - y * s, dy + x * s + y * c]);
}

/** A region extruded from `zMin` to `zMax`. */
export function prism(region: Region, zMin: number, zMax: number): Part {
  return sheet([region], region, zMin, zMax);
}

/**
 * A region extruded from `zMin` to `zMax`, with caps triangulated piecewise. `caps` must tile
 * `walls` exactly, without T-junctions. Large sheets with many holes triangulate fast this way.
 */
export function sheet(caps: Region[], walls: Region, zMin: number, zMax: number): Part {
  const part: Part = { positions: [], indices: [] };
  let capRings: Ring[] = [];
  let capBase = 0;
  for (const cap of caps) {
    capRings = [oriented(cap.outer, true), ...cap.holes.map((h) => oriented(h, false))];
    capBase = addRings(part, capRings, zMin, zMax);
    const points = capRings.flat();
    const toVectors = (ring: Ring) => ring.map(([x, y]) => new Vector2(x, y));
    const [outer, ...holes] = capRings.map(toVectors);
    for (const face of ShapeUtils.triangulateShape(outer ?? [], holes)) {
      let [a, b, c] = face as [number, number, number];
      if (signedArea(points[a] as Vec2, points[b] as Vec2, points[c] as Vec2) < 0) {
        [b, c] = [c, b];
      }
      const bottom = capBase + points.length;
      part.indices.push(capBase + a, capBase + b, capBase + c, bottom + a, bottom + c, bottom + b);
    }
  }
  if (caps.length !== 1 || caps[0] !== walls) {
    capRings = [oriented(walls.outer, true), ...walls.holes.map((h) => oriented(h, false))];
    capBase = addRings(part, capRings, zMin, zMax);
  }
  const total = capRings.reduce((n, ring) => n + ring.length, 0);
  let start = capBase;
  for (const ring of capRings) {
    for (let i = 0; i < ring.length; i++) {
      const top = start + i;
      const nextTop = start + ((i + 1) % ring.length);
      // Outer rings run counter-clockwise and holes clockwise, so this faces away from the material.
      part.indices.push(top + total, nextTop + total, nextTop, top + total, nextTop, top);
    }
    start += ring.length;
  }
  return part;
}

/** Adds the top points of all rings, then their bottom points; returns the first vertex. */
function addRings(part: Part, rings: Ring[], zMin: number, zMax: number): number {
  const base = part.positions.length / 3;
  for (const z of [zMax, zMin]) {
    for (const ring of rings) {
      for (const [x, y] of ring) part.positions.push(x, z, -y);
    }
  }
  return base;
}

function oriented(ring: Ring, counterClockwise: boolean): Ring {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i] as Vec2;
    const [x1, y1] = ring[(i + 1) % ring.length] as Vec2;
    area += x0 * y1 - x1 * y0;
  }
  return area > 0 === counterClockwise ? ring : [...ring].reverse();
}

function signedArea(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
