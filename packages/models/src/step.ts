/**
 * `stepLoader`: STEP models, read by OpenCascade (occt-import-js) in a Web Worker that starts
 * with the first STEP file and stops when idle.
 */
import type { ModelLoader, ModelPart } from '@boardui/viewer';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LinearSRGBColorSpace,
  MeshStandardMaterial,
} from 'three';
import type { StepRequest, StepResponse } from './step.worker.js';
import type { StepMesh, StepTessellation } from './step-mesh.js';

export interface StepLoaderOptions extends Partial<StepTessellation> {
  /** Milliseconds without work after which the worker (and its 30 MB+ of WebAssembly memory) goes. */
  idleTimeout?: number;
  /**
   * Starts the worker. Default: `step.worker.js` of this package, which loads
   * `../occt/occt-import-js.wasm`; apps whose build tool doesn't bundle workers serve both.
   */
  createWorker?: () => Worker;
}

/** Default tessellation: 0.02 mm from the surface, 0.5 rad (≈ 29°) between facets. */
export const STEP_TESSELLATION: StepTessellation = {
  linearDeflection: 0.02,
  angularDeflection: 0.5,
};
/** Default {@link StepLoaderOptions.idleTimeout}. */
const IDLE_TIMEOUT = 15_000;
/** Bumped when the loader's output changes; with the tessellation, part of the cache version. */
const OUTPUT_VERSION = 1;
/** Colour of faces without one. */
const DEFAULT_COLOR = new Color(0.6, 0.6, 0.6);

/** A {@link ModelLoader} for STEP that can stop its worker. */
export interface StepLoader extends ModelLoader {
  /** Stops the worker now; the next file starts it again. */
  dispose(): void;
}

/**
 * Loads STEP files (AP203/AP214/AP242) in a worker with occt-import-js, keeping face colours;
 * the viewer caches the tessellated result. The worker and its WebAssembly module (7.6 MB, about
 * 3 MB compressed) are loaded only when the first STEP file is read.
 *
 * Models are taken as Z-up in millimetres, the convention of ECAD STEP models (KiCad's among
 * them), and delivered Y-up in metres: (x, y, z) mm → (x, z, −y) m.
 */
export function stepLoader(options: StepLoaderOptions = {}): StepLoader {
  const tessellation: StepTessellation = {
    linearDeflection: options.linearDeflection ?? STEP_TESSELLATION.linearDeflection,
    angularDeflection: options.angularDeflection ?? STEP_TESSELLATION.angularDeflection,
  };
  const idleTimeout = options.idleTimeout ?? IDLE_TIMEOUT;
  const create =
    options.createWorker ??
    (() =>
      new Worker(new URL('./step.worker.js', import.meta.url), {
        type: 'module',
        name: 'boardui-step',
      }));
  let worker: Worker | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (meshes: StepMesh[]) => void; reject: (error: Error) => void }
  >();

  const stop = () => {
    if (idle !== null) clearTimeout(idle);
    idle = null;
    worker?.terminate();
    worker = null;
    for (const { reject } of pending.values()) reject(new Error('The STEP worker was stopped'));
    pending.clear();
  };
  const settle = (id: number) => {
    const entry = pending.get(id);
    pending.delete(id);
    if (!pending.size) idle = setTimeout(stop, idleTimeout);
    return entry;
  };
  const start = (): Worker => {
    if (idle !== null) clearTimeout(idle);
    idle = null;
    if (worker) return worker;
    const started = create();
    started.onmessage = ({ data }: MessageEvent<StepResponse>) => {
      const entry = settle(data.id);
      if ('error' in data) entry?.reject(new Error(data.error));
      else entry?.resolve(data.meshes);
    };
    started.onerror = (event) => {
      event.preventDefault?.();
      const error = new Error(event.message || 'The STEP worker failed');
      worker = null;
      started.terminate();
      for (const { reject } of pending.values()) reject(error);
      pending.clear();
    };
    worker = started;
    return started;
  };

  return {
    cacheVersion: `step-${OUTPUT_VERSION}/${tessellation.linearDeflection}/${tessellation.angularDeflection}`,
    dispose: stop,
    load(data, { signal }) {
      signal.throwIfAborted();
      const id = nextId++;
      const meshes = new Promise<StepMesh[]>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const request: StepRequest = { id, data, tessellation };
        // The viewer keeps no copy of the file: transfer it.
        start().postMessage(request, [data]);
      });
      return meshes.then((list) => ({ parts: list.map(stepPart) }));
    },
  };
}

/** A mesh from the worker as a part with a standard material. */
export function stepPart(mesh: StepMesh): ModelPart {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  if (mesh.normals.length) geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  else geometry.computeVertexNormals();
  geometry.setIndex(new BufferAttribute(mesh.index, 1));
  const color = mesh.color
    ? new Color().setRGB(mesh.color[0], mesh.color[1], mesh.color[2], LinearSRGBColorSpace)
    : DEFAULT_COLOR.clone();
  return { geometry, material: new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 }) };
}
