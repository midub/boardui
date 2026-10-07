/**
 * Build helpers of the demo apps, for any build tool: staging the samples, their sizes, the dist
 * check, and the Pages site. `dist/build/cli.js` runs them from the command line.
 */
export { checkDist } from './check-dist.js';
export { REPO_ROOT, SAMPLES_DIR } from './paths.js';
export { sampleSizes, samplesMiddleware, stageSamples, writeSampleSizes } from './samples.js';
export { serveSite } from './serve.js';
export { buildSite, demoDist, redirectPage } from './site.js';
