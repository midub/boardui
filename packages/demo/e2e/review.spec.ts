// Review images and performance numbers (not a test): runs only with REVIEW_OUT=<dir>.
// PERF_XML=<file> also converts that file (e.g. the ~200k-feature synthetic board) and
// records its timings. Results go to <dir>/*.png and <dir>/perf-*.json.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { openBoard, screenPoint, settle, viewerCall } from './helpers.js';

const out = process.env.REVIEW_OUT ?? '';
const perfXml = process.env.PERF_XML;

test.skip(!out, 'set REVIEW_OUT=<dir> to write review images');
test.use({ viewport: { width: 1600, height: 1000 } });
test.describe.configure({ timeout: 1_200_000 });

/** Writes one measurement to `<out>/perf-<name>.json`. */
const record = (name: string, value: unknown) =>
  writeFileSync(`${out}/perf-${name}.json`, `${JSON.stringify(value, null, 2)}\n`);

const shot = async (page: Page, name: string) => {
  await settle(page);
  await page.screenshot({ path: `${out}/${name}.png` });
};

/** The last load's timings, the conversion's stats and the renderer's statistics. */
async function loadNumbers(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const { demo } = globalThis as unknown as {
      demo: {
        timings: Record<string, unknown>;
        viewer: { stats(): unknown };
        board(): { glb: ArrayBuffer; conversion: Record<string, unknown> | null };
      };
    };
    const board = demo.board();
    const c = board.conversion;
    return {
      timingsMs: demo.timings,
      conversion: c && { seconds: c.seconds, stats: c.stats, wasmMemory: c.wasmMemory },
      glbBytes: board.glb.byteLength,
      render: demo.viewer.stats(),
    };
  });
}

/** Records the page's long tasks (`globalThis.longTasks`). Call before loading the page. */
async function recordLongTasks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tasks: { start: number; ms: number }[] = [];
    Object.assign(globalThis, { longTasks: tasks });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) tasks.push({ start: e.startTime, ms: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  });
}

/**
 * How long after the board is shown hover covers the whole board (BVHs built in workers), and
 * the longest main-thread task meanwhile.
 */
async function pickability(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const g = globalThis as unknown as {
      demo: { viewer: { whenPickable(): Promise<void> } };
      longTasks: { start: number; ms: number }[];
    };
    const shown = performance.now();
    await g.demo.viewer.whenPickable();
    const pickable = performance.now();
    const during = g.longTasks.filter((t) => t.start >= shown && t.start < pickable);
    return {
      pickableMs: pickable - shown,
      longTasks: during.length,
      maxLongTaskMs: Math.max(0, ...during.map((t) => t.ms)),
      // All long tasks of the page so far (loading included), to show the observer works.
      longTasksBefore: g.longTasks.length - during.length,
      maxLongTaskBeforeMs: Math.max(
        0,
        ...g.longTasks.filter((t) => t.start < shown).map((t) => t.ms),
      ),
    };
  });
}

/** Frame rate while the camera orbits by itself, over `seconds`. */
async function orbitFps(page: Page, seconds: number): Promise<Record<string, number>> {
  return page.evaluate(async (seconds) => {
    const { viewer } = (
      globalThis as unknown as {
        demo: { viewer: { autoRotate: boolean; stats(): { frames: number } } };
      }
    ).demo;
    viewer.autoRotate = true;
    await new Promise((r) => setTimeout(r, 1000));
    const frames0 = viewer.stats().frames;
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, seconds * 1000));
    const frames = viewer.stats().frames - frames0;
    const ms = performance.now() - t0;
    viewer.autoRotate = false;
    return {
      frames,
      seconds: ms / 1000,
      fps: (frames * 1000) / ms,
      frameMs: ms / Math.max(frames, 1),
    };
  }, seconds);
}

test('landing page', async ({ page }) => {
  await page.goto('./');
  await shot(page, '01-empty');
});

test('testcase1: progress, views, timings', async ({ page }) => {
  await recordLongTasks(page);
  await page.goto('./?stats');
  // Test case 1 isn't part of the demo (it links to it): open the file from spec/samples.
  await page
    .locator('#file-input')
    .setInputFiles(
      fileURLToPath(
        new URL('../../../spec/samples/ipc-testcases/testcase1-RevC-Assembly.xml', import.meta.url),
      ),
    );
  await expect(page.locator('#progress-title')).toContainText('Converting', { timeout: 60_000 });
  await expect(page.locator('#progress-step')).toContainText(/overlaps|sheets|extruding/, {
    timeout: 60_000,
  });
  await page.screenshot({ path: `${out}/02-progress.png` });
  await expect(page.locator('body')).toHaveAttribute('data-state', 'ready', { timeout: 600_000 });
  const numbers = { ...(await loadNumbers(page)), ...(await pickability(page)) };
  await shot(page, '05-testcase1-iso');
  await viewerCall(page, 'setView', 'top');
  await shot(page, '06-testcase1-top');
  await viewerCall(page, 'setView', 'bottom');
  await shot(page, '06-testcase1-bottom');
  record('testcase1', { ...numbers, orbit: await orbitFps(page, 20) });
});

test('KiCad board: views, selection with tags, nets, x-ray, hover', async ({ page }) => {
  await openBoard(page, 'sample=royalblue54l-feather');
  record('kicad', await loadNumbers(page));
  await shot(page, '03-kicad-iso');
  await viewerCall(page, 'setView', 'top');
  await viewerCall(page, 'whenPickable');
  await shot(page, '04-kicad-top');

  // Select parts by clicking them, pinning the first two tags.
  for (const id of ['cmp/U2', 'cmp/J3_1', 'cmp/U1']) {
    const p = await screenPoint(page, id);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('#details .details-title')).toHaveText(id.slice(4));
    if (id !== 'cmp/U1') await page.getByRole('button', { name: 'Pin tag' }).click();
  }
  await page.mouse.move(5, 500);
  await shot(page, '07-selected-widgets-top');
  await viewerCall(page, 'setView', 'iso');
  await shot(page, '07-selected-widgets-iso');
  await viewerCall(page, 'setView', 'top');

  // Net highlight: GND and a signal net, via the search box.
  await page.keyboard.press('Escape');
  for (const net of ['GND', 'UART.TX']) {
    await page.locator('#net-search').fill(net);
    await page.locator('.net-result').first().click();
  }
  await viewerCall(page, 'setView', 'top');
  await shot(page, '08-net-highlight');

  await page.keyboard.press('b');
  await shot(page, '09-kicad-bottom');

  // X-ray without highlights (tinted elements stay opaque): inner copper shows too.
  const removeButtons = page.locator('#net-active .remove');
  while ((await removeButtons.count()) > 0) await removeButtons.first().click();
  await page.keyboard.press('i');
  await page.keyboard.press('x');
  await shot(page, '10-kicad-xray');
  await page.keyboard.press('b');
  await shot(page, '10-kicad-xray-bottom');
  await page.keyboard.press('x');

  // Hover a pad of the bottom header J1 from the top: tooltip and hover tint on copper.
  await page.keyboard.press('t');
  await settle(page);
  await viewerCall(page, 'focus', 'pin/J1/5');
  await settle(page);
  const pad = await screenPoint(page, 'pin/J1/5');
  await page.mouse.move(pad.x, pad.y);
  await expect(page.locator('#tooltip')).toBeVisible();
  await shot(page, '11-hover-pad');
});

test('bottom-placement: bottom view lighting', async ({ page }) => {
  await openBoard(page, 'sample=bottom-placement');
  await viewerCall(page, 'setView', 'bottom');
  await shot(page, '12-bottom-placement-bottom');
  await viewerCall(page, 'setView', 'iso');
  await page.locator('#layer-list input[data-layer="layer/@core"]').uncheck();
  await viewerCall(page, 'setView', 'bottom');
  await shot(page, '13-bottom-placement-no-core');
});

test('synthetic board (PERF_XML)', async ({ page }) => {
  test.skip(!perfXml, 'set PERF_XML');
  await recordLongTasks(page);
  await page.goto('./?stats');
  const start = Date.now();
  await page.locator('#file-input').setInputFiles(perfXml as string);
  await expect(page.locator('body')).toHaveAttribute('data-state', /ready|error/, {
    timeout: 1_100_000,
  });
  if (await page.locator('#error').isVisible()) {
    record('synthetic', { error: await page.locator('#error-message').innerText() });
    return;
  }
  const wallMs = Date.now() - start;
  record('synthetic', { ...(await loadNumbers(page)), wallMs, ...(await pickability(page)) });
  await shot(page, '14-synthetic');
});
