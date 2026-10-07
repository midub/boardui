import { demoSamples } from '@boardui/demo-shared/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served from https://midub.github.io/boardui/react/ (GitHub Pages, .github/workflows/pages.yml).
export default defineConfig({
  base: '/boardui/react/',
  plugins: [react(), demoSamples()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 2000, target: 'es2024' },
});
