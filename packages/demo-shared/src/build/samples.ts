/**
 * Staging the sample boards into a demo build: the files of `SAMPLES` (`src/samples.ts`) are
 * copied to `<out>/samples/…`, or served from `spec/samples` by a dev server, and their sizes
 * (including the IPC consortium test cases, which are only linked to) are known at build time.
 */
import {
  cpSync,
  createReadStream,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { sampleFiles, TEST_CASES, testCasePath } from '../samples.js';
import { SAMPLES_DIR } from './paths.js';

/**
 * An IPC consortium test case in `spec/samples/ipc-testcases/sources.json`, the manifest of
 * `fetch.py` there: the repository doesn't host the test cases.
 */
export interface TestCaseSource {
  file: string;
  /** The consortium's ZIP archive. */
  url: string;
  /** The file's path in the archive. */
  member: string;
  normalize: 'crlf-to-lf' | 'none';
  /** Size in bytes and SHA-256 (hex) of the file as fetched. */
  size: number;
  sha256: string;
}

/** The IPC consortium test cases, from their manifest. */
export function testCaseSources(): TestCaseSource[] {
  return JSON.parse(readFileSync(`${SAMPLES_DIR}ipc-testcases/sources.json`, 'utf8')).files;
}

/**
 * Sizes in bytes of the sample files and the test cases (from their manifest), by path relative
 * to `spec/samples/`.
 */
export function sampleSizes(): Record<string, number> {
  const sources = testCaseSources();
  const testCaseSize = (file: string) => {
    const source = sources.find((s) => s.file === file);
    if (!source) throw new Error(`${file} is not in spec/samples/ipc-testcases/sources.json`);
    return source.size;
  };
  return Object.fromEntries([
    ...sampleFiles().map((f) => [f, statSync(SAMPLES_DIR + f).size]),
    ...TEST_CASES.map((t) => [testCasePath(t), testCaseSize(t.file)]),
  ]);
}

/** Copies the sample files to `<outDir>/samples/`. */
export function stageSamples(outDir: string): void {
  for (const file of sampleFiles()) {
    const to = join(outDir, 'samples', file);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(SAMPLES_DIR + file, to);
  }
}

/**
 * Writes `sizes.js` and `sizes.d.ts` (`SAMPLE_SIZES`) to `dir`: the module
 * `@boardui/demo-shared/sizes`, which the apps bundle.
 */
export function writeSampleSizes(dir: string): void {
  const sizes = JSON.stringify(sampleSizes(), null, 2);
  const doc = '/** Sizes in bytes of the sample files, by path relative to `spec/samples/`. */';
  writeFileSync(join(dir, 'sizes.js'), `${doc}\nexport const SAMPLE_SIZES = ${sizes};\n`);
  writeFileSync(
    join(dir, 'sizes.d.ts'),
    `${doc}\nexport declare const SAMPLE_SIZES: Readonly<Record<string, number>>;\n`,
  );
}

/** Connect-style middleware serving the sample files under `<base>samples/` from `spec/samples`. */
export function samplesMiddleware(base: string) {
  const files = new Set(sampleFiles());
  const prefix = `${base}samples/`;
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
    const file = path.startsWith(prefix) ? path.slice(prefix.length) : null;
    if (!file || !files.has(file)) {
      next();
      return;
    }
    res.setHeader('content-type', 'application/octet-stream');
    createReadStream(SAMPLES_DIR + file).pipe(res);
  };
}
