/**
 * Board materials: the asset's materials as node materials, plus a TSL graph that reads the
 * element state texture (see `state.ts`). The same graph runs on WebGPU and on the WebGL2
 * fallback of `WebGPURenderer`.
 */
import { DataTexture, InstancedBufferAttribute, type Material, NearestFilter } from 'three';
import {
  attribute,
  instancedBufferAttribute,
  int,
  ivec2,
  materialColor,
  materialEmissive,
  materialMetalness,
  materialOpacity,
  mix,
  textureLoad,
  uniform,
  varying,
  vec4,
} from 'three/tsl';
import {
  MeshStandardNodeMaterial,
  type Node,
  type NodeMaterial,
  StandardNodeLibrary,
} from 'three/webgpu';
import { type ElementState, HIDDEN_ALPHA } from './state.js';

/** Opacity of board materials in x-ray mode. Tinted elements stay more opaque. */
export const XRAY_OPACITY = 0.15;
/** Opacity of copper in x-ray mode: x-ray is for seeing the copper of both sides. */
export const XRAY_COPPER_OPACITY = 0.6;
/** Share of the tint colour added as emission, so tints show on metal and in shadow. */
const TINT_GLOW = 0.35;

interface Entry {
  readonly material: NodeMaterial;
  readonly transparent: boolean;
  readonly depthWrite: boolean;
}

/** Creates and owns the materials of one loaded board. */
export class BoardMaterials {
  /** The GPU copy of {@link ElementState.data}. */
  readonly texture: DataTexture;
  readonly #state: ElementState;
  readonly #library = new StandardNodeLibrary();
  readonly #xray = uniform(0);
  readonly #entries: Entry[] = [];
  #uploaded = -1;

  constructor(state: ElementState) {
    this.#state = state;
    this.texture = new DataTexture(state.data, state.width, state.height);
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.generateMipmaps = false;
  }

  /**
   * Material for a merged layer mesh whose feature rows start at state texel `offset`.
   *
   * @param xrayOpacity Opacity of untinted elements in x-ray mode.
   */
  layer(source: Material, offset: number, xrayOpacity = XRAY_OPACITY): NodeMaterial {
    const index = attribute<'float'>('_feature_id_0', 'float').add(offset);
    return this.#create(source, index, false, xrayOpacity);
  }

  /**
   * Material that draws only the tinted elements of a layer mesh, in a second pass after the
   * translucent soldermask, so that tints under the mask stay visible.
   */
  overlay(source: Material, offset: number): NodeMaterial {
    return this.#create(source, attribute<'float'>('_feature_id_0', 'float').add(offset), true);
  }

  /** Material for a component batch; `rows` holds each instance's component row. */
  components(source: Material, rows: Uint32Array, offset: number): NodeMaterial {
    const attribute = new InstancedBufferAttribute(Float32Array.from(rows), 1);
    return this.#create(source, instancedBufferAttribute<'float'>(attribute, 'float').add(offset));
  }

  /** Makes every board material translucent, or restores it. */
  setXray(on: boolean): void {
    this.#xray.value = on ? 1 : 0;
    for (const { material, transparent, depthWrite } of this.#entries) {
      material.transparent = on || transparent;
      material.depthWrite = !on && depthWrite;
      material.needsUpdate = true;
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
    for (const { material } of this.#entries) material.dispose();
    this.texture.dispose();
  }

  #create(
    source: Material,
    stateIndex: Node<'float'>,
    overlay = false,
    xrayOpacity = XRAY_OPACITY,
  ): NodeMaterial {
    const material = this.#library.fromMaterial(source.clone()) as NodeMaterial;
    const index = int(stateIndex);
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
    if (overlay) {
      material.transparent = true;
      material.depthWrite = false;
      material.opacityNode = strength;
      material.maskNode = visible.and(strength.greaterThan(0));
    } else {
      material.opacityNode = mix(materialOpacity, mix(xrayOpacity, 1, strength), this.#xray);
      material.maskNode = visible;
    }
    this.#entries.push({
      material,
      transparent: material.transparent,
      depthWrite: material.depthWrite,
    });
    return material;
  }
}
