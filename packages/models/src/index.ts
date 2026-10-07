/**
 * @boardui/models: runtime model sources and loaders for `<board-viewer>`: STEP (OpenCascade in a
 * Web Worker) and OBJ loaders, KiCad's libraries on gitlab.com, and model mapping files for your
 * own server.
 *
 * @example
 * ```ts
 * import { kicadSource, mappingSource, registerLoaders } from '@boardui/models';
 * registerLoaders();
 * viewer.modelSources = [mappingSource('https://models.example.com/models.json'), kicadSource()];
 * ```
 */
import { registerModelLoader } from '@boardui/viewer';
import { objLoader } from './obj.js';
import { type StepLoader, type StepLoaderOptions, stepLoader } from './step.js';

export { type CacheStorageLike, RateLimitError, type RequestStats } from './http.js';
export {
  KICAD_ATTRIBUTION,
  KICAD_CACHE_NAME,
  KICAD_DEFAULT_TAG,
  KICAD_TAGS,
  type KicadSource,
  type KicadSourceOptions,
  kicadSource,
  kicadTag,
} from './kicad.js';
export { KICAD_LIBRARIES } from './kicad-libraries.js';
export {
  type KicadFootprint,
  type KicadModel,
  kicadFootprint,
  kicadModelMatrix,
  libraryModelPath,
  parseKicadModels,
} from './kicad-mod.js';
export {
  checkMapping,
  expand,
  glob,
  type MappingFile,
  type MappingMatch,
  type MappingRule,
  type MappingSourceOptions,
  mappingSource,
  matches,
  orderRules,
} from './mapping.js';
export { objLoader } from './obj.js';
export {
  STEP_TESSELLATION,
  type StepLoader,
  type StepLoaderOptions,
  stepLoader,
  stepPart,
} from './step.js';
export { type Occt, readStep, type StepMesh, type StepTessellation } from './step-mesh.js';

/**
 * Registers the STEP (`step`) and OBJ (`obj`) loaders with `<board-viewer>`.
 *
 * @returns The STEP loader, e.g. to stop its worker.
 */
export function registerLoaders(options: StepLoaderOptions = {}): StepLoader {
  const step = stepLoader(options);
  registerModelLoader('step', step);
  registerModelLoader('obj', objLoader());
  return step;
}
