/**
 * The build helpers from the command line (`node dist/build/cli.js <command>`):
 *
 * - `sizes <dir>`: writes `sizes.js` and `sizes.d.ts` (the sample sizes) to `<dir>`;
 * - `stage <outDir>`: copies the sample files to `<outDir>/samples/`;
 * - `check-dist <dir>…`: fails if a directory contains IPC consortium test data;
 * - `site <outDir>`: assembles the Pages site from the demos' `dist/`;
 * - `serve <dir> [port]`: serves a site at `http://127.0.0.1:<port>/boardui/` (default 4173).
 */
import { checkDist } from './check-dist.js';
import { stageSamples, writeSampleSizes } from './samples.js';
import { serveSite } from './serve.js';
import { buildSite } from './site.js';

const [command, ...args] = process.argv.slice(2);
const arg = (i: number) => {
  const value = args[i];
  if (!value) throw new Error(`${command}: missing argument ${i + 1}`);
  return value;
};

try {
  switch (command) {
    case 'sizes':
      writeSampleSizes(arg(0));
      break;
    case 'stage':
      stageSamples(arg(0));
      break;
    case 'check-dist':
      for (const dir of args) {
        console.log(`${dir}: ${checkDist(dir)} files, no IPC consortium test data`);
      }
      break;
    case 'site':
      console.log(`${arg(0)}: ${buildSite(arg(0))} files, no IPC consortium test data`);
      break;
    case 'serve': {
      const port = Number(args[1] ?? 4173);
      serveSite(arg(0), port);
      console.log(`http://127.0.0.1:${port}/boardui/`);
      break;
    }
    default:
      throw new Error(`unknown command: ${command} (sizes, stage, check-dist, site, serve)`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
