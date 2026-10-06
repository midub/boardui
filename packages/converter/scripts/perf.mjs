// Converts IPC-2581 files with the WASM module in Node and prints timings (after `pnpm build`):
//   node scripts/perf.mjs <file.xml>… [--tolerance <metres>]
// One JSON line per file: total seconds, per-step seconds, features, triangles, GLB size and
// the WebAssembly memory afterwards (the conversion's peak).
import { readFileSync } from 'node:fs';
import { convertBytes } from '../dist/core.js';
import * as wasm from '../wasm/boardui_wasm.js';

const args = process.argv.slice(2);
const t = args.indexOf('--tolerance');
const options = t >= 0 ? { tolerance: Number(args.splice(t, 2)[1]) } : {};
const { memory } = wasm.initSync({
  module: readFileSync(new URL('../wasm/boardui_wasm_bg.wasm', import.meta.url)),
});
for (const file of args) {
  const xml = readFileSync(file);
  const start = performance.now();
  const result = await convertBytes(wasm, xml, options);
  const seconds = (performance.now() - start) / 1000;
  const round = (n) => Math.round(n * 1000) / 1000;
  console.log(
    JSON.stringify({
      file,
      xmlMB: round(xml.byteLength / 1e6),
      seconds: round(seconds),
      steps: Object.fromEntries(result.timings.map((s) => [s.step, round(s.seconds)])),
      features: result.stats.features,
      triangles: result.stats.triangles,
      glbMB: round(result.stats.glbBytes / 1e6),
      wasmMemoryMB: round(memory.buffer.byteLength / 1e6),
    }),
  );
}
