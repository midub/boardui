# boardui demos: shared code

The project's front page, <https://midub.github.io/boardui/>: drop or pick an IPC-2581 file,
convert it locally in WebAssembly, view it in 3D, and download the GLB. Nothing is uploaded.

The demo exists once per UI framework, each built on that framework's wrapper of
`<board-viewer>` and feature-identical:

| App | Package | URL |
|---|---|---|
| React | [`packages/demo-react`](../demo-react/README.md) (`@boardui/react`) | <https://midub.github.io/boardui/react/> |
| Angular | [`packages/demo-angular`](../demo-angular/README.md) (`@boardui/angular`) | <https://midub.github.io/boardui/angular/> |

`/boardui/` redirects to `react/`, keeping the query and hash, so links such as
<https://midub.github.io/boardui/?sample=royalblue54l-feather&stats&spin> keep working. Each app
links to the others in the top bar (React | Angular), keeping the query (`?sample=…`) and hash.

This package (`@boardui/demo-shared`, private) holds everything that doesn't depend on the
framework: the samples, opening boards, what the panels show, the page's styles, the build
helpers and the e2e suite. The apps are only UI.

```sh
pnpm build && pnpm site                       # builds everything, assembles site/ (as Pages serves it)
node packages/demo-shared/dist/build/cli.js serve site   # http://127.0.0.1:4173/boardui/
pnpm e2e                                      # Playwright tests of every app (see "Tests")
```

## What the demos do

- **Open:** drop or pick an IPC-2581 `.xml`; a boardui `.glb` (loaded without converting); or a
  board with a model mapping (`models.json`, `spec/schema/models.schema.json`) and its glTF/GLB
  models. Dropped folders are walked, and model paths are taken relative to the mapping.
- **Samples:** the KiCad and hand-written boards of `spec/samples` (`src/samples.ts`). The IPC
  consortium test cases are links: download one, then drop it on the page.
- **Progress:** download, then each converter step, with a cancel button.
- **Board panel:** counts, the exporting software (profile 0.8), conversion time, GLB size,
  **Download GLB**, converter warnings.
- **View:** top, bottom (mirrored) and iso views, x-ray; keys `t`, `b`, `i`, `x`, `f` (focus the
  selection), `Esc` (clear the selection).
- **3D models:** after every load, the viewer replaces placeholder bodies with models of KiCad's
  libraries, fetched from gitlab.com by footprint name (`kicadSource` of `@boardui/models`); the
  panel shows how many components got one, misses and failures, a toggle back to the
  placeholders, and the credits (KiCad's libraries, CC-BY-SA 4.0 with an exception; occt-import-js
  and OpenCascade, LGPL-2.1, whose licences the build serves under `licenses/`).
- **Layers:** toggles for every layer and drill layer, and for the components.
- **Nets:** search; each result highlights its net in its own colour.
- **Hover and select:** a tooltip for the element under the pointer; clicking selects it and shows
  its metadata, with links to its net, pin and component; a component also lists its BOM
  attributes (value, description, MPN, LCSC, … as the source names them; profile 0.8). A selected component, pin or pad gets a
  **tag**: an HTML widget (`attachWidget`) that follows it; **Pin tag** keeps it when the
  selection changes. Tags fade when the board hides their element and disappear with its layer.

Query parameters: `sample=<id>` opens a sample, `glb=<url>` loads a GLB, `models=<url>` adds a
model mapping (`spec/schema/models.schema.json`, `mappingSource`) tried before KiCad, `stats` shows the
renderer statistics (backend, fps, draw calls, triangles), `spin` orbits the camera continuously,
`backend=webgl` forces WebGL2. To measure the frame rate on a real GPU, open
<https://midub.github.io/boardui/?sample=royalblue54l-feather&stats&spin>, or open `?stats&spin`
and drop test case 1 (36k features, the performance baseline). `globalThis.demo` exposes the
viewer, the board and the last load's timings for tests and the console.

## What is shared

- `src/session.ts`: `DemoSession` opens boards (samples with download progress, files, GLB URLs;
  one load at a time, cancellable, with timings and `?sample=` in the URL) and holds the state the
  UI renders (`subscribe` / `getState`); `exposeDemo` sets `globalThis.demo`.
- `src/board.ts`: what the panels show (board facts, layer rows, net search, details, highlight
  colours) and the keyboard shortcuts; `src/files.ts`: classifying dropped or picked files, and
  drops on the window; `src/names.ts`: labels of element IDs and their metadata;
  `src/stats.ts`: the `?stats` overlay's numbers; `src/format.ts`.
- `src/models.ts`: `DemoModels`, the runtime model sources and what the 3D models panel shows.
- `src/samples.ts`: the samples and the test case links; `src/frameworks.ts`: the apps (`DEMOS`)
  and the links between them.
- `src/style.css` (`@boardui/demo-shared/style.css`): the page's styles. The apps render the same
  DOM (ids and classes), so the styles and the e2e tests apply to all of them.
- `@boardui/demo-shared/sizes`: the sample sizes, generated by this package's build.
- `src/build/` (`@boardui/demo-shared/build`, run as `node dist/build/cli.js <command>`): build
  helpers for any build tool: staging the samples into a build (`stage`), the dist check
  (`check-dist`), assembling the Pages site (`site`) and serving it (`serve`).
  `@boardui/demo-shared/vite` is the Vite plugin (`demoSamples()`): samples in dev and in the
  build, and the dist check.

### Adding an app

1. `packages/demo-<id>`, served at `/boardui/<id>/` (its base href), building into `dist/`. It
   renders the page from `DemoSession` with the DOM of `packages/demo-react` (ids and classes),
   imports `@boardui/demo-shared/style.css`, puts the samples into its build (the Vite plugin, or
   `stageSamples` / `cli.js stage <dir>`) and runs `cli.js check-dist dist`. A build tool that
   doesn't bundle `new Worker(new URL(…, import.meta.url))` and `.wasm` URLs in dependencies needs
   the workers and the WASM module next to its scripts, as `packages/demo-angular` does
   (`scripts/assets.mjs`).
2. Add `{ id, name }` to `DEMOS` in `src/frameworks.ts`. Pages then deploys it at
   `site/<id>/` (`pnpm site`), the e2e suite runs against it as project `<id>`, and every app
   shows the switch.

## Samples

The demo builds copy the sample files into the build (`dist/samples/…`, about 10 MB) and dev
servers serve them from `spec/samples`. Serving them from the demo itself keeps it
self-contained: it works offline and in CI without another host, and the samples always match the
demo's version. GitHub Pages compresses XML, so the KiCad board (9.4 MB) is about 0.8 MB on the
wire.

The IPC consortium test cases are test data only, and the repository doesn't host them
(`spec/samples/README.md`, "Rules"), so the demos don't ship or load them. They link to the
consortium's archives (`TEST_CASES` in `src/samples.ts`) and name the file to open from each; the
user downloads one and opens the file. The dist check (`src/build/check-dist.ts`) fails a demo's
build, and `pnpm site`, if a file has the name or the content (the SHA-256 in
`spec/samples/ipc-testcases/sources.json`) of one of them.

## Limits

The converter is 32-bit WebAssembly, so a conversion can use at most 4 GiB of memory: boards up
to about 250,000 features convert in the browser. Larger boards need the `boardui` CLI; the demo
opens the GLB it writes.

## Tests

- `pnpm test`: unit tests (Vitest) of the shared code and the build helpers.
- `pnpm e2e` (root, or `pnpm --filter @boardui/demo-shared e2e`): Playwright tests of the built
  site (`pnpm build && pnpm site`; `SITE_DIR=<dir>` for another one) in Chromium with software
  rendering (SwiftShader), as CI runs them in `mcr.microsoft.com/playwright:v1.63.0-noble`. Every
  app is a project (`--project react`, `--project angular`) and runs the same tests: every sample
  converts in the browser (the IPC consortium test cases opened through the file input; skipped
  unless fetched, see `spec/samples/ipc-testcases/README.md`), opening files and GLBs, models,
  errors, hover, selection, tags, layers, nets, x-ray, the stats overlay, the links between the
  apps, runtime models, and screenshots. gitlab.com is intercepted for the whole suite
  (`e2e/fixtures.ts`): every request gets a 404, so no test reaches KiCad's libraries; the models
  tests serve self-made footprints, a STEP box and a glTF box in their place. The apps look the same, so they share the screenshots
  (`e2e/*-snapshots/`, made in that image); the switch, which marks each app's own framework, is
  masked in them. Project `site` tests the redirect of `/boardui/`.
- `REVIEW_OUT=<dir> [PERF_XML=<file>] pnpm e2e --project react e2e/review.spec.ts`: review images
  and timings (load, conversion, frame rate while orbiting), written to `<dir>`. `-g README` makes
  only the README's images (`docs/images/`, compressed with `pngquant --quality 60-85`).
