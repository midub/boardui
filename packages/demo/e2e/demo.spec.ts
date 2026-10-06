// Smoke and screenshot tests of the demo's features on small samples.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { TEST_CASES_REF } from '../src/samples.js';
import { collectErrors, openBoard, screenPoint, settle, viewerCall } from './helpers.js';

const sample = (path: string) =>
  fileURLToPath(new URL(`../../../spec/samples/${path}`, import.meta.url));

test('shows the landing page', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#sample-cards .sample-card')).toHaveCount(1);
  // The IPC consortium test cases are links to the repository at the release tag.
  const testCases = page.locator('#test-case-links a');
  await expect(testCases).toHaveCount(3);
  await expect(testCases.first()).toHaveAttribute(
    'href',
    `https://github.com/midub/boardui/raw/${TEST_CASES_REF}/spec/samples/ipc-testcases/testcase1-RevC-Assembly.xml`,
  );
  await expect(page).toHaveScreenshot('empty.png');
  expect(errors).toEqual([]);
});

test('converts a picked file and downloads the GLB', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await page
    .locator('#file-input')
    .setInputFiles(sample('hand-written/minimal-2layer/minimal-2layer.xml'));
  await expect(page.locator('body')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(page.locator('.board-name')).toHaveText('minimal-2layer');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download GLB' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('minimal-2layer.glb');
  const glb = readFileSync((await download.path()) as string);
  expect(glb.subarray(0, 4).toString()).toBe('glTF');
  expect(errors).toEqual([]);
});

test('opens a boardui GLB without converting', async ({ page }) => {
  await page.goto('./');
  await page.locator('#file-input').setInputFiles(sample('hand-written/slots/slots.glb'));
  await expect(page.locator('body')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(page.locator('.board-name')).toHaveText('slots');
  await expect(page.locator('.warnings')).toHaveCount(0);
});

test('converts a board with a model mapping and its model', async ({ page }) => {
  await page.goto('./');
  await page
    .locator('#file-input')
    .setInputFiles([
      sample('hand-written/user-models/user-models.xml'),
      sample('hand-written/user-models/models.json'),
      sample('hand-written/user-models/r0603.gltf'),
    ]);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  const meshes = await page.evaluate(async () => {
    const glb = (globalThis as unknown as { demo: { board(): { glb: ArrayBuffer } } }).demo.board()
      .glb;
    const length = new DataView(glb).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, length)));
    return json.meshes.map((m: { name: string }) => m.name);
  });
  expect(meshes).toContain('r0603');
});

test('reports files it cannot convert', async ({ page }) => {
  await page.goto('./');
  await page.locator('#file-input').setInputFiles({
    name: 'broken.xml',
    mimeType: 'text/xml',
    buffer: Buffer.from('<IPC-2581><Content>'),
  });
  await expect(page.locator('#error')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#error-message')).toContainText('IPC-2581');
});

test('hover, selection, tags, nets, layers and views', async ({ page }) => {
  const errors = collectErrors(page);
  await openBoard(page, 'sample=minimal-2layer');
  await viewerCall(page, 'setView', 'top');
  await viewerCall(page, 'whenPickable');
  await settle(page);

  // Hover the resistor body: tooltip with its refDes.
  const r1 = await screenPoint(page, 'cmp/R1');
  await page.mouse.move(r1.x, r1.y);
  await expect(page.locator('#tooltip')).toContainText('R1');

  // Click selects it: details panel and a tag widget that follows the component.
  await page.mouse.click(r1.x, r1.y);
  await expect(page.locator('#details')).toContainText('RES-10K');
  const tag = page.locator('board-viewer .tag[data-id="cmp/R1"]');
  await expect(tag).toBeVisible();
  await settle(page);
  const before = await tag.boundingBox();
  await page.getByRole('button', { name: 'Iso', exact: true }).click();
  await settle(page);
  const after = await tag.boundingBox();
  expect(after && before && Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await settle(page);
  await expect(page).toHaveScreenshot('minimal-selected.png');

  // Pinned tags stay when the selection changes; unpinned ones go.
  await page.getByRole('button', { name: 'Pin tag' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#details')).toBeHidden();
  await expect(tag).toBeVisible();

  // Hiding the top copper and components hides widgets of their elements.
  await page.locator('#layer-list input[data-layer="layer/TOP"]').uncheck();
  await page.locator('.layer-row', { hasText: 'Components' }).locator('input').uncheck();
  await settle(page);
  await expect(tag).toBeHidden();
  await page.locator('.layer-row', { hasText: 'Components' }).locator('input').check();
  await page.locator('#layer-list input[data-layer="layer/TOP"]').check();
  await settle(page);
  await expect(tag).toBeVisible();

  // Net search highlights a net and lists it.
  await page.locator('#net-search').fill('N1');
  await page.locator('.net-result', { hasText: 'N1' }).click();
  await expect(page.locator('#net-active')).toContainText('N1');

  // X-ray and the bottom view.
  await page.keyboard.press('x');
  await expect(page.locator('#xray-toggle')).toBeChecked();
  await page.keyboard.press('b');
  await settle(page);
  expect(errors).toEqual([]);
});

test('bottom view of bottom-side parts', async ({ page }) => {
  await openBoard(page, 'sample=bottom-placement');
  await viewerCall(page, 'setView', 'bottom');
  await settle(page);
  await expect(page).toHaveScreenshot('bottom-placement-bottom.png');
});

test('stats overlay', async ({ page }) => {
  await openBoard(page, 'sample=minimal-2layer&stats&spin');
  await expect(page.locator('#stats')).toContainText(/WebGPU|WebGL2/);
  await expect(page.locator('#stats')).toContainText('fps', { timeout: 30_000 });
  await expect(page.locator('#stats')).toContainText('draw calls');
});
