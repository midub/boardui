// "The demo converts every sample in the browser" (roadmap M5): each sample is downloaded,
// converted by the WASM converter in a worker and shown. The IPC consortium test cases aren't part
// of the demo (it only links to them), so they are opened through the file input from
// `spec/samples/ipc-testcases` (once fetched), as a user who downloaded them would.
import type { Page } from '@playwright/test';
import { SAMPLES, TEST_CASES } from '../src/samples.js';
import { expect, test } from './fixtures.js';
import {
  collectErrors,
  type DemoGlobal,
  openBoard,
  testCaseFile,
  waitForBoard,
} from './helpers.js';

/** Checks the conversion of the board on the page and records its numbers. */
async function checkConversion(page: Page, name: string): Promise<void> {
  const result = await page.evaluate(() => {
    const { demo } = globalThis as unknown as {
      demo: {
        board(): { conversion: { stats: Record<string, number>; seconds: number } | null };
      };
    };
    const conversion = demo.board()?.conversion;
    return conversion ? { stats: conversion.stats, seconds: conversion.seconds } : null;
  });
  expect(result?.stats.features).toBeGreaterThan(0);
  expect(result?.stats.pinsMisplaced).toBe(0);
  await expect(page.locator('#layer-list li').first()).toBeVisible();
  await expect(page.locator('.board-name')).toHaveText(name);
  test.info().annotations.push({
    type: 'conversion',
    description: `${result?.stats.features} features in ${result?.seconds.toFixed(2)} s`,
  });
}

for (const sample of SAMPLES) {
  test(`converts ${sample.id} in the browser`, async ({ page }) => {
    const errors = collectErrors(page);
    await openBoard(page, `sample=${sample.id}`);
    await checkConversion(page, sample.name);
    if (sample.models) {
      // The user model replaces the placeholder body: one model mesh, no warnings about it.
      const components = await page.evaluate(
        () => (globalThis as unknown as DemoGlobal).demo.viewer.ids('component').length,
      );
      expect(components).toBe(1);
    }
    expect(errors).toEqual([]);
  });
}

for (const testCase of TEST_CASES) {
  test(`converts ${testCase.id} in the browser (opened as a file)`, async ({ page }) => {
    const file = testCaseFile(testCase.file);
    const errors = collectErrors(page);
    await page.goto('./');
    await page.locator('#file-input').setInputFiles(file);
    await waitForBoard(page);
    await checkConversion(page, testCase.file.replace(/\.xml$/, ''));
    expect(errors).toEqual([]);
  });
}
