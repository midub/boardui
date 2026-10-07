# @boardui/react

React components for [`<board-viewer>`](../viewer/README.md): a typed `<BoardViewer>`, and
`<Widget>`, which renders React children into a viewer widget that follows a board element. The
wrapper is thin: the element does the work, and its methods are reachable through `ref`.

Needs React 19 (custom element properties and events, `ref` as a prop). Like the other packages it
isn't published to npm (v1): build it from this repository and install it as a tarball, next to
`@boardui/viewer` and `@boardui/converter` (see the root README, "Embedding the viewer").
`three` (`^0.186`) is a peer dependency.

```tsx
import { BoardViewer } from '@boardui/react';

<BoardViewer src="board.glb" style={{ height: 600 }} onSelect={(e) => console.log(e.detail)} />;
```

Converting IPC-2581 in the browser through the element (`ref`), with a widget on the selected
component:

```tsx
import { BoardViewer, type BoardViewerElement, type ElementInfo, Widget } from '@boardui/react';
import { useEffect, useRef, useState } from 'react';

function Board({ file }: { file: File }) {
  const viewer = useRef<BoardViewerElement>(null);
  const [selected, setSelected] = useState<ElementInfo | null>(null);
  useEffect(() => {
    // Converts locally, in a Web Worker, then shows the board.
    viewer.current?.loadIpc2581(file).catch(console.error);
  }, [file]);
  return (
    <BoardViewer
      ref={viewer}
      style={{ height: 600 }}
      onLoad={() => setSelected(null)}
      onSelect={(e) => setSelected(e.detail)}
    >
      {selected?.kind === 'component' && (
        <Widget target={selected.id} anchor="top" offset={[0, -6]}>
          <span className="tag">{selected.id}</span>
        </Widget>
      )}
    </BoardViewer>
  );
}
```

## `<BoardViewer>`

| Prop | Element | |
|---|---|---|
| `src` | `src` attribute | URL of a GLB to load; failures call `onError` |
| `backend` | `backend` attribute | `'webgl'` uses WebGL2 even where WebGPU is available; read when the element is created |
| `autoRotate` | `autoRotate` | the camera orbits the board |
| `xray` | `setXray()` | x-ray mode; leave it undefined to control it through the element |
| `onHover` | `bui-hover` | `CustomEvent<ElementInfo \| null>` |
| `onSelect` | `bui-select` | `CustomEvent<ElementInfo \| null>` |
| `onProgress` | `bui-progress` | `CustomEvent<LoadProgress>` of `loadIpc2581` |
| `onLoad` | `bui-load` | `CustomEvent<ElementInfo>`: a board was loaded and is shown (`src`, `load`, `loadIpc2581`); `detail` is `info('board')` |
| `onUnload` | `bui-unload` | `CustomEvent<ElementInfo>`: the board is about to be replaced; the next `onLoad` follows at once |
| `onError` | `error` | `ErrorEvent` |
| `ref` | the element | `load`, `loadIpc2581`, `highlight`, `hide`, `select`, `focus`, `setView`, `layers`, `info`, `ids`, … |

Any other prop (`className`, `style`, `id`, `onPointerMove`, …) goes to `<board-viewer>`. The
handlers may change on every render; the element keeps one listener per event.

## `<Widget>`

`<Widget target="cmp/U3">…</Widget>` inside a `<BoardViewer>` attaches a `<div>` with
`attachWidget(target, div, { anchor, offset, occlusion })` and portals its children into it, so
the widget is ordinary React (state, context, events). `className` goes on that `<div>`, which the
viewer positions and fades. Changing `target`, `anchor`, `offset` or `occlusion` attaches it again;
unmounting detaches it.

Widgets follow the viewer's board on their own, so they can be mounted at any time: a widget
attaches once a board with its element is loaded (`bui-load`; at once if it already is), detaches
just before that board is replaced (`bui-unload`), and attaches again if the next board has the
element too, keeping its children mounted. Without a board, or while the board lacks the
element, a widget renders nothing.

## `<board-viewer>` in JSX

Importing `@boardui/react` also types `<board-viewer>` for JSX, for using the element directly.
React 19 sets its properties and attributes and adds listeners for `on<event>` props:

```tsx
<board-viewer ref={ref} src="board.glb" autoRotate onbui-select={(e) => setSelected(e.detail)} />
```

## Server-side rendering

Importing `@boardui/react` (and `@boardui/viewer`) on a server is safe: the element is only
defined in a browser, and `<BoardViewer>` renders a plain `<board-viewer>` tag, which the browser
upgrades once the module loads there.

## Development

```sh
pnpm --filter @boardui/react build   # tsc → dist/ (needs @boardui/viewer built)
pnpm --filter @boardui/react test    # Vitest + Testing Library in jsdom
```

The tests run the real `<board-viewer>` in jsdom with a stand-in for three.js's `WebGPURenderer`
(`test/setup.ts`), so the element works but never renders. The React demo
([`packages/demo-react`](../demo-react/README.md)) uses the wrapper and is tested end to end.
