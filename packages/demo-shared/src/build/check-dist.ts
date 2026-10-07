/**
 * Checks that a demo build contains no IPC consortium test case: they are test data only
 * (`spec/samples/README.md`), so the demos link to them instead of shipping them. A file fails the
 * check if it has the content of a file in `spec/samples/ipc-testcases/`, or a name that looks
 * like one.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { SAMPLES_DIR } from './paths.js';

const files = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * Checks `dir` (a `dist/` or the Pages site).
 *
 * @returns the number of files checked.
 * @throws an `Error` listing the files that are IPC consortium test data.
 */
export function checkDist(dir: string): number {
  const testCases = `${SAMPLES_DIR}ipc-testcases`;
  const forbidden = new Map(files(testCases).map((f) => [sha256(f), basename(f)]));
  if (forbidden.size === 0) throw new Error(`no test cases found in ${testCases}`);
  const names = new Set([...forbidden.values()].map((n) => n.toLowerCase()));
  const found: string[] = [];
  const shipped = files(dir);
  for (const file of shipped) {
    const name = relative(dir, file);
    const match = forbidden.get(sha256(file));
    if (match) found.push(`${name} (content of ${match})`);
    else if (names.has(basename(file).toLowerCase()) || /ipc-testcases|testcase\d/i.test(name))
      found.push(name);
  }
  if (found.length > 0) {
    throw new Error(`${dir} contains IPC consortium test data:\n  ${found.join('\n  ')}`);
  }
  return shipped.length;
}
