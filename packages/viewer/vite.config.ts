import { defineConfig } from 'vite';

// Dev page for manual checks: `pnpm --filter @boardui/viewer dev`.
export default defineConfig({
  root: 'dev',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
