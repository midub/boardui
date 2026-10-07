import { test as base, expect, type Route } from '@playwright/test';

/** gitlab.com as the tests see it: files by path in their project, and the requests made. */
export interface Gitlab {
  /** Served for `…/repository/files/<path>/raw`, e.g. `Capacitor_SMD.pretty/C_0805_2012Metric.kicad_mod`. */
  files: Map<string, string | Buffer>;
  requests: string[];
}

const CORS = { 'access-control-allow-origin': '*' };

/**
 * `test` with gitlab.com intercepted for every test, so that the suite never reaches it (the
 * demos look for KiCad models there after every load): each request gets a 404, so no model is
 * found, except the files a test puts into `gitlab.files`. `LIVE_GITLAB=1` lets the requests
 * through (the live check).
 */
export const test = base.extend<{ gitlab: Gitlab }>({
  gitlab: [
    async ({ context }, use) => {
      const gitlab: Gitlab = { files: new Map(), requests: [] };
      if (!process.env.LIVE_GITLAB) {
        await context.route('https://gitlab.com/**', (route) => serveGitlab(route, gitlab));
      }
      await use(gitlab);
    },
    { auto: true },
  ],
});

function serveGitlab(route: Route, gitlab: Gitlab): Promise<void> {
  const url = new URL(route.request().url());
  gitlab.requests.push(url.href);
  const path = /\/repository\/files\/([^/]+)\/raw$/.exec(url.pathname)?.[1];
  const file = path === undefined ? undefined : gitlab.files.get(decodeURIComponent(path));
  return route.fulfill(
    file === undefined
      ? {
          status: 404,
          headers: CORS,
          contentType: 'application/json',
          body: '{"message":"404 File Not Found"}',
        }
      : { status: 200, headers: CORS, contentType: 'text/plain', body: file },
  );
}

export { expect };
