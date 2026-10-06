/**
 * Review screenshots and performance numbers of the dev page in headless Chromium with software
 * rendering (SwiftShader). Not part of CI. Build the dev page first
 * (`pnpm --filter @boardui/viewer build` writes `dev/dist`), then run this in the Playwright
 * image, from `packages/viewer`:
 *
 *   docker run --rm --shm-size=2g -v "$PWD:/viewer:ro" -v "$OUT:/out" -w /tmp \
 *     mcr.microsoft.com/playwright:v1.63.0-noble sh -c \
 *     'npm i -s playwright@1.63.0 && cp /viewer/dev/review.mjs . && node review.mjs shots /viewer/dev/dist /out'
 *
 * Modes:
 * - `shots <dist> <out>`: PNGs of the small fixture (views, x-ray, net highlight, hover,
 *   selection, layer toggles, focus).
 * - `perf <dist> <out> <query>…`: load time, frame time while orbiting and hover latency for
 *   each dev page query (e.g. `board=dense&grid=60&realistic`), at 1920 × 1080; results go to
 *   `<out>/perf.json`.
 * - `probe <dist> <out>`: which backends the browser offers.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const [mode, dist, out, ...queries] = process.argv.slice(2);
const SIDEBAR = 300;
const ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const path = normalize(pathname === '/' ? '/index.html' : pathname);
  try {
    const body = await readFile(join(dist, path));
    response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ARGS });

try {
  if (mode === 'shots') await shots();
  else if (mode === 'perf') await perf();
  else if (mode === 'probe') await probe();
  else throw new Error(`Unknown mode ${mode}`);
} finally {
  await browser.close();
  server.close();
}

/** Opens the dev page and waits until the board is loaded and drawn. */
async function open(query, width, height) {
  const page = await browser.newPage({ viewport: { width: width + SIDEBAR, height } });
  page.on('pageerror', (error) => console.error('page error:', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      console.error(`console ${message.type()}:`, message.text());
    }
  });
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(
    () => globalThis.timings?.firstFrame !== undefined && globalThis.viewer.stats(),
    undefined,
    { timeout: 600_000, polling: 250 },
  );
  return page;
}

/** Waits for `n` animation frames of the page. */
function frames(page, n = 3) {
  return page.evaluate(
    (n) =>
      new Promise((resolve) => {
        const step = (left) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
        step(n);
      }),
    n,
  );
}

/** Screen position (CSS px) of the centre of an element's bounding box, via a probe widget. */
function screenPosition(page, id) {
  return page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const probe = document.createElement('span');
        const detach = globalThis.viewer.attachWidget(id, probe, {
          anchor: 'center',
          occlusion: 'none',
        });
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const r = probe.getBoundingClientRect();
            detach();
            resolve({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
          }),
        );
      }),
    id,
  );
}

async function shots() {
  const page = await open('board=small', 1200, 900);
  const viewer = page.locator('board-viewer');
  const shot = async (name) => {
    await page.waitForTimeout(600); // camera flights take 400 ms
    await frames(page);
    await viewer.screenshot({ path: join(out, `${name}.png`) });
    console.log(`${name}.png`);
  };
  const call = (fn, arg) => page.evaluate(fn, arg);

  await call(() => globalThis.viewer.setView('top'));
  await shot('top');
  await call(() => globalThis.viewer.setView('bottom'));
  await shot('bottom');
  await call(() => globalThis.viewer.setView('iso'));
  await shot('iso');

  await call(() => globalThis.viewer.setXray(true));
  await shot('xray');
  await call(() => globalThis.viewer.setXray(false));

  await call(() => globalThis.viewer.setView('top'));
  await call(() => {
    globalThis.clearHighlights = [
      globalThis.viewer.highlight({ net: 'net/GND' }, { color: '#ffcc00' }),
      globalThis.viewer.highlight({ net: 'net/%2FSDA' }, { color: '#00e5ff' }),
    ];
  });
  await shot('net-highlight');
  await call(() => {
    for (const clear of globalThis.clearHighlights) clear();
  });

  // Hover and selection close up: fly to U1 first.
  await call(() => globalThis.viewer.focus('cmp/U1'));
  await page.waitForTimeout(600);
  const events = [];
  await page.exposeFunction('reportEvent', (type, detail) => events.push({ type, detail }));
  await call(() => {
    for (const type of ['bui-hover', 'bui-select']) {
      globalThis.viewer.addEventListener(type, (e) => globalThis.reportEvent(type, e.detail));
    }
  });
  const pad = await screenPosition(page, 'pin/U1/1');
  await page.mouse.move(pad.x, pad.y);
  await shot('hover');
  const body = await screenPosition(page, 'cmp/U1');
  await page.mouse.click(body.x, body.y);
  await page.mouse.move(5, 5); // off the board, so the hover tint doesn't cover the selection
  await shot('select');
  console.log(JSON.stringify(events.map((e) => [e.type, e.detail?.id ?? null])));

  await call(() => {
    globalThis.viewer.select(null);
    globalThis.viewer.setView('top');
    globalThis.viewer.setLayerVisible('layer/@soldermask-top', false);
    globalThis.viewer.setLayerVisible('layer/F.SilkS', false);
  });
  await shot('layers-mask-off');
  await call(() => {
    globalThis.viewer.setLayerVisible('layer/@soldermask-top', true);
    globalThis.viewer.setLayerVisible('layer/F.SilkS', true);
    globalThis.viewer.setView('iso');
  });
  await page.waitForTimeout(600);
  await call(() => {
    globalThis.viewer.select('cmp/U1');
    globalThis.viewer.focus('cmp/U1');
  });
  await shot('focus');
  await writeFile(join(out, 'events.json'), JSON.stringify(events, null, 1));
  await page.close();
}

async function perf() {
  const results = [];
  for (const query of queries) {
    const page = await open(query, 1920, 1080);
    const timings = await page.evaluate(() => globalThis.timings);
    const stats = await page.evaluate(() => globalThis.viewer.stats());
    console.log(query, JSON.stringify({ timings, stats }));
    // BVHs are built in idle time after loading; give them a moment.
    await page.waitForTimeout(5000);
    await frames(page);

    // Orbit: drag across the canvas for a while and record every animation frame.
    await page.evaluate(() => {
      globalThis.frameTimes = [];
      globalThis.recording = true;
      const loop = (t) => {
        globalThis.frameTimes.push(t);
        if (globalThis.recording) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    const start = Date.now();
    await page.mouse.move(700, 540);
    await page.mouse.down();
    for (let i = 0; Date.now() - start < 8000 || i < 20; i++) {
      await page.mouse.move(700 + 300 * Math.sin(i / 10), 540 + 60 * Math.sin(i / 7));
    }
    await page.mouse.up();
    const orbit = await page.evaluate(() => {
      globalThis.recording = false;
      const t = globalThis.frameTimes;
      const d = t
        .slice(1)
        .map((v, i) => v - t[i])
        .sort((a, b) => a - b);
      const at = (q) => d[Math.min(d.length - 1, Math.floor(q * d.length))];
      return {
        frames: d.length,
        medianMs: at(0.5),
        p95Ms: at(0.95),
        meanMs: d.reduce((a, b) => a + b, 0) / d.length,
      };
    });
    const orbitStats = await page.evaluate(() => globalThis.viewer.stats());
    console.log('orbit', JSON.stringify(orbit), JSON.stringify(orbitStats));
    await page.waitForTimeout(1500);

    // Hover: move between two points over the board; time pointermove → bui-hover → next frame.
    await page.evaluate(() => {
      globalThis.hovers = [];
      const canvas = globalThis.viewer.shadowRoot.querySelector('canvas');
      canvas.addEventListener('pointermove', () => {
        globalThis.hovers.push({ move: performance.now(), frames: 0 });
      });
      const count = () => {
        const h = globalThis.hovers.at(-1);
        if (h && h.event === undefined) h.frames++;
        requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
      globalThis.viewer.addEventListener('bui-hover', (e) => {
        const h = globalThis.hovers.at(-1);
        if (!h || h.event !== undefined) return;
        h.event = performance.now();
        h.id = e.detail?.id ?? null;
        requestAnimationFrame(() => {
          h.shown = performance.now();
        });
      });
    });
    const points = [
      [960, 540],
      [1010, 560],
    ];
    for (let i = 0; i < 12; i++) {
      const [x, y] = points[i % 2];
      await page.mouse.move(x + (i % 3), y);
      await page.waitForTimeout(orbit.medianMs * 3 + 200);
    }
    const hover = await page.evaluate(() => {
      const h = globalThis.hovers.filter((x) => x.event !== undefined && x.shown !== undefined);
      const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
      return {
        samples: h.length,
        ids: [...new Set(h.map((x) => x.id))].slice(0, 4),
        moveToEventMs: median(h.map((x) => x.event - x.move)),
        moveToShownMs: median(h.map((x) => x.shown - x.move)),
        maxFramesBeforeEvent: Math.max(...h.map((x) => x.frames)),
      };
    });
    console.log('hover', JSON.stringify(hover));
    results.push({ query, timings, stats, orbit, orbitStats, hover });
    await page.close();
  }
  await writeFile(join(out, 'perf.json'), JSON.stringify(results, null, 1));
}

async function probe() {
  const page = await browser.newPage();
  await page.goto(base);
  const info = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      webgpu: adapter ? (adapter.info?.description ?? adapter.info?.vendor ?? 'yes') : null,
      webgl2: gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : null,
    };
  });
  console.log(JSON.stringify(info));
  await page.close();
}
