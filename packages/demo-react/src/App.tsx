import {
  DEMOS,
  demoHref,
  filesFromList,
  formatSeconds,
  listenForDrops,
  type Shortcut,
  shortcut,
} from '@boardui/demo-shared';
import { BoardViewer, type BoardViewerElement, Widget } from '@boardui/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useBoardUi } from './board-ui.js';
import { Details, TagCard, TooltipContent } from './Details.js';
import { Landing, SamplePicker } from './Landing.js';
import { Sidebar } from './Sidebar.js';
import { Stats } from './Stats.js';
import { models, params, session } from './session.js';

const logo = `${import.meta.env.BASE_URL}logo.svg`;

/** Links to this demo in the other frameworks, keeping the query; none with one demo. */
function DemoSwitch(): ReactNode {
  if (DEMOS.length < 2) return null;
  return (
    <nav className="demo-switch" aria-label="UI framework">
      {DEMOS.map((demo) =>
        demo.id === 'react' ? (
          <a key={demo.id} href="./" aria-current="page">
            {demo.name}
          </a>
        ) : (
          <a key={demo.id} href={demoHref(demo.id, location)}>
            {demo.name}
          </a>
        ),
      )}
    </nav>
  );
}

export function App(): ReactNode {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const modelsState = useSyncExternalStore(models.subscribe, models.getState);
  const viewerRef = useRef<BoardViewerElement>(null);
  const viewer = useCallback(() => viewerRef.current as BoardViewerElement, []);
  const ui = useBoardUi(viewer, state.generation);
  const [xray, setXray] = useState(false);
  const [spin, setSpin] = useState(params.has('spin'));
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const { board, status, progress, error } = state;

  // Open what the URL names once the viewer is mounted.
  useLayoutEffect(() => {
    session.viewer = viewerRef.current;
    session.openFromQuery(location.search);
  }, []);

  useEffect(() => {
    document.body.dataset.state = status;
  }, [status]);
  useEffect(() => {
    if (board) document.body.dataset.board = board.name;
  }, [board]);

  // The tooltip follows the pointer.
  const placeTooltip = useCallback(() => {
    const element = tooltip.current;
    const rect = stage.current?.getBoundingClientRect();
    if (!element || element.hidden || !rect) return;
    const { x, y } = pointer.current;
    element.style.transform = `translate(${x - rect.left + 14}px, ${y - rect.top + 14}px)`;
  }, []);
  useLayoutEffect(placeTooltip, [ui.hover]);

  // Keyboard shortcuts, with the latest state.
  const onShortcut = useRef<(key: Shortcut) => void>(() => {});
  onShortcut.current = (key) => {
    const v = viewer();
    if (key === 'clear') ui.select(null);
    else if (key === 'xray') setXray(!xray);
    else if (key === 'focus') {
      if (ui.selection) v.focus(ui.selection.id);
    } else v.setView(key);
  };
  const hasBoard = !!board;
  useEffect(() => {
    if (!hasBoard) return;
    const onKey = (e: KeyboardEvent) => {
      const key = shortcut(e);
      if (key) onShortcut.current(key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasBoard]);

  // Files dropped anywhere on the page.
  useEffect(
    () =>
      listenForDrops(window, {
        onDragging: setDragging,
        onFiles: (files) => void session.openFiles(files),
        onError: (e) => session.showError(e),
      }),
    [],
  );

  const pick = () => fileInput.current?.click();

  return (
    <>
      <header className="topbar">
        <a className="brand" href="./" title="boardui">
          <img src={logo} alt="" width="28" height="28" />
          <span>boardui</span>
        </a>
        <span className="tagline">
          IPC-2581 boards in 3D, converted in your browser; part models from gitlab.com
        </span>
        <span className="spacer" />
        <SamplePicker onOpen={(sample) => void session.openSample(sample)} />
        <button id="open-button" className="primary" type="button" onClick={pick}>
          Open file…
        </button>
        <DemoSwitch />
        <a className="icon-link" href="https://github.com/midub/boardui" title="Source on GitHub">
          GitHub
        </a>
      </header>
      <main className="layout">
        {board && viewerRef.current ? (
          <Sidebar
            key={board.id}
            viewer={viewerRef.current}
            board={board}
            ui={ui}
            xray={xray}
            onXray={setXray}
          />
        ) : (
          <aside id="sidebar" className="sidebar" hidden />
        )}
        <section id="stage" className="stage" ref={stage}>
          <BoardViewer
            id="viewer"
            ref={viewerRef}
            backend={params.get('backend') === 'webgl' ? 'webgl' : undefined}
            autoRotate={spin}
            xray={xray}
            modelSources={models.sources}
            modelsShown={modelsState.shown}
            onLoad={() => models.reset()}
            onModelProgress={(e) => models.update(e.detail)}
            onModelDone={(e) => models.update(e.detail)}
            onSelect={(e) => ui.onSelect(e.detail)}
            onHover={(e) => ui.setHover(e.detail)}
            onPointerMove={(e) => {
              pointer.current = { x: e.clientX, y: e.clientY };
              placeTooltip();
            }}
          >
            {ui.tags.map((tag) => (
              <Widget
                key={tag.info.id}
                target={tag.info.id}
                anchor="top"
                offset={[0, -6]}
                occlusion="fade"
                className="tag-widget"
              >
                <TagCard tag={tag} ui={ui} />
              </Widget>
            ))}
          </BoardViewer>
          <Landing
            hidden={!!board}
            onPick={pick}
            onOpen={(sample) => void session.openSample(sample)}
          />
          <div id="progress" className="progress-card" hidden={!progress}>
            <div className="progress-title" id="progress-title">
              {progress?.title}
            </div>
            <div className="progress-step" id="progress-step">
              {progress?.step}
            </div>
            <div className="progress-bar">
              <div
                id="progress-fill"
                style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }}
              />
            </div>
            <div className="progress-foot">
              <span id="progress-time">
                {progress?.seconds ? formatSeconds(progress.seconds) : ''}
              </span>
              <button id="progress-cancel" type="button" onClick={() => session.cancel()}>
                Cancel
              </button>
            </div>
          </div>
          <div id="error" className="error-card" role="alert" hidden={status !== 'error'}>
            <strong>Couldn’t open the board</strong>
            <p id="error-message">{error}</p>
            <button id="error-close" type="button" onClick={() => session.dismissError()}>
              Close
            </button>
          </div>
          <div id="tooltip" className="tooltip" ref={tooltip} hidden={!ui.hover}>
            {ui.hover && <TooltipContent info={ui.hover} />}
          </div>
          <Details viewer={viewer} ui={ui} />
          {params.has('stats') ? (
            <Stats viewer={viewer} spin={spin} onSpin={setSpin} />
          ) : (
            <div id="stats" className="stats" hidden />
          )}
          <div id="drop-overlay" className="drop-overlay" hidden={!dragging}>
            <span>Drop to open</span>
          </div>
        </section>
      </main>
      <input
        id="file-input"
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files;
          if (files) void session.openFiles(filesFromList(files));
          e.target.value = '';
        }}
      />
    </>
  );
}
