/**
 * @boardui/converter: converts IPC-2581 to boardui glTF (spec/README.md) in the browser. The
 * Rust converter (`crates/boardui-wasm`) runs as WebAssembly in a Web Worker: the input is
 * transferred in, progress events stream out, and the GLB is transferred back. Nothing leaves
 * the machine.
 *
 * @example
 * ```ts
 * import { convertIpc2581 } from '@boardui/converter';
 *
 * const { glb, warnings } = await convertIpc2581(file, {
 *   onProgress: ({ step, fraction }) => console.log(step, fraction),
 * });
 * ```
 */
import type { WorkerConvertOptions } from './core.js';
import type {
  ConvertOptions,
  ConvertProgress,
  ConvertResult,
  ModelFile,
  ModelsInput,
  ValidationReport,
} from './types.js';
import type { WorkerRequest, WorkerResponse } from './worker.js';

export type {
  ConvertOptions,
  ConvertProgress,
  ConvertResult,
  ConvertStats,
  ConvertWarning,
  ModelFile,
  ModelsInput,
  StepTiming,
  ValidationIssue,
  ValidationReport,
} from './types.js';

/** Options of {@link convertIpc2581}. */
export interface ConvertCallOptions extends ConvertOptions {
  /** Called when each pipeline step starts. */
  onProgress?: (progress: ConvertProgress) => void;
  /** Cancels the conversion: the worker is terminated and the promise rejects. */
  signal?: AbortSignal;
}

/** The converter rejected the input, or the worker failed. */
export class ConvertError extends Error {
  override name = 'ConvertError';
}

/**
 * Converts an IPC-2581 file to a boardui asset in a Web Worker.
 *
 * Each call gets its own worker, which is terminated afterwards: WebAssembly memory only grows,
 * and a large board can take gigabytes.
 *
 * @param input The XML: a `File`/`Blob` (read in the worker), or its bytes. An `ArrayBuffer` is
 *   transferred to the worker and detached; a `Uint8Array` is copied.
 * @throws {ConvertError} if the input can't be converted; an `AbortError` `DOMException` if
 *   `signal` aborts.
 */
export async function convertIpc2581(
  input: Blob | ArrayBuffer | Uint8Array,
  options: ConvertCallOptions = {},
): Promise<ConvertResult> {
  const { onProgress, signal, models, ...rest } = options;
  const workerOptions: WorkerConvertOptions = rest;
  if (models) workerOptions.models = prepareModels(models);
  const data = input instanceof Uint8Array ? input.slice().buffer : input;
  const transfer = data instanceof ArrayBuffer ? [data] : [];
  const request: WorkerRequest = { type: 'convert', input: data, options: workerOptions };
  const response = await run(request, transfer, signal, (message) => {
    if (message.type === 'progress') onProgress?.(message.progress);
  });
  if (response.type !== 'converted') throw new ConvertError('Unexpected worker response');
  return response.result;
}

/**
 * Checks a GLB against the boardui profile rules (spec §10) in a Web Worker. The Khronos glTF
 * validator is not run.
 *
 * @param glb The asset. An `ArrayBuffer` is transferred and detached; a `Uint8Array` is copied.
 */
export async function validateGlb(
  glb: ArrayBuffer | Uint8Array,
  options: { signal?: AbortSignal } = {},
): Promise<ValidationReport> {
  const data = glb instanceof Uint8Array ? glb.slice().buffer : glb;
  const response = await run({ type: 'validate', glb: data }, [data], options.signal);
  if (response.type !== 'validated') throw new ConvertError('Unexpected worker response');
  return response.report;
}

/** Normalizes {@link ModelsInput} to a mapping text or blob and files with explicit paths. */
function prepareModels(models: ModelsInput): NonNullable<WorkerConvertOptions['models']> {
  const { mapping } = models;
  // When a folder was picked, paths are relative to the mapping file's folder.
  const base =
    mapping instanceof File && mapping.webkitRelativePath.includes('/')
      ? mapping.webkitRelativePath.slice(0, mapping.webkitRelativePath.lastIndexOf('/') + 1)
      : '';
  const files: ModelFile[] = (models.files ?? []).map((file) => {
    if (!(file instanceof File)) return file;
    const path = file.webkitRelativePath || file.name;
    return { path: base && path.startsWith(base) ? path.slice(base.length) : path, data: file };
  });
  const text =
    mapping instanceof Blob || typeof mapping === 'string' ? mapping : JSON.stringify(mapping);
  return { mapping: text, files };
}

/** Runs one request in a new worker and resolves with its final message. */
function run(
  request: WorkerRequest,
  transfer: Transferable[],
  signal: AbortSignal | undefined,
  onMessage?: (message: WorkerResponse) => void,
): Promise<WorkerResponse> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      type: 'module',
      name: 'boardui-converter',
    });
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      finish();
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'progress') {
        onMessage?.(data);
        return;
      }
      finish();
      if (data.type === 'error') reject(new ConvertError(data.message));
      else resolve(data);
    };
    worker.onerror = (event) => {
      finish();
      reject(new ConvertError(event.message || 'The converter worker failed to start'));
    };
    worker.postMessage(request, transfer);
  });
}
