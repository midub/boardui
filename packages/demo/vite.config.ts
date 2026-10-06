import { createReadStream, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { sampleFiles, TEST_CASES, testCasePath } from './src/samples.js';

const samplesDir = fileURLToPath(new URL('../../spec/samples/', import.meta.url));

/**
 * Serves the sample boards (`src/samples.ts`) from `spec/samples` under `<base>samples/` in dev
 * and copies them into the build, and defines `__SAMPLE_SIZES__` (bytes per file, including the
 * IPC consortium test cases, which are only linked to: `scripts/check-dist.mjs`).
 */
function samples(): Plugin {
  const files = sampleFiles();
  const sized = [...files, ...TEST_CASES.map(testCasePath)];
  let base = '/';
  return {
    name: 'boardui-samples',
    config: () => ({
      define: {
        __SAMPLE_SIZES__: JSON.stringify(
          Object.fromEntries(sized.map((f) => [f, statSync(samplesDir + f).size])),
        ),
      },
    }),
    configResolved: (config) => {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        const file = path.startsWith(`${base}samples/`) ? path.slice(base.length + 8) : null;
        if (!file || !files.includes(file)) return next();
        res.setHeader('content-type', 'application/octet-stream');
        createReadStream(samplesDir + file).pipe(res);
      });
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({
          type: 'asset',
          fileName: `samples/${file}`,
          source: readFileSync(samplesDir + file),
        });
      }
    },
  };
}

// Served from https://midub.github.io/boardui/ (GitHub Pages, .github/workflows/pages.yml).
export default defineConfig({
  base: '/boardui/',
  plugins: [samples()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 2000, target: 'es2024' },
});
