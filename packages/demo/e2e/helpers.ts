import { expect, type Page } from '@playwright/test';

/** Console errors and uncaught exceptions of a page. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Opens the demo with a query and waits until the board is shown. */
export async function openBoard(page: Page, query: string, timeout = 180_000): Promise<void> {
  await page.goto(`./?${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-state', /ready|error/, { timeout });
  const error = page.locator('#error');
  if (await error.isVisible()) throw new Error(await error.innerText());
}

/** Waits until the viewer has rendered the current state and widgets are placed. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => (++frames >= 3 ? setTimeout(resolve, 400) : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
}

/**
 * Where an element appears on the screen, found with a probe widget (`attachWidget` with
 * `anchor: 'center'`), in page coordinates.
 */
export async function screenPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate(
    (id) =>
      new Promise<{ x: number; y: number }>((resolve) => {
        const { viewer } = (
          globalThis as unknown as { demo: { viewer: HTMLElement & Record<string, any> } }
        ).demo;
        const probe = document.createElement('div');
        const detach = viewer.attachWidget(id, probe, { anchor: 'center', occlusion: 'none' });
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const rect = probe.getBoundingClientRect();
            detach();
            resolve({ x: rect.left, y: rect.top });
          }),
        );
      }),
    id,
  );
}

/** Calls a method of `<board-viewer>` (via `globalThis.demo.viewer`). */
export async function viewerCall(page: Page, method: string, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(
    ([method, args]) => {
      const { viewer } = (
        globalThis as unknown as { demo: { viewer: Record<string, (...a: unknown[]) => unknown> } }
      ).demo;
      const result = viewer[method as string]?.(...(args as unknown[]));
      return result instanceof Promise ? result.then(() => null) : (result ?? null);
    },
    [method, args] as const,
  );
}
