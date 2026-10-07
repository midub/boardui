/**
 * The GitHub Pages site (https://midub.github.io/boardui/): every demo app at `/boardui/<id>/`
 * (`DEMOS`, `src/frameworks.ts`), and `/boardui/index.html`, which redirects to the first one
 * keeping the query and hash, so that links such as `/boardui/?sample=…&stats` keep working.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMOS } from '../frameworks.js';
import { checkDist } from './check-dist.js';
import { REPO_ROOT } from './paths.js';

/** The `dist/` of a demo app. */
export const demoDist = (id: string): string => `${REPO_ROOT}packages/demo-${id}/dist`;

/** The site's `index.html`: a redirect to the default demo, keeping `?…` and `#…`. */
export function redirectPage(to = `${DEMOS[0]?.id}/`): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>boardui: IPC-2581 boards in 3D</title>
    <link rel="canonical" href="${to}" />
    <script>
      location.replace('${to}' + location.search + location.hash);
    </script>
    <noscript><meta http-equiv="refresh" content="0; url=${to}" /></noscript>
  </head>
  <body>
    <p><a href="${to}">boardui demo</a></p>
  </body>
</html>
`;
}

/**
 * Assembles the site in `outDir` from the demos' `dist/` (build them first) and checks that it
 * contains no IPC consortium test data.
 *
 * @returns the number of files.
 */
export function buildSite(outDir: string): number {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const demo of DEMOS) {
    const dist = demoDist(demo.id);
    if (!existsSync(join(dist, 'index.html'))) {
      throw new Error(`${dist} has no index.html: build the demo first (pnpm build)`);
    }
    cpSync(dist, join(outDir, demo.id), { recursive: true });
  }
  writeFileSync(join(outDir, 'index.html'), redirectPage());
  return checkDist(outDir);
}
