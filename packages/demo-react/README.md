# boardui demo (React)

The project's front page in React, <https://midub.github.io/boardui/react/> (hence Vite
`base: '/boardui/react/'`; <https://midub.github.io/boardui/> redirects here), deployed to GitHub
Pages by `.github/workflows/pages.yml` on every push to `master`: drop or pick an IPC-2581 file,
convert it locally in WebAssembly, view it in 3D with `<BoardViewer>`
([`@boardui/react`](../react/README.md)), and download the GLB. Nothing is uploaded.

```sh
pnpm --filter @boardui/demo-react dev       # needs `pnpm build` once (WASM module, viewer, shared code)
pnpm --filter @boardui/demo-react build     # → dist/
pnpm --filter @boardui/demo-react preview   # serves dist/ at http://127.0.0.1:4173/boardui/react/
```

What the demo does, its query parameters, the samples and the tests are the same in every
framework and documented with the shared code: [`packages/demo-shared`](../demo-shared/README.md).
This package is only the React UI:

- `src/App.tsx`: the page (top bar, stage with `<BoardViewer>`, progress, errors, tooltip, drop
  overlay, file input) and the keyboard shortcuts;
- `src/Landing.tsx`: the empty state and the sample picker;
- `src/Sidebar.tsx`: the board, view, layer, net and warning panels;
- `src/Details.tsx`: the details panel, the tags (rendered into `<Widget>`s) and the tooltip;
- `src/board-ui.ts`: selection, hover, tags and net highlights of the loaded board;
- `src/Stats.tsx`: the `?stats` overlay;
- `src/session.ts`: the page's `DemoSession` (opening boards, from `@boardui/demo-shared`).

`vite.config.ts` adds `demoSamples()` (`@boardui/demo-shared/vite`), which serves the sample
boards in dev, copies them into `dist/samples/`, and fails the build if `dist/` contains an IPC
consortium test case.
