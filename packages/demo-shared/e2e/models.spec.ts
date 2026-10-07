/**
 * Runtime 3D models in the demos, with self-made fixtures served in place of gitlab.com (KiCad's
 * libraries) and of a model server (`?models=`): never the real libraries.
 */
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { boxStep } from '../../models/test/fixture/step.js';
import { expect, test } from './fixtures.js';
import { collectErrors, screenPoint, settle, viewerCall, waitForBoard } from './helpers.js';

const shared = (page: Page) => ({ mask: [page.locator('.demo-switch')] });
const sample = (path: string) =>
  fileURLToPath(new URL(`../../../spec/samples/${path}`, import.meta.url));

/** A footprint as in KiCad's library: its model is a WRL, which the source reads as STEP. */
const C_0805 = `(footprint "C_0805_2012Metric" (version 20241229) (generator "pcbnew") (layer "F.Cu")
  (model "\${KICAD9_3DMODEL_DIR}/Capacitor_SMD.3dshapes/C_0805_2012Metric.wrl"
    (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0))))`;

/** Hovers and selects a component at its centre. */
async function hoverAndSelect(page: Page, id: string, text: string): Promise<void> {
  const point = await screenPoint(page, id);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#tooltip')).toContainText(text);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#details')).toContainText(text);
}

test('swaps placeholder bodies for KiCad models, top and bottom', async ({ page, gitlab }) => {
  const errors = collectErrors(page);
  gitlab.files.set('Capacitor_SMD.pretty/C_0805_2012Metric.kicad_mod', C_0805);
  gitlab.files.set(
    'Capacitor_SMD.3dshapes/C_0805_2012Metric.step',
    boxStep({
      min: [-1, -0.625, 0],
      max: [1, 0.625, 1.25],
      color: [0.55, 0.45, 0.35],
      topColor: [0.95, 0.55, 0.1],
    }),
  );
  await page.goto('./');
  // Two C_0805 capacitors from KiCad 9, one on each side.
  await page
    .locator('#file-input')
    .setInputFiles(sample('kicad-blind-buried-vias/blind-buried-vias.xml'));
  await waitForBoard(page);
  await expect(page.locator('#models-status')).toHaveText('2 of 2 components (2 from KiCad)', {
    timeout: 120_000,
  });
  // The footprint and the model, each once, at one tag: KiCad 9's newest when the board names
  // its exporter (profile 0.8), else the newest pinned one.
  const files = gitlab.requests.map((url) => decodeURIComponent(url.split('/files/')[1] ?? ''));
  expect(files).toEqual([
    expect.stringMatching(
      /^Capacitor_SMD\.pretty\/C_0805_2012Metric\.kicad_mod\/raw\?ref=(9\.0\.9\.1|10\.0\.7)$/,
    ),
    expect.stringMatching(
      /^Capacitor_SMD\.3dshapes\/C_0805_2012Metric\.step\/raw\?ref=(9\.0\.9\.1|10\.0\.7)$/,
    ),
  ]);
  expect(new Set(files.map((f) => f.split('ref=')[1])).size).toBe(1);
  await expect(page.locator('#models-credits a').first()).toHaveAttribute(
    'href',
    'https://gitlab.com/kicad/libraries',
  );

  await viewerCall(page, 'setView', 'top');
  await viewerCall(page, 'whenPickable');
  await settle(page);
  await hoverAndSelect(page, 'cmp/REF__', 'REF__');
  // The model up close, without the selection.
  await page.keyboard.press('Escape');
  await page.mouse.move(5, 5);
  await viewerCall(page, 'focus', 'cmp/REF__');
  await page.waitForTimeout(1500);
  await settle(page);
  await expect(page).toHaveScreenshot('kicad-models-top.png', shared(page));

  await viewerCall(page, 'setView', 'bottom');
  await settle(page);
  await hoverAndSelect(page, 'cmp/REF___1', 'REF___1');

  // Off: the placeholder bodies again; on: the models, without new requests.
  await page.locator('#models-toggle').uncheck();
  const shown = () =>
    page.evaluate(
      () =>
        (globalThis as unknown as { demo: { viewer: { modelsShown: boolean } } }).demo.viewer
          .modelsShown,
    );
  await expect.poll(shown).toBe(false);
  await page.locator('#models-toggle').check();
  await expect.poll(shown).toBe(true);
  expect(gitlab.requests).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('takes models from the persistent cache when the board loads again', async ({
  page,
  gitlab,
}) => {
  gitlab.files.set('Capacitor_SMD.pretty/C_0805_2012Metric.kicad_mod', C_0805);
  gitlab.files.set(
    'Capacitor_SMD.3dshapes/C_0805_2012Metric.step',
    boxStep({ min: [-1, -0.625, 0], max: [1, 0.625, 1.25] }),
  );
  const file = sample('kicad-blind-buried-vias/blind-buried-vias.xml');
  await page.goto('./');
  await page.locator('#file-input').setInputFiles(file);
  await waitForBoard(page);
  await expect(page.locator('#models-status')).toHaveText(/^2 of 2/, { timeout: 120_000 });
  // A new page: no models in memory, the same Cache Storage.
  await page.reload();
  await page.locator('#file-input').setInputFiles(file);
  await waitForBoard(page);
  await expect(page.locator('#models-status')).toHaveText(/^2 of 2/, { timeout: 60_000 });
  expect(gitlab.requests).toHaveLength(2);
  const status = await page.evaluate(
    () =>
      (globalThis as unknown as { demo: { viewer: { modelStatus: { cached: number } } } }).demo
        .viewer.modelStatus,
  );
  expect(status.cached).toBe(1);
});

test('loads models of a mapping from ?models=, before KiCad', async ({ page, gitlab }) => {
  const errors = collectErrors(page);
  const mapping = {
    version: 1,
    models: [{ match: { package: 'R0603' }, file: 'parts/{package}.gltf', scale: 1 }],
  };
  const requests: string[] = [];
  await page.route('https://models.example/**', (route) => {
    const url = route.request().url();
    requests.push(url);
    const headers = { 'access-control-allow-origin': '*' };
    if (url.endsWith('/models.json')) return route.fulfill({ headers, json: mapping });
    if (url.endsWith('/parts/R0603.gltf'))
      return route.fulfill({ headers, json: boxGltf(1.6, 0.8, 1.2) });
    return route.fulfill({ status: 404, headers, body: '' });
  });
  await page.goto(
    `./?sample=minimal-2layer&models=${encodeURIComponent('https://models.example/lib/models.json')}`,
  );
  await waitForBoard(page);
  await expect(page.locator('#models-status')).toHaveText(
    '1 of 1 components (1 from models.json)',
    {
      timeout: 60_000,
    },
  );
  expect(requests).toEqual([
    'https://models.example/lib/models.json',
    'https://models.example/lib/parts/R0603.gltf',
  ]);
  // KiCad was not asked: the mapping had the model.
  expect(gitlab.requests).toEqual([]);
  await viewerCall(page, 'setView', 'top');
  await viewerCall(page, 'whenPickable');
  await settle(page);
  await hoverAndSelect(page, 'cmp/R1', 'R1');
  expect(errors).toEqual([]);
});

/**
 * A glTF box (metres, Y up, seating plane at y = 0), `x × y × z` millimetres, one colour, with
 * its buffer embedded.
 */
function boxGltf(x: number, y: number, z: number): object {
  const [hx, hz] = [x / 2000, z / 2000];
  const h = y / 1000;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faces: [number[], number[][]][] = [
    [
      [0, 1, 0],
      [
        [-hx, h, -hz],
        [-hx, h, hz],
        [hx, h, hz],
        [hx, h, -hz],
      ],
    ],
    [
      [0, -1, 0],
      [
        [-hx, 0, -hz],
        [hx, 0, -hz],
        [hx, 0, hz],
        [-hx, 0, hz],
      ],
    ],
    [
      [1, 0, 0],
      [
        [hx, 0, -hz],
        [hx, h, -hz],
        [hx, h, hz],
        [hx, 0, hz],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [-hx, 0, -hz],
        [-hx, 0, hz],
        [-hx, h, hz],
        [-hx, h, -hz],
      ],
    ],
    [
      [0, 0, 1],
      [
        [-hx, 0, hz],
        [hx, 0, hz],
        [hx, h, hz],
        [-hx, h, hz],
      ],
    ],
    [
      [0, 0, -1],
      [
        [-hx, 0, -hz],
        [-hx, h, -hz],
        [hx, h, -hz],
        [hx, 0, -hz],
      ],
    ],
  ];
  for (const [normal, corners] of faces) {
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(...corner);
      normals.push(...normal);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const buffer = Buffer.concat([
    Buffer.from(new Float32Array(positions).buffer),
    Buffer.from(new Float32Array(normals).buffer),
    Buffer.from(new Uint16Array(indices).buffer),
  ]);
  const bytes = positions.length * 4;
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [0.1, 0.35, 0.8, 1], metallicFactor: 0 } },
    ],
    buffers: [
      {
        byteLength: buffer.length,
        uri: `data:application/octet-stream;base64,${buffer.toString('base64')}`,
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: bytes, target: 34962 },
      { buffer: 0, byteOffset: bytes, byteLength: bytes, target: 34962 },
      { buffer: 0, byteOffset: 2 * bytes, byteLength: indices.length * 2, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: 'VEC3',
        min: [-hx, 0, -hz],
        max: [hx, h, hz],
      },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
  };
}
