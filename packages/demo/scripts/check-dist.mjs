// Checks that the built demo (`dist/`) contains no IPC consortium test case: they are test data
// only (`spec/samples/README.md`), so the demo links to them instead of shipping them. Fails if a
// file in `dist/` has the content of a file in `spec/samples/ipc-testcases/`, or a name that
// looks like one. Runs as part of `pnpm build`.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist');
const testCases = resolve(here, '../../../spec/samples/ipc-testcases');

const files = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const forbidden = new Map(files(testCases).map((f) => [sha256(f), basename(f)]));
const names = new Set([...forbidden.values()].map((n) => n.toLowerCase()));
if (forbidden.size === 0) throw new Error(`no test cases found in ${testCases}`);

const found = [];
const shipped = files(dist);
for (const file of shipped) {
  const name = relative(dist, file);
  const match = forbidden.get(sha256(file));
  if (match) found.push(`${name} (content of ${match})`);
  else if (names.has(basename(file).toLowerCase()) || /ipc-testcases|testcase\d/i.test(name))
    found.push(name);
}
if (found.length > 0) {
  console.error(`dist/ contains IPC consortium test data:\n  ${found.join('\n  ')}`);
  process.exit(1);
}
console.log(`dist/: ${shipped.length} files, no IPC consortium test data`);
