/** The Vite plugin of a demo app: the sample boards and the dist check. */
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { checkDist } from './check-dist.js';
import { licensesMiddleware, stageLicenses } from './licenses.js';
import { samplesMiddleware, stageSamples } from './samples.js';

/**
 * Serves the sample boards (`src/samples.ts`) from `spec/samples` under `<base>samples/` and the
 * third-party licences under `<base>licenses/` in dev, copies both into the build, and checks the
 * build for IPC consortium test data (`checkDist`).
 */
export function demoSamples(): Plugin {
  let base = '/';
  let outDir = 'dist';
  let build = false;
  return {
    name: 'boardui-demo-samples',
    configResolved(config) {
      base = config.base;
      build = config.command === 'build';
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(samplesMiddleware(base));
      server.middlewares.use(licensesMiddleware(base));
    },
    writeBundle() {
      stageSamples(outDir);
      stageLicenses(outDir);
    },
    closeBundle() {
      if (!build) return;
      const files = checkDist(outDir);
      this.info?.(`${outDir}: ${files} files, no IPC consortium test data`);
    },
  };
}
