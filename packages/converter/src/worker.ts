/**
 * The converter's Web Worker: loads the WASM module and runs conversions and validations for
 * the main-thread API (`index.ts`). One worker serves one request.
 */
import init, * as wasm from '../wasm/boardui_wasm.js';
import { bytesOf, convertBytes, validateBytes, type WorkerConvertOptions } from './core.js';
import type { ConvertProgress, ConvertResult, ValidationReport } from './types.js';

/** A request from the main thread. */
export type WorkerRequest =
  | { type: 'convert'; input: Blob | ArrayBuffer; options: WorkerConvertOptions }
  | { type: 'validate'; glb: ArrayBuffer };

/** A message to the main thread. */
export type WorkerResponse =
  | { type: 'progress'; progress: ConvertProgress }
  | { type: 'converted'; result: ConvertResult }
  | { type: 'validated'; report: ValidationReport }
  | { type: 'error'; message: string };

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

let ready: Promise<{ memory: WebAssembly.Memory }> | null = null;

scope.onmessage = async ({ data: request }) => {
  try {
    ready ??= init({ module_or_path: new URL('../wasm/boardui_wasm_bg.wasm', import.meta.url) });
    const { memory } = await ready;
    if (request.type === 'validate') {
      scope.postMessage({
        type: 'validated',
        report: validateBytes(wasm, new Uint8Array(request.glb)),
      });
      return;
    }
    const start = performance.now();
    const xml = await bytesOf(request.input);
    const converted = await convertBytes(wasm, xml, request.options, (progress) =>
      scope.postMessage({ type: 'progress', progress }),
    );
    const glb = converted.glb.buffer as ArrayBuffer;
    const result: ConvertResult = {
      ...converted,
      glb,
      seconds: (performance.now() - start) / 1000,
      wasmMemory: memory.buffer.byteLength,
    };
    scope.postMessage({ type: 'converted', result }, [glb]);
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
