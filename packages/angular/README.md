# @boardui/angular

Angular components for [`<board-viewer>`](../viewer/README.md): `<bui-board-viewer>`, a
standalone component with signal inputs for the element's settings and typed outputs for its
events, and `<bui-widget>`, which shows Angular content in a viewer widget that follows a board
element. The wrapper is thin: the element does the work, and its methods are reachable through the
component's `element`.

Needs Angular 22 (`@angular/core` is a peer dependency; the package is compiled in partial mode,
so the application's build links it). Like the other packages it isn't published to npm (v1):
build it from this repository and install it as a tarball, next to `@boardui/viewer` and
`@boardui/converter` (see the root README, "Embedding the viewer"). `three` (`^0.186`) is a peer
dependency. With the Angular CLI, the converter's worker and WASM module need a build step: see
[below](#the-workers-and-wasm-with-the-angular-cli).

```ts
import { Component, signal } from '@angular/core';
import { BoardViewer, type ElementInfo } from '@boardui/angular';

@Component({
  selector: 'app-board',
  imports: [BoardViewer],
  template: `<bui-board-viewer src="board.glb" style="height: 600px" (select)="selected.set($event)" />`,
})
export class Board {
  readonly selected = signal<ElementInfo | null>(null);
}
```

Converting IPC-2581 in the browser through the element, with a widget on the selected component:

```ts
import { Component, signal, viewChild } from '@angular/core';
import { BoardViewer, type ElementInfo, Widget } from '@boardui/angular';

@Component({
  selector: 'app-board',
  imports: [BoardViewer, Widget],
  template: `
    <input type="file" accept=".xml" (change)="open($event)" />
    <bui-board-viewer style="height: 600px" (select)="selected.set($event)">
      @if (selected(); as info) {
        @if (info.kind === 'component') {
          <bui-widget [target]="info.id" anchor="top" [offset]="[0, -6]">
            <span class="tag">{{ info.id }}</span>
          </bui-widget>
        }
      }
    </bui-board-viewer>
  `,
})
export class Board {
  readonly selected = signal<ElementInfo | null>(null);
  private readonly viewer = viewChild.required(BoardViewer);

  open(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    // Converts locally, in a Web Worker, then shows the board.
    if (file) this.viewer().element.loadIpc2581(file).catch(console.error);
  }
}
```

## `<bui-board-viewer>` (`BoardViewer`)

| Input / output | Element | |
|---|---|---|
| `src` | `src` attribute | URL of a GLB to load; failures emit `error` |
| `backend` | `backend` attribute | `'webgl'` uses WebGL2 even where WebGPU is available; read when the element is created |
| `autoRotate` | `autoRotate` | the camera orbits the board; unset leaves the element's setting alone |
| `xray` | `setXray()` | x-ray mode; leave it unset to control it through the element |
| `modelSources` | `modelSources` | runtime model sources, e.g. `[kicadSource()]` of [`@boardui/models`](../models/README.md); a new array starts over; unset leaves the element's alone |
| `modelsShown` | `modelsShown` | runtime models shown, or the placeholder bodies; unset leaves it alone |
| `(hover)` | `bui-hover` | `ElementInfo \| null` (the event's `detail`) |
| `(select)` | `bui-select` | `ElementInfo \| null` |
| `(progress)` | `bui-progress` | `LoadProgress` of `loadIpc2581` |
| `(load)` | `bui-load` | `ElementInfo` of the board (`info('board')`): a board was loaded and replaced the previous one |
| `(unload)` | `bui-unload` | `ElementInfo` of the board that is about to be replaced; `(load)` follows |
| `(error)` | `error` | `ErrorEvent` |
| `(modelProgress)` | `bui-model-progress` | `ModelStatus`: runtime models are loading |
| `(modelDone)` | `bui-model-done` | `ModelStatus`: every component has been tried |
| `element` | the element | `load`, `loadIpc2581`, `highlight`, `hide`, `select`, `focus`, `setView`, `layers`, `info`, `ids`, … |

`autoRotate` and `xray` also take an attribute without a value (`<bui-board-viewer autoRotate>`).
The component is exported as `buiBoardViewer`, so a template can reach the element too:
`<bui-board-viewer #viewer="buiBoardViewer" />` and `viewer.element.setView('top')`.

The component creates the `<board-viewer>` itself and adds it to its own element once the inputs
are set, so `backend` is in place when the element connects (an element written in a template is
connected before its bindings are set). Its own element is the box: `display: block`,
`position: relative` and 400 px high by default, and the `<board-viewer>` inside fills it. Size and
place `bui-board-viewer` (`style`, `class`); style `bui-board-viewer board-viewer` for the
viewer's background. Its content isn't rendered, except `<bui-widget>`s.

A text field's `select` event bubbles, and Angular also listens for `(select)` as a DOM event on
the component's element: the component keeps the `select` events of fields in widgets from
reaching it, so `(select)` only gets the viewer's selection.

## `<bui-widget>` (`Widget`)

`<bui-widget target="cmp/U3">…</bui-widget>` inside a `<bui-board-viewer>` attaches its own element
with `attachWidget(target, element, { anchor, offset, occlusion })`: the viewer moves it over the
board and positions and fades it, and its content is ordinary Angular (bindings, components,
events). `class` and `style` go on that element. Changing `target`, `anchor`, `offset` or
`occlusion` attaches it again (an inline `[offset]="[0, -6]"` compares by value); destroying it
detaches it.

The widget follows the board: it attaches once the viewer has loaded a board with its element
(`bui-load`; at once if it already has), detaches just before that board is replaced
(`bui-unload`, synchronously, while the old board is still there), and attaches again if the
next board has the element too. Without a board, or while the board lacks the element, it isn't
shown; its content stays as it is (Angular renders it as long as the `<bui-widget>` exists).

## The workers and WASM with the Angular CLI

`@boardui/converter` starts its worker with `new Worker(new URL('./worker.js', import.meta.url))`,
the worker loads `new URL('../wasm/boardui_wasm_bg.wasm', import.meta.url)`, the viewer starts
its BVH workers (for meshes of 50,000 triangles or more) the same way with `./bvh.worker.js`,
and `@boardui/models`' STEP loader its worker with `./step.worker.js`, which loads
`../occt/occt-import-js.wasm`.
Vite bundles these; Angular's application builder (esbuild) leaves them as they are in
dependencies, so they resolve next to the app's scripts, and the files must be there:

| File in the app | What |
|---|---|
| `worker.js` | `import './converter/worker.js';` |
| `converter/worker.js` | `@boardui/converter`'s `dist/worker.js`, bundled |
| `wasm/boardui_wasm_bg.wasm` | `@boardui/converter`'s `wasm/boardui_wasm_bg.wasm` |
| `bvh.worker.js` | `@boardui/viewer`'s `dist/bvh.worker.js`, bundled (three-mesh-bvh, three.js) |
| `step.worker.js` | `import './models/step.worker.js';` |
| `models/step.worker.js` | `@boardui/models`' `dist/step.worker.js`, bundled (with occt-import-js's glue) |
| `occt/occt-import-js.wasm` | `@boardui/models`' `occt/occt-import-js.wasm` (7.6 MB, loaded with the first STEP model) |
| `licenses/…` | occt-import-js's and OpenCascade's LGPL-2.1 texts (`occt/LICENSE*.txt`), to ship with the worker |

The Angular demo writes them with esbuild ([`scripts/assets.mjs`](../demo-angular/scripts/assets.mjs))
into a folder that `angular.json` copies into the app as assets, for `ng build` and `ng serve`.
Without them, `loadIpc2581` fails, and so do building the picking structures of large meshes and
reading STEP models (those components keep their placeholders).

## Server-side rendering

Importing `@boardui/angular` on a server is safe (the element is only defined in a browser), but
the components are untested there.

## Development

```sh
pnpm --filter @boardui/angular build   # ng-packagr (partial compilation) → dist/; needs @boardui/viewer built
pnpm --filter @boardui/angular test    # Vitest in jsdom (@angular/build:unit-test)
```

`angular.json` makes this package an Angular CLI workspace with one library project. The Angular
compiler needs TypeScript 6.0, so this package and the Angular demo use the `angular` catalog's
TypeScript instead of the workspace's. The tests run the real `<board-viewer>` in jsdom; the
bundled tests can't replace three.js's renderer with `vi.mock`, so `src/test-setup.ts` gives jsdom
a WebGPU adapter that never comes, and the element works but never renders. The Angular demo
([`packages/demo-angular`](../demo-angular/README.md)) uses the wrapper and is tested end to end.
