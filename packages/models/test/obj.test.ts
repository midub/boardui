import type { MeshPhongMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { objLoader } from '../src/obj.js';

const OBJ = `# a quad in two colours, materials inline as EasyEDA writes them
newmtl body
Ka 0.2 0.2 0.2
Kd 0.1 0.1 0.1
endmtl
newmtl pins
Kd 0.8 0.7 0.5
d 1
endmtl
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
usemtl body
f 1 2 3
usemtl pins
f 1 3 4
`;

describe('objLoader', () => {
  it('reads an OBJ with inline materials, one part per material', async () => {
    const data = new TextEncoder().encode(OBJ).buffer;
    const signal = new AbortController().signal;
    const { parts } = await objLoader().load(data, { ref: { key: 'k', format: 'obj' }, signal });
    const colors = parts.map((p) => [
      p.material.name,
      (p.material as MeshPhongMaterial).color.getHexString(),
    ]);
    expect(colors).toEqual([
      ['body', '1a1a1a'],
      ['pins', 'ccb380'],
    ]);
    expect(parts.map((p) => p.geometry.drawRange.count)).toEqual([3, 3]);
  });
});
