/**
 * Board materials: the asset's materials as node materials, plus a TSL graph that reads the
 * element state texture (see `state.ts`). The same graph runs on WebGPU and on the WebGL2
 * fallback of `WebGPURenderer`.
 *
 * Meshes that render alike share their node materials: the graph reads each vertex's state
 * texel from the geometry ({@link STATE_ATTRIBUTE}), so it holds nothing per mesh, and three
 * builds each shader once. Every shared material has a normal and an x-ray variant; x-ray mode
 * swaps the meshes' materials, so toggling it rebuilds nothing.
 */
import { DataTexture, type Material, type Mesh, NearestFilter } from 'three';
import {
  attribute,
  int,
  ivec2,
  materialColor,
  materialEmissive,
  materialMetalness,
  mix,
  textureLoad,
  varying,
  vec4,
} from 'three/tsl';
import {
  MeshStandardNodeMaterial,
  type Node,
  type NodeMaterial,
  StandardNodeLibrary,
} from 'three/webgpu';
import { type ElementState, HIDDEN_ALPHA, STATE_ATTRIBUTE } from './state.js';

/** Opacity of board materials in x-ray mode. Tinted elements stay more opaque. */
export const XRAY_OPACITY = 0.15;
/** Opacity of copper in x-ray mode: x-ray is for seeing the copper of both sides. */
export const XRAY_COPPER_OPACITY = 0.6;
/** Share of the tint colour added as emission, so tints show on metal and in shadow. */
const TINT_GLOW = 0.35;

/** The two variants of a shared material. */
export interface MaterialVariants {
  readonly normal: NodeMaterial;
  /** Translucent, without depth writes; the same object as {@link normal} for an overlay. */
  readonly xray: NodeMaterial;
}

/** How a mesh uses a shared material. */
interface Use {
  readonly overlay: boolean;
  /** Opacity of untinted elements in x-ray mode. */
  readonly xrayOpacity: number;
  /** Constant depth bias (`polygonOffsetUnits`); 0 for none. */
  readonly depthBias: number;
}

interface Shared {
  readonly key: string;
  readonly variants: MaterialVariants;
  /** Meshes using the variants. */
  users: number;
}

/** Creates and owns the materials of one loaded board, shared between its meshes. */
export class BoardMaterials {
  /** The GPU copy of {@link ElementState.data}. */
  readonly texture: DataTexture;
  readonly #state: ElementState;
  readonly #library = new StandardNodeLibrary();
  readonly #shared = new Map<string, Shared>();
  readonly #meshes = new Map<Mesh, Shared>();
  #xray = false;
  #uploaded = -1;

  constructor(state: ElementState) {
    this.#state = state;
    this.texture = new DataTexture(state.data, state.width, state.height);
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.generateMipmaps = false;
  }

  /** Whether the meshes have their x-ray variants. */
  get xray(): boolean {
    return this.#xray;
  }

  /** Number of shared materials in use (each has two variants, an overlay one). */
  get size(): number {
    return this.#shared.size;
  }

  /**
   * Gives a merged layer mesh the shared material for `source`.
   *
   * @param xrayOpacity Opacity of untinted elements in x-ray mode.
   * @param depthBias Constant depth bias (`polygonOffsetUnits`), e.g. for the soldermask.
   */
  layer(mesh: Mesh, source: Material, xrayOpacity = XRAY_OPACITY, depthBias = 0): void {
    this.#assign(mesh, source, { overlay: false, xrayOpacity, depthBias });
  }

  /**
   * Gives a mesh the material that draws only the tinted elements of a layer mesh, in a second
   * pass after the translucent soldermask, so that tints under the mask stay visible. It is the
   * same in x-ray mode.
   */
  overlay(mesh: Mesh, source: Material): void {
    this.#assign(mesh, source, { overlay: true, xrayOpacity: 1, depthBias: 0 });
  }

  /** Gives a component batch the shared material for `source`. */
  component(mesh: Mesh, source: Material): void {
    this.#assign(mesh, source, { overlay: false, xrayOpacity: XRAY_OPACITY, depthBias: 0 });
  }

  /** The variants a mesh uses, or `undefined` if it has none from this object. */
  variants(mesh: Mesh): MaterialVariants | undefined {
    return this.#meshes.get(mesh)?.variants;
  }

  /**
   * Forgets a mesh, e.g. of a removed runtime model, and disposes its materials when no other
   * mesh uses them.
   */
  release(mesh: Mesh): void {
    const shared = this.#meshes.get(mesh);
    if (!shared) return;
    this.#meshes.delete(mesh);
    if (--shared.users > 0) return;
    this.#shared.delete(shared.key);
    shared.variants.normal.dispose();
    shared.variants.xray.dispose();
  }

  /**
   * Makes every board material translucent, or restores it, by swapping each mesh's material
   * for its other variant. Nothing is rebuilt once three has drawn (or compiled) both.
   */
  setXray(on: boolean): void {
    this.#xray = on;
    for (const [mesh, { variants }] of this.#meshes) {
      mesh.material = on ? variants.xray : variants.normal;
    }
  }

  /** Marks the state texture for upload if the state changed since the last call. */
  sync(): void {
    if (this.#uploaded !== this.#state.version) {
      this.#uploaded = this.#state.version;
      this.texture.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const { variants } of this.#shared.values()) {
      variants.normal.dispose();
      variants.xray.dispose();
    }
    this.#shared.clear();
    this.#meshes.clear();
    this.texture.dispose();
  }

  #assign(mesh: Mesh, source: Material, use: Use): void {
    this.release(mesh);
    const key = `${use.overlay ? 'overlay' : `${use.xrayOpacity}|${use.depthBias}`}|${materialKey(source)}`;
    let shared = this.#shared.get(key);
    if (!shared) {
      const normal = this.#create(source, use, false);
      const xray = use.overlay ? normal : this.#create(source, use, true);
      shared = { key, variants: { normal, xray }, users: 0 };
      this.#shared.set(key, shared);
    }
    shared.users++;
    this.#meshes.set(mesh, shared);
    mesh.material = this.#xray ? shared.variants.xray : shared.variants.normal;
  }

  #create(source: Material, use: Use, xray: boolean): NodeMaterial {
    const material = this.#library.fromMaterial(source.clone()) as NodeMaterial;
    const index = int(attribute<'float'>(STATE_ATTRIBUTE, 'float'));
    const width = int(this.#state.width);
    // Read the texel per vertex; all vertices of a triangle belong to one element.
    const state = varying(textureLoad(this.texture, ivec2(index.mod(width), index.div(width))));
    state.setInterpolation('flat');
    const strength = state.a.mul(255 / (HIDDEN_ALPHA - 1)).min(1);
    // `materialColor` is a vec3, or a vec4 when the material has a colour map.
    const base = vec4(materialColor as unknown as Node<'vec4'>);
    material.colorNode = vec4(mix(base.rgb, state.rgb, strength), base.a);
    if (material instanceof MeshStandardNodeMaterial) {
      material.emissiveNode = materialEmissive.add(state.rgb.mul(strength.mul(TINT_GLOW)));
      material.metalnessNode = materialMetalness.mul(strength.oneMinus());
    }
    const visible = state.a.lessThan((HIDDEN_ALPHA - 0.5) / 255);
    if (use.overlay) {
      material.transparent = true;
      material.depthWrite = false;
      material.opacityNode = strength;
      material.maskNode = visible.and(strength.greaterThan(0));
    } else if (xray) {
      material.transparent = true;
      material.depthWrite = false;
      material.opacityNode = mix(use.xrayOpacity, 1, strength);
      material.maskNode = visible;
    } else {
      material.maskNode = visible;
    }
    if (use.depthBias) {
      material.polygonOffset = true;
      material.polygonOffsetFactor = 0;
      material.polygonOffsetUnits = use.depthBias;
    }
    return material;
  }
}

/** Material properties that don't change how it renders. */
const IGNORED = new Set(['uuid', 'id', 'name', 'version', 'userData', '_listeners']);

/**
 * A key that is equal for materials that render alike, so that they share node materials:
 * runtime models bring their own copies of a small palette. Textures count by identity, and so
 * do properties of an unknown kind.
 */
export function materialKey(material: Material): string {
  const parts = [material.type];
  for (const [name, value] of Object.entries(material)) {
    if (IGNORED.has(name) || typeof value === 'function') continue;
    parts.push(`${name}:${valueKey(value) ?? material.uuid}`);
  }
  return parts.join(';');
}

function valueKey(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return String(value);
  const v = value as {
    isColor?: boolean;
    isTexture?: boolean;
    uuid?: string;
    r?: number;
    g?: number;
    b?: number;
    toArray?: () => unknown[];
  };
  if (v.isColor) return `${v.r},${v.g},${v.b}`;
  if (v.isTexture) return v.uuid;
  if (Array.isArray(value)) {
    const keys = value.map(valueKey);
    return keys.includes(undefined) ? undefined : `[${keys.join(',')}]`;
  }
  // Vectors and Euler angles.
  if (typeof v.toArray === 'function') return valueKey(v.toArray());
  // Plain objects, such as `defines`.
  if (Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value).map(([k, x]) => [k, valueKey(x)]);
    return entries.some(([, x]) => x === undefined)
      ? undefined
      : `{${entries.map(([k, x]) => `${k}=${x}`).join(',')}}`;
  }
  return undefined;
}
