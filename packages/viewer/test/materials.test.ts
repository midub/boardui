import {
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  Texture,
} from 'three';
import { describe, expect, it } from 'vitest';
import { BoardMaterials, materialKey, XRAY_COPPER_OPACITY } from '../src/materials.js';
import { ElementState } from '../src/state.js';

const mesh = () => new Mesh(new BufferGeometry());
const copper = (values: MeshStandardMaterialParameters = {}) =>
  new MeshStandardMaterial({
    name: 'copper',
    color: 0xb87333,
    metalness: 1,
    roughness: 0.3,
    ...values,
  });

describe('board materials', () => {
  it('share one node material per source material and use, also between equal copies', () => {
    const materials = new BoardMaterials(new ElementState(10));
    const [a, b, c, d, e] = [mesh(), mesh(), mesh(), mesh(), mesh()];
    const source = copper();
    materials.layer(a, source, XRAY_COPPER_OPACITY);
    materials.layer(b, source, XRAY_COPPER_OPACITY);
    // Runtime models bring their own copies of a palette: equal materials share too.
    materials.layer(c, Object.assign(source.clone(), { name: 'other name' }), XRAY_COPPER_OPACITY);
    materials.layer(d, source); // another x-ray opacity
    materials.component(e, new MeshStandardMaterial({ color: 0x2b2b2b }));
    expect(a.material).toBe(b.material);
    expect(a.material).toBe(c.material);
    expect(a.material).not.toBe(d.material);
    expect(a.material).not.toBe(e.material);
    expect(a.material).not.toBe(source);
    expect(materials.size).toBe(3);
  });

  it('swap meshes to their x-ray variants and back without changing a material', () => {
    const materials = new BoardMaterials(new ElementState(10));
    const [layer, mask, overlay] = [mesh(), mesh(), mesh()];
    materials.layer(layer, copper(), XRAY_COPPER_OPACITY);
    materials.layer(mask, new MeshStandardMaterial({ opacity: 0.8, transparent: true }), 0.15, 4);
    materials.overlay(overlay, copper());
    const variants = [layer, mask, overlay].map((m) => materials.variants(m));
    const all = variants.flatMap((v) => (v ? [v.normal, v.xray] : []));
    const versions = all.map((m) => m.version);

    expect(layer.material).toBe(variants[0]?.normal);
    materials.setXray(true);
    expect([layer, mask, overlay].map((m) => m.material)).toEqual(variants.map((v) => v?.xray));
    materials.setXray(false);
    expect([layer, mask, overlay].map((m) => m.material)).toEqual(variants.map((v) => v?.normal));
    expect(all.map((m) => m.version)).toEqual(versions);

    const [l, k, o] = variants;
    // Normal: as the source; x-ray: translucent, without depth writes.
    expect([l?.normal.transparent, l?.normal.depthWrite]).toEqual([false, true]);
    expect([l?.xray.transparent, l?.xray.depthWrite]).toEqual([true, false]);
    expect([k?.normal.transparent, k?.xray.transparent]).toEqual([true, true]);
    // The mask's depth bias holds in both modes.
    for (const m of [k?.normal, k?.xray]) {
      expect([m?.polygonOffset, m?.polygonOffsetFactor, m?.polygonOffsetUnits]).toEqual([
        true,
        0,
        4,
      ]);
    }
    expect(l?.normal.polygonOffset).toBe(false);
    // The tint overlay is the same in both modes.
    expect(o?.xray).toBe(o?.normal);
    expect([o?.normal.transparent, o?.normal.depthWrite]).toEqual([true, false]);
  });

  it('give meshes assigned in x-ray mode their x-ray variant', () => {
    const materials = new BoardMaterials(new ElementState(10));
    materials.setXray(true);
    const m = mesh();
    materials.component(m, copper());
    expect(m.material).toBe(materials.variants(m)?.xray);
  });

  it('dispose a shared material when its last mesh is released', () => {
    const materials = new BoardMaterials(new ElementState(10));
    const [a, b] = [mesh(), mesh()];
    materials.component(a, copper());
    materials.component(b, copper());
    const variants = materials.variants(a);
    const disposed: string[] = [];
    variants?.normal.addEventListener('dispose', () => disposed.push('normal'));
    variants?.xray.addEventListener('dispose', () => disposed.push('xray'));
    materials.release(a);
    expect(disposed).toEqual([]);
    expect(materials.variants(a)).toBeUndefined();
    materials.release(b);
    expect(disposed).toEqual(['normal', 'xray']);
    expect(materials.size).toBe(0);
    materials.component(a, copper());
    expect(materials.variants(a)).not.toBe(variants);
  });
});

describe('materialKey', () => {
  it('is equal for materials that render alike', () => {
    expect(materialKey(copper())).toBe(materialKey(copper()));
    expect(materialKey(copper())).not.toBe(materialKey(copper({ roughness: 0.4 })));
    expect(materialKey(copper())).not.toBe(materialKey(copper({ color: 0xb87334 })));
    expect(materialKey(copper())).not.toBe(materialKey(copper({ side: DoubleSide })));
  });

  it('tells textures apart by identity', () => {
    const map = new Texture();
    expect(materialKey(copper({ map }))).toBe(materialKey(copper({ map })));
    expect(materialKey(copper({ map }))).not.toBe(materialKey(copper({ map: map.clone() })));
  });
});
