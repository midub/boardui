/**
 * The files that the Angular build copies into the app as they are (`angular.json` assets):
 * `node scripts/assets.mjs <dir>` writes them to `<dir>`.
 *
 * - `samples/`: the sample boards (`stageSamples` of `@boardui/demo-shared`);
 * - the workers of `@boardui/converter` and `@boardui/viewer`. Both packages start them with
 *   `new Worker(new URL('./worker.js', import.meta.url))`, and the converter's worker loads
 *   `new URL('../wasm/boardui_wasm_bg.wasm', import.meta.url)`. Vite bundles these; Angular's
 *   application builder leaves them as they are, so the URLs point next to the app's scripts:
 *   - `worker.js` imports `converter/worker.js`, the converter's worker bundled, which loads
 *     `wasm/boardui_wasm_bg.wasm` (`../wasm/` from `converter/`);
 *   - `bvh.worker.js` is the viewer's BVH worker, bundled with three-mesh-bvh and three.js's core;
 *   - `step.worker.js` imports `models/step.worker.js`, the STEP worker of `@boardui/models`
 *     bundled with occt-import-js's glue, which loads `occt/occt-import-js.wasm`
 *     (`../occt/` from `models/`);
 * - `licenses/`: the licences of occt-import-js and OpenCascade (LGPL-2.1).
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageLicenses, stageSamples } from '@boardui/demo-shared/build';
import { build } from 'esbuild';

const out = process.argv[2];
if (!out) throw new Error('usage: node scripts/assets.mjs <dir>');
const dir = (specifier) => dirname(fileURLToPath(import.meta.resolve(specifier)));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'wasm'), { recursive: true });
mkdirSync(join(out, 'occt'), { recursive: true });
stageSamples(out);
stageLicenses(out);
await build({
  entryPoints: {
    'converter/worker': join(dir('@boardui/converter'), 'worker.js'),
    'bvh.worker': join(dir('@boardui/viewer'), 'bvh.worker.js'),
    'models/step.worker': join(dir('@boardui/models'), 'step.worker.js'),
  },
  outdir: out,
  bundle: true,
  // The BVH worker uses three.js's core only; its main module doesn't tree-shake.
  alias: { three: 'three/src/Three.Core.js' },
  format: 'esm',
  target: 'es2024',
  minify: true,
  logLevel: 'warning',
});
writeFileSync(join(out, 'worker.js'), "import './converter/worker.js';\n");
writeFileSync(join(out, 'step.worker.js'), "import './models/step.worker.js';\n");
copyFileSync(
  join(dir('@boardui/models'), '../occt/occt-import-js.wasm'),
  join(out, 'occt/occt-import-js.wasm'),
);
copyFileSync(
  join(dir('@boardui/converter/wasm'), 'boardui_wasm_bg.wasm'),
  join(out, 'wasm/boardui_wasm_bg.wasm'),
);
console.log(`${out}: samples, licences, converter, BVH and STEP workers`);
