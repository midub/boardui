// The Pages site: `/boardui/` redirects to the default demo, keeping the query and hash, so that
// links from before the per-framework demos (`/boardui/?sample=…&stats&spin`) keep working.
import { expect, test } from '@playwright/test';
import { DEMOS } from '../src/frameworks.js';
import { waitForBoard } from './helpers.js';

const demo = DEMOS[0]?.id;

test('redirects to the default demo, keeping the query and hash', async ({ page }) => {
  await page.goto('./?sample=minimal-2layer&stats#board');
  await expect(page).toHaveURL(
    new RegExp(`/boardui/${demo}/\\?sample=minimal-2layer&stats#board$`),
  );
  await waitForBoard(page);
  await expect(page.locator('.board-name')).toHaveText('minimal-2layer');
});

test('redirects without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: baseURL ?? '' });
  const page = await context.newPage();
  await page.goto('./');
  await expect(page).toHaveURL(new RegExp(`/boardui/${demo}/$`));
  await context.close();
});
