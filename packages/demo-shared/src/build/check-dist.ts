/**
 * Checks that a demo build contains no IPC consortium test case: they are test data only
 * (`spec/samples/README.md`), so the demos link to them instead of shipping them. A file fails the
 * check if it has the content of a test case (its SHA-256 in
 * `spec/samples/ipc-testcases/sources.json`, so the test cases needn't be fetched), or a name that
 * looks like one.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { type TestCaseSource, testCaseSources } from './samples.js';

const files = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * Checks `dir` (a `dist/` or the Pages site) for the `testCases` (by default all of them).
 *
 * @returns the number of files checked.
 * @throws an `Error` listing the files that are IPC consortium test data.
 */
export function checkDist(
  dir: string,
  testCases: readonly Pick<TestCaseSource, 'file' | 'sha256'>[] = testCaseSources(),
): number {
  const forbidden = new Map(testCases.map((t) => [t.sha256, t.file]));
  if (forbidden.size === 0) throw new Error('no IPC consortium test cases to check for');
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
