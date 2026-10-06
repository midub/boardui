/**
 * Runs the WASM bindings (`crates/boardui-wasm`) on bytes. Used by the worker and by Node
 * (tests, `scripts/perf.mjs`); the module must already be initialized.
 */
import type * as Bindings from '../wasm/boardui_wasm.js';
import type {
  ConvertOptions,
  ConvertProgress,
  ConvertStats,
  ConvertWarning,
  ModelFile,
  StepTiming,
  ValidationReport,
} from './types.js';

/** The initialized WASM module (`wasm/boardui_wasm.js`). */
export type WasmModule = Pick<typeof Bindings, 'convert' | 'validate' | 'steps' | 'ConvertOptions'>;

/** {@link ConvertOptions} as sent to the worker: models with explicit paths. */
export interface WorkerConvertOptions extends Omit<ConvertOptions, 'models'> {
  models?: { mapping: Blob | string; files: ModelFile[] };
}

/** What {@link convertBytes} returns: the result without the worker's wall-clock time. */
export interface BytesResult {
  glb: Uint8Array;
  warnings: ConvertWarning[];
  stats: ConvertStats;
  timings: StepTiming[];
}

/**
 * Rough share of each step in a conversion, from timings of large boards (single-threaded
 * WASM). Only used for {@link ConvertProgress.fraction}.
 */
const STEP_WEIGHTS: Record<string, number> = {
  parse: 0.08,
  'stack-up, features, components': 0.03,
  resolve: 0.33,
  'hole cuts': 0.02,
  'cut and sheets': 0.15,
  extrude: 0.21,
  barrels: 0.01,
  write: 0.17,
};

/** Estimated share of the work done when step `index` of `steps` starts. */
export function stepFraction(steps: readonly string[], index: number): number {
  const weight = (step: string) => STEP_WEIGHTS[step] ?? 1 / steps.length;
  const total = steps.reduce((sum, step) => sum + weight(step), 0);
  const done = steps.slice(0, index).reduce((sum, step) => sum + weight(step), 0);
  return total > 0 ? done / total : 0;
}

/** Bytes of a blob, buffer or view. */
export async function bytesOf(data: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Converts IPC-2581 bytes with an initialized WASM module.
 *
 * @throws an `Error` with the converter's message if the input can't be converted.
 */
export async function convertBytes(
  wasm: WasmModule,
  xml: Uint8Array,
  options: WorkerConvertOptions = {},
  onProgress?: (progress: ConvertProgress) => void,
): Promise<BytesResult> {
  const opts = new wasm.ConvertOptions();
  try {
    if (options.tolerance !== undefined) opts.tolerance = options.tolerance;
    if (options.platingThickness !== undefined) opts.platingThickness = options.platingThickness;
    if (options.step !== undefined) opts.step = options.step;
    if (options.models) {
      const { mapping, files } = options.models;
      opts.models = typeof mapping === 'string' ? mapping : await mapping.text();
      for (const file of files) opts.addFile(file.path, await bytesOf(file.data));
    }
    const steps = wasm.steps();
    const progress = onProgress
      ? (step: string, index: number, count: number) =>
          onProgress({ step, index, count, fraction: stepFraction(steps, index) })
      : undefined;
    return wasm.convert(xml, opts, progress) as BytesResult;
  } finally {
    opts.free();
  }
}

/** Checks a GLB against the profile rules (spec §10) with an initialized WASM module. */
export function validateBytes(wasm: WasmModule, glb: Uint8Array): ValidationReport {
  return wasm.validate(glb) as ValidationReport;
}
