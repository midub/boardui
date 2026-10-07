import { fileURLToPath } from 'node:url';

/** The repository's root (from `src/build/` and `dist/build/` alike). */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** `spec/samples/`. */
export const SAMPLES_DIR = `${REPO_ROOT}spec/samples/`;
