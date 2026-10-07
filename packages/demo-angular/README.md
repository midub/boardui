# boardui demo (Angular)

The project's front page in Angular, <https://midub.github.io/boardui/angular/> (hence the base
href `/boardui/angular/`), deployed to GitHub Pages by `.github/workflows/pages.yml` on every push
to `master`: drop or pick an IPC-2581 file, convert it locally in WebAssembly, view it in 3D with
`<bui-board-viewer>` ([`@boardui/angular`](../angular/README.md)), and download the GLB. Nothing
is uploaded. It is the same demo as the React one ([`packages/demo-react`](../demo-react/README.md)),
feature for feature and with the same DOM; the top bar links each to the other.

```sh
pnpm --filter @boardui/demo-angular dev     # ng serve at http://localhost:4200/boardui/angular/; needs `pnpm build` once
pnpm --filter @boardui/demo-angular build   # → dist/
```

What the demo does, its query parameters, the samples and the tests are the same in every
framework and documented with the shared code: [`packages/demo-shared`](../demo-shared/README.md).
This package is only the Angular UI: an Angular CLI application (`angular.json`, the application
builder) with standalone components, signals, `OnPush` and no zone.js.

- `src/app/app.ts`: the page (top bar, stage with `<bui-board-viewer>`, progress, errors,
  tooltip, drop overlay, file input) and the keyboard shortcuts;
- `src/app/landing.ts`: the empty state and the sample picker;
- `src/app/sidebar.ts`: the board, view, layer, net and warning panels;
- `src/app/details.ts`: the details panel and the tags (rendered in `<bui-widget>`s);
- `src/app/board-ui.ts`: selection, hover, tags and net highlights of the loaded board;
- `src/app/stats.ts`: the `?stats` overlay;
- `src/app/session.ts`: the page's `DemoSession` (opening boards, from `@boardui/demo-shared`);
- `src/styles.css`: the shared styles (`@boardui/demo-shared/style.css`), and `<bui-board-viewer>`
  filling the stage.

Components that stand for one element of the page use attribute selectors
(`<aside app-sidebar>`), so the DOM is the React demo's and the shared styles and e2e tests apply.

`scripts/assets.mjs` (run by `dev` and `build`) writes `.generated/`, which `angular.json` copies
into the app: the sample boards (`stageSamples` of `@boardui/demo-shared`), and the converter's and
viewer's workers and the WASM module, which Angular's application builder doesn't bundle from
dependencies (see [`@boardui/angular`](../angular/README.md#the-workers-and-wasm-with-the-angular-cli)).
`build` then fails if `dist/` contains an IPC consortium test case (`cli.js check-dist`).
