/**
 * The STEP worker: reads STEP files with occt-import-js (OpenCascade in WebAssembly, LGPL-2.1),
 * loaded on the first request, and posts the meshes back (`step.ts`).
 */
import occtimportjs from '../occt/occt-import-js.mjs';
import { type Occt, readStep, type StepMesh, type StepTessellation } from './step-mesh.js';

/** A request from the main thread. */
export interface StepRequest {
  id: number;
  data: ArrayBuffer;
  tessellation: StepTessellation;
}

/** The answer to a {@link StepRequest}. */
export type StepResponse = { id: number; meshes: StepMesh[] } | { id: number; error: string };

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<StepRequest>) => void) | null;
  postMessage(message: StepResponse, transfer?: Transferable[]): void;
};

let occt: Promise<Occt> | null = null;

scope.onmessage = async ({ data: request }) => {
  try {
    const wasm = new URL('../occt/occt-import-js.wasm', import.meta.url).href;
    occt ??= occtimportjs({ locateFile: () => wasm }) as Promise<Occt>;
    const meshes = readStep(await occt, new Uint8Array(request.data), request.tessellation);
    const transfer = meshes.flatMap((m) => [m.positions.buffer, m.normals.buffer, m.index.buffer]);
    scope.postMessage({ id: request.id, meshes }, transfer);
  } catch (error) {
    scope.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
