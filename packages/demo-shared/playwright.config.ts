import { defineConfig } from '@playwright/test';
import { DEMOS } from './src/frameworks.js';

const PORT = 4173;
const SITE = `http://127.0.0.1:${PORT}/boardui/`;

/**
 * Smoke and screenshot tests of the demos in headless Chromium with software rendering
 * (SwiftShader for WebGL2 and WebGPU), against the built Pages site (`pnpm build && pnpm site`,
 * or `SITE_DIR=<dir>`) served at http://127.0.0.1:4173/boardui/ as GitHub Pages serves it.
 *
 * Each demo app (`DEMOS`) is a project that runs the same tests (`--project react`); the demos
 * look the same, so they share the screenshots in `e2e/*-snapshots/`. Project `site` tests the
 * redirect of `/boardui/`. The screenshots are made in the Playwright image
 * `mcr.microsoft.com/playwright:v1.63.0-noble` (as CI runs them); update them there with
 * `pnpm e2e --update-snapshots`.
 *
 * `REVIEW_OUT=<dir>` also runs `e2e/review.spec.ts`, which writes review images and timings.
 */
export default defineConfig({
  testDir: 'e2e',
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{-snapshotSuffix}{ext}',
  timeout: 240_000,
  expect: { timeout: 60_000, toHaveScreenshot: { maxDiffPixelRatio: 0.015, threshold: 0.25 } },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
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
  projects: [
    ...DEMOS.map((demo) => ({
      name: demo.id,
      testIgnore: 'site.spec.ts',
      use: { baseURL: `${SITE}${demo.id}/` },
    })),
    { name: 'site', testMatch: 'site.spec.ts', use: { baseURL: SITE } },
  ],
  webServer: {
    command: `node dist/build/cli.js serve ${process.env.SITE_DIR ?? '../../site'} ${PORT}`,
    url: SITE,
    reuseExistingServer: !process.env.CI,
  },
});
