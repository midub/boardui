// "The demo converts every sample in the browser" (roadmap M5): each sample is downloaded,
// converted by the WASM converter in a worker and shown.
import { expect, test } from '@playwright/test';
import { SAMPLES } from '../src/samples.js';
import { collectErrors, openBoard } from './helpers.js';

for (const sample of SAMPLES) {
  test(`converts ${sample.id} in the browser`, async ({ page }) => {
    const errors = collectErrors(page);
    await openBoard(page, `sample=${sample.id}`);
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
    await expect(page.locator('.board-name')).toHaveText(sample.name);
    if (sample.models) {
      // The user model replaces the placeholder body: one model mesh, no warnings about it.
      expect(
        await page.evaluate(() => (globalThis as any).demo.viewer.ids('component').length),
      ).toBe(1);
    }
    expect(errors).toEqual([]);
    test.info().annotations.push({
      type: 'conversion',
      description: `${result?.stats.features} features in ${result?.seconds.toFixed(2)} s`,
    });
  });
}
