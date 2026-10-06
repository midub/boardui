# boardui demo

The project's front page, <https://midub.github.io/boardui/> (hence Vite `base: '/boardui/'`),
deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `master`: drop or pick
an IPC-2581 file, convert it locally in WebAssembly, view it in 3D with `<board-viewer>`, and
download the GLB. Nothing is uploaded.

```sh
pnpm --filter @boardui/demo dev       # needs `pnpm build` once (WASM module, viewer)
pnpm --filter @boardui/demo build     # → dist/
pnpm --filter @boardui/demo preview   # serves dist/ at http://127.0.0.1:4173/boardui/
```

## What it does

- **Open:** drop or pick an IPC-2581 `.xml`; a boardui `.glb` (loaded without converting); or a
  board with a model mapping (`models.json`, `spec/schema/models.schema.json`) and its glTF/GLB
  models. Dropped folders are walked, and model paths are taken relative to the mapping.
- **Samples:** the KiCad and hand-written boards of `spec/samples` (`src/samples.ts`). The IPC
  consortium test cases are links: download one, then drop it on the page.
- **Progress:** download, then each converter step, with a cancel button.
- **Board panel:** counts, conversion time, GLB size, **Download GLB**, converter warnings.
- **View:** top, bottom (mirrored) and iso views, x-ray; keys `t`, `b`, `i`, `x`, `f` (focus the
  selection), `Esc` (clear the selection).
- **Layers:** toggles for every layer and drill layer, and for the components.
- **Nets:** search; each result highlights its net in its own colour.
- **Hover and select:** a tooltip for the element under the pointer; clicking selects it and shows
  its metadata, with links to its net, pin and component. A selected component, pin or pad gets a
  **tag**: an HTML widget (`attachWidget`) that follows it; **Pin tag** keeps it when the
  selection changes. Tags fade when the board hides their element and disappear with its layer.

Query parameters: `sample=<id>` opens a sample, `glb=<url>` loads a GLB, `stats` shows the
renderer statistics (backend, fps, draw calls, triangles), `spin` orbits the camera continuously,
`backend=webgl` forces WebGL2. To measure the frame rate on a real GPU, open
<https://midub.github.io/boardui/?sample=royalblue54l-feather&stats&spin>, or open `?stats&spin`
and drop test case 1 (36k features, the performance baseline).

## Samples

The Vite config copies the sample files into the build (`dist/samples/…`, about 10 MB) and serves
them from `spec/samples` in dev. Serving them from the demo itself keeps it self-contained: it
works offline and in CI without another host, and the samples always match the demo's version.
GitHub Pages compresses XML, so the KiCad board (9.4 MB) is about 0.8 MB on the wire.

The IPC consortium test cases are test data only (`spec/samples/README.md`, "Rules"), so the demo
doesn't ship or load them. It links to the files in this repository at the release tag
(`TEST_CASES_REF` in `src/samples.ts`); the user downloads one and opens it.
`scripts/check-dist.mjs`, the last step of `pnpm build`, fails the build if `dist/` contains one.

## Limits

The converter is 32-bit WebAssembly, so a conversion can use at most 4 GiB of memory: boards up
to about 250,000 features convert in the browser. Larger boards need the `boardui` CLI; the demo
opens the GLB it writes.

## Tests

- `pnpm test`: unit tests (Vitest).
- `pnpm e2e`: Playwright tests of the built demo in Chromium with software rendering (SwiftShader),
  as CI runs them in `mcr.microsoft.com/playwright:v1.63.0-noble`: every sample converts in the
  browser (the IPC consortium test cases opened through the file input), opening files and GLBs, models, errors, hover, selection, tags, layers, nets, x-ray, the
  stats overlay, and screenshots (`e2e/*-snapshots/`, made in that image).
- `REVIEW_OUT=<dir> [PERF_XML=<file>] pnpm e2e e2e/review.spec.ts`: review images and timings
  (load, conversion, frame rate while orbiting), written to `<dir>`. `-g README` makes only the
  README's images (`docs/images/`, compressed with `pngquant --quality 60-85`).
