/**
 * The boardui demo in React: drop or pick an IPC-2581 file (optionally with a model mapping and
 * models) or a boardui GLB, convert it locally in WebAssembly, view it with `<BoardViewer>`
 * (`@boardui/react`), and download the GLB. Opening boards, the samples and the panels' contents
 * are shared with the other demos (`@boardui/demo-shared`).
 *
 * Query parameters: `sample=<id>` opens a sample, `glb=<url>` loads a GLB, `stats` shows the
 * renderer statistics (backend, fps, draw calls, triangles), `spin` orbits the camera
 * continuously (to measure the frame rate), `backend=webgl` forces WebGL2. `globalThis.demo`
 * exposes the viewer and the last load's timings for tests and the console.
 */
import '@boardui/demo-shared/style.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
