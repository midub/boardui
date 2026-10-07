/**
 * The live check of runtime models against the real gitlab.com (never in CI): `LIVE_GITLAB=1
 * LIVE_OUT=<dir> pnpm e2e --project react e2e/live-models.spec.ts` opens KiCad boards, waits for
 * their models, loads them again (from the cache) and writes `<dir>/live-models.json` and a
 * screenshot per board.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { settle, viewerCall, waitForBoard } from './helpers.js';

const OUT = process.env.LIVE_OUT ?? '';
test.skip(!process.env.LIVE_GITLAB || !OUT, 'live check: set LIVE_GITLAB=1 and LIVE_OUT=<dir>');
test.setTimeout(900_000);

interface Demo {
  demo: {
    viewer: {
      modelStatus: Record<string, unknown> | null;
      modelSources: { name: string; stats?: Record<string, number> }[];
    };
    models(): { status: { complete: boolean } | null } | null;
  };
}

const BOARDS = [
  {
    name: 'royalblue54l-feather',
    open: (page: Page) => page.goto('./?sample=royalblue54l-feather'),
  },
  {
    name: 'miao',
    open: async (page: Page) => {
      await page.goto('./');
      await page
        .locator('#file-input')
        .setInputFiles(
          fileURLToPath(new URL('../../../spec/samples/kicad-miao/miao.xml', import.meta.url)),
        );
    },
  },
];

/** Opens a board, waits for its models and returns what it took. */
async function measure(page: Page, open: (page: Page) => Promise<unknown>) {
  const network = { gitlab: 0, gitlabBytes: 0, occt: 0 };
  const onResponse = async (response: import('@playwright/test').Response) => {
    const url = response.url();
    const size =
      (
        await response
          .request()
          .sizes()
          .catch(() => null)
      )?.responseBodySize ?? 0;
    if (url.startsWith('https://gitlab.com/')) {
      network.gitlab++;
      network.gitlabBytes += size;
    } else if (/occt-import-js.*\.wasm/.test(url)) {
      network.occt += size;
    }
  };
  page.on('response', onResponse);
  const start = Date.now();
  await open(page);
  await waitForBoard(page, 300_000);
  const loaded = Date.now() - start;
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (globalThis as unknown as Demo).demo.models()?.status?.complete ?? false,
        ),
      {
        timeout: 600_000,
        intervals: [500],
      },
    )
    .toBe(true);
  const all = Date.now() - start;
  const result = await page.evaluate(() => {
    const { viewer } = (globalThis as unknown as Demo).demo;
    return {
      status: viewer.modelStatus,
      kicad: viewer.modelSources.find((s) => s.name === 'KiCad')?.stats,
    };
  });
  page.off('response', onResponse);
  return { loadedMs: loaded, modelsInMs: all, network, ...result };
}

test('runtime models from the real gitlab.com', async ({ page }) => {
  const report: Record<string, unknown> = {};
  for (const board of BOARDS) {
    const first = await measure(page, board.open);
    await viewerCall(page, 'setView', 'iso');
    await settle(page);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/live-${board.name}.png` });
    // Again in a new document: memory is gone, Cache Storage stays.
    const second = await measure(page, board.open);
    report[board.name] = { first, second };
    writeFileSync(`${OUT}/live-models.json`, JSON.stringify(report, null, 2));
  }
});
