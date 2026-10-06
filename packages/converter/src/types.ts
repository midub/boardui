/** Types shared by the main-thread API, the worker and the WASM bindings. */

/** Options of a conversion. Lengths are in metres; unset values take the converter defaults. */
export interface ConvertOptions {
  /** Maximum chord deviation of tessellated arcs (spec §6.1). Default 5 µm (`5e-6`). */
  tolerance?: number;
  /** Barrel wall thickness (spec §6.3). Default 25 µm. */
  platingThickness?: number;
  /** The step to convert. Default: the first `StepRef`, or else the first step. */
  step?: string;
  /** User models for component bodies (spec §6.9). */
  models?: ModelsInput;
}

/** A model mapping file and the files it refers to. */
export interface ModelsInput {
  /** The mapping (`spec/schema/models.schema.json`): a file, its JSON text, or the parsed JSON. */
  mapping: Blob | string | object;
  /**
   * The glTF/GLB files (and their `.bin` buffers and textures) the mapping names. A `File` is
   * matched by its path relative to the mapping file (from `webkitRelativePath` when a folder was
   * picked), or else by its name; other entries give the path explicitly.
   */
  files?: readonly (File | ModelFile)[];
}

/** A file of {@link ModelsInput.files} with an explicit path relative to the mapping file. */
export interface ModelFile {
  path: string;
  data: Blob | ArrayBuffer | Uint8Array;
}

/** A pipeline step starting. */
export interface ConvertProgress {
  /** Step name, e.g. `'parse'` or `'resolve'` (`steps` in `crates/boardui-wasm`). */
  step: string;
  /** 0-based index of the step. */
  index: number;
  /** Number of steps. */
  count: number;
  /** Estimated share of the work done when this step starts, `0…1`. */
  fraction: number;
}

/** A warning about input that was skipped, approximated or inconsistent. */
export interface ConvertWarning {
  message: string;
  /** 1-based line in the XML, for warnings from the reader. */
  line?: number;
  /** Byte offset in the XML, for warnings from the reader. */
  offset?: number;
  /** How often it happened. */
  occurrences: number;
}

/** Counts describing a converted board. */
export interface ConvertStats {
  layers: number;
  drills: number;
  /** Rows in all feature tables. */
  features: number;
  /** Vertices of layer and drill meshes. */
  vertices: number;
  /** Triangles of layer and drill meshes. */
  triangles: number;
  components: number;
  nets: number;
  pins: number;
  /** Package pins referenced by pads. */
  pinsChecked: number;
  /** Of those, pins that land on none of their pads (spec §6.8). */
  pinsMisplaced: number;
  glbBytes: number;
}

/** Time spent in one pipeline step. */
export interface StepTiming {
  step: string;
  seconds: number;
}

/** The result of a conversion. */
export interface ConvertResult {
  /** The boardui asset (GLB). */
  glb: ArrayBuffer;
  warnings: ConvertWarning[];
  stats: ConvertStats;
  /** Pipeline steps in order, measured in the worker. */
  timings: StepTiming[];
  /** Wall-clock time of the whole conversion in the worker, in seconds, including reading. */
  seconds: number;
  /**
   * Size of the worker's WebAssembly memory afterwards, in bytes: the conversion's peak, since
   * WebAssembly memory only grows. At most 4 GiB (wasm32).
   */
  wasmMemory: number;
}

/** A finding of {@link ValidationReport}. */
export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

/** The result of checking a GLB against the profile rules (spec §10). */
export interface ValidationReport {
  /** No rule was broken (warnings are allowed). */
  valid: boolean;
  errors: number;
  issues: ValidationIssue[];
}
