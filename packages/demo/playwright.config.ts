import { defineConfig } from '@playwright/test';

/**
 * Smoke and screenshot tests of the built demo (`pnpm build` first) in headless Chromium with
 * software rendering (SwiftShader for WebGL2 and WebGPU). Screenshots are compared with
 * `e2e/*-snapshots/`, made in the Playwright image `mcr.microsoft.com/playwright:v1.63.0-noble`
 * (as CI runs them); update them there with `pnpm e2e --update-snapshots`.
 *
 * `REVIEW_OUT=<dir>` also runs `e2e/review.spec.ts`, which writes review images and timings.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  expect: { timeout: 60_000, toHaveScreenshot: { maxDiffPixelRatio: 0.015, threshold: 0.25 } },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/boardui/',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--use-vulkan=swiftshader',
        '--use-webgpu-adapter=swiftshader',
      ],
    },
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/boardui/',
    reuseExistingServer: !process.env.CI,
  },
});
