/**
 * Runtime model sources (spec/README.md, "Runtime models"): what a source returns for a
 * component, the format loaders, and the transform of a model into the package frame.
 */
import {
  BufferGeometry,
  Euler,
  LoaderUtils,
  type Material,
  Matrix4,
  type Mesh,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { loadGltf } from './load.js';

/** A component as a {@link ModelSource} sees it. */
export interface ModelComponent {
  /** Element ID, e.g. `cmp/C25` (spec §5). */
  readonly id: string;
  readonly refDes: string;
  /** IPC-2581 `Component@part`, e.g. `Capacitor_SMD_C_0402_1005Metric_100nF` from KiCad. */
  readonly part: string;
  /** IPC-2581 `Package@name`, e.g. `C_0402_1005Metric_2` from KiCad. */
  readonly package: string;
  readonly side: string;
  /** `SMT`, `THMT`, `PRESSFIT` or `OTHER`. */
  readonly mount: string;
  /** BOM attributes (`extras.boardui.attributes`, spec §8.4), e.g. `LCSC`, `MPN`; `{}` if none. */
  readonly attributes: Readonly<Record<string, string>>;
}

/** The board as a {@link ModelSource} sees it. */
export interface ModelBoard {
  readonly profileVersion: string;
  /** `BOARDUI_board.source` (spec §8.3); `software` is absent before profile 0.8. */
  readonly source: {
    readonly format: string;
    readonly sha256: string;
    readonly software?: {
      readonly name: string;
      readonly revision?: string;
      readonly vendor?: string;
    };
  };
}

/** Credit for models: shown by apps, for example next to the board. */
export interface ModelAttribution {
  /** E.g. `KiCad libraries`. */
  readonly text: string;
  readonly url?: string;
  /** Licence name, e.g. `CC-BY-SA 4.0 with an exception for designs`. */
  readonly license?: string;
}

/** Formats with a loader: `glb` and `gltf` are built in, the others need {@link registerModelLoader}. */
export type ModelFormat = 'glb' | 'gltf' | 'step' | 'obj' | (string & {});

/**
 * Where a model goes in the package frame, with the semantics of the model mapping file (spec
 * §6.9): scale, then rotation about the model's X, then Y, then Z axis (fixed axes), then
 * translation. Loaders deliver models Y-up in metres (STEP: converted from Z-up millimetres).
 */
export interface ModelTransform {
  /** Translation in millimetres. */
  readonly offsetMm?: readonly [number, number, number];
  /** Rotation about X, then Y, then Z (fixed axes), in degrees. */
  readonly rotationDeg?: readonly [number, number, number];
  /** Uniform scale, or per axis. */
  readonly scale?: number | readonly [number, number, number];
  /**
   * A 4×4 column-major matrix from the model's frame to the package frame (metres, Y up). When
   * set, it is used instead of the other fields.
   */
  readonly matrix?: ArrayLike<number>;
}

/** A model found by a {@link ModelSource}. */
export interface ModelRef {
  /**
   * Identifies the model's content: components with the same key share one load and one
   * geometry, and the persistent cache stores an {@link immutable} model under it.
   */
  readonly key: string;
  readonly format: ModelFormat;
  /** URL of the file; the viewer fetches it. Either this or {@link load}. */
  readonly url?: string;
  /**
   * Loads the file's bytes, for sources that fetch it themselves (e.g. to limit their request
   * rate); `null` if it doesn't exist.
   */
  readonly load?: (signal: AbortSignal) => Promise<ArrayBuffer | null>;
  /** Into the package frame; default identity (the model follows spec §6.9's conventions). */
  readonly transform?: ModelTransform;
  /**
   * The content behind the key never changes (e.g. a file at a git tag): the model, or its
   * absence (HTTP 404), goes into the persistent cache, which never asks again. Other models are
   * fetched on every load, through the browser's HTTP cache.
   */
  readonly immutable?: boolean;
  readonly attribution?: ModelAttribution;
}

/**
 * Finds models for components, e.g. in KiCad's library or on your own server
 * (`@boardui/models`). The viewer tries its sources in order for every component that has a
 * placeholder body; the first that resolves to a model that loads wins.
 */
export interface ModelSource {
  /** Shown in status and events, e.g. `KiCad`. */
  readonly name: string;
  readonly attribution?: ModelAttribution;
  /**
   * The model for a component, or `null` if the source has none. Rejecting counts as a failure
   * of this source for the component; the next source is tried either way.
   */
  resolve(
    component: ModelComponent,
    board: ModelBoard,
    signal: AbortSignal,
  ): Promise<ModelRef | null>;
}

/** One mesh of a loaded model: geometry in the model's frame and its material. */
export interface ModelPart {
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

/** What a {@link ModelLoader} makes of a file. */
export interface ModelGeometry {
  readonly parts: readonly ModelPart[];
}

/** Turns a file into geometry. */
export interface ModelLoader {
  /**
   * Parses a file. Geometry is in the model conventions of spec §6.9 (Y up, metres), before
   * {@link ModelRef.transform}.
   */
  load(
    data: ArrayBuffer,
    context: { readonly ref: ModelRef; readonly signal: AbortSignal },
  ): Promise<ModelGeometry>;
  /**
   * Set when parsing is expensive (STEP): the viewer then caches the parsed geometry (only
   * position, normal, colour and uv attributes and the materials' colour, opacity, metalness and
   * roughness) under this version instead of the file. Bump it when the output changes.
   */
  readonly cacheVersion?: string | number;
}

const loaders = new Map<string, ModelLoader>();

/**
 * Registers the loader of a format for every `<board-viewer>`, e.g.
 * `registerModelLoader('step', stepLoader())` from `@boardui/models`. Replaces a loader
 * registered before, built-in ones (`glb`, `gltf`) too.
 */
export function registerModelLoader(format: ModelFormat, loader: ModelLoader): void {
  loaders.set(format, loader);
}

/** The loader of a format, or `undefined`. */
export function modelLoader(format: ModelFormat): ModelLoader | undefined {
  return loaders.get(format);
}

/**
 * Loads glTF and GLB with three's `GLTFLoader`: the default scene, flattened into one mesh per
 * primitive with the node transforms baked in (as the converter does with user models, §6.9).
 * Skins, morph targets, animations, cameras and lights are dropped.
 */
export const gltfLoader: ModelLoader = {
  async load(data, { ref }) {
    const gltf = await loadGltf(data, undefined, ref.url && LoaderUtils.extractUrlBase(ref.url));
    return { parts: flatten(gltf.scene) };
  },
};

registerModelLoader('glb', gltfLoader);
registerModelLoader('gltf', gltfLoader);

/** The meshes of a scene as parts, with world transforms baked into their geometry. */
export function flatten(scene: Object3D): ModelPart[] {
  scene.updateMatrixWorld(true);
  const parts: ModelPart[] = [];
  scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const geometry = (mesh.geometry as BufferGeometry).clone();
    geometry.morphAttributes = {};
    for (const name of ['skinIndex', 'skinWeight']) geometry.deleteAttribute(name);
    geometry.applyMatrix4(mesh.matrixWorld);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.length === 1 || !geometry.groups.length) {
      parts.push({ geometry, material: materials[0] as Material });
      return;
    }
    for (const group of geometry.groups) {
      const part = new BufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        part.setAttribute(name, attribute);
      }
      const index = geometry.index;
      if (index) part.setIndex(index.clone());
      part.setDrawRange(group.start, group.count);
      parts.push({ geometry: part, material: materials[group.materialIndex ?? 0] as Material });
    }
  });
  return parts;
}

const DEG = Math.PI / 180;

/** The matrix of a {@link ModelTransform}: from the model's frame to the package frame. */
export function transformMatrix(
  transform: ModelTransform | undefined,
  target = new Matrix4(),
): Matrix4 {
  if (!transform) return target.identity();
  if (transform.matrix) return target.fromArray(Array.from(transform.matrix));
  const [ox, oy, oz] = transform.offsetMm ?? [0, 0, 0];
  const [rx, ry, rz] = transform.rotationDeg ?? [0, 0, 0];
  const s = transform.scale ?? 1;
  const scale = typeof s === 'number' ? new Vector3(s, s, s) : new Vector3(...s);
  // Fixed axes X, then Y, then Z: R = Rz · Ry · Rx, three's Euler order 'ZYX'.
  const rotation = new Quaternion().setFromEuler(new Euler(rx * DEG, ry * DEG, rz * DEG, 'ZYX'));
  return target.compose(new Vector3(ox * 1e-3, oy * 1e-3, oz * 1e-3), rotation, scale);
}
