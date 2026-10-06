// Builds the WebAssembly module of `crates/boardui-wasm` into `wasm/`:
//   1. cargo build --target wasm32-unknown-unknown --release --locked
//   2. wasm-bindgen --target web (the version must match the `wasm-bindgen` crate in Cargo.lock)
//   3. wasm-opt -O3, if `wasm-opt` (binaryen) is on PATH; skipped with a note otherwise
// and prints the module size. Tools are looked up on PATH, and wasm-bindgen also in
// `target/tools/bin` (`cargo install wasm-bindgen-cli --version <v> --root target/tools`).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const out = resolve(here, '../wasm');
const target = process.env.CARGO_TARGET_DIR ?? join(root, 'target');

function find(tool, extra = []) {
  const dirs = [...extra, ...(process.env.PATH ?? '').split(delimiter)];
  for (const dir of dirs) {
    const path = join(dir, tool);
    if (dir && existsSync(path)) return path;
  }
  return null;
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
}

run('cargo', [
  'build',
  '-p',
  'boardui-wasm',
  '--target',
  'wasm32-unknown-unknown',
  '--release',
  '--locked',
]);

const bindgen = find('wasm-bindgen', [join(target, 'tools/bin')]);
if (!bindgen) {
  throw new Error(
    'wasm-bindgen not found: install the version in Cargo.lock, e.g. ' +
      '`cargo install wasm-bindgen-cli --version 0.2.129 --root target/tools`',
  );
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
run(bindgen, [
  '--target',
  'web',
  '--out-dir',
  out,
  '--out-name',
  'boardui_wasm',
  join(target, 'wasm32-unknown-unknown/release/boardui_wasm.wasm'),
]);

const wasm = join(out, 'boardui_wasm_bg.wasm');
const before = statSync(wasm).size;
const opt = find('wasm-opt');
if (opt) {
  // The features rustc enables by default for wasm32-unknown-unknown.
  const features = [
    'bulk-memory',
    'mutable-globals',
    'nontrapping-float-to-int',
    'sign-ext',
    'reference-types',
    'multivalue',
  ].map((f) => `--enable-${f}`);
  run(opt, ['-O3', ...features, wasm, '-o', wasm]);
} else {
  console.log('wasm-opt not found on PATH; the module is not optimized further');
}
const size = statSync(wasm).size;
const gzip = gzipSync(readFileSync(wasm), { level: 9 }).length;
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
console.log(
  `boardui_wasm_bg.wasm: ${mb(size)}${opt ? ` (${mb(before)} before wasm-opt)` : ''}, ` +
    `${mb(gzip)} gzipped`,
);
