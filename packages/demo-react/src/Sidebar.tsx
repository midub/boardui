import {
  type Board,
  boardFacts,
  boardStep,
  COMPONENTS_COLOR,
  downloadGlb,
  formatCount,
  type LayerRow,
  label,
  layerRows,
  netList,
  searchNets,
  warningsTitle,
} from '@boardui/demo-shared';
import type { BoardViewerElement } from '@boardui/react';
import { type ReactNode, useMemo, useState } from 'react';
import type { BoardUi } from './board-ui.js';

interface Props {
  viewer: BoardViewerElement;
  board: Board;
  ui: BoardUi;
  xray: boolean;
  onXray: (on: boolean) => void;
}

function Panel({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** The panels of the loaded board. Mounted per board (`key`), so its state is the board's. */
export function Sidebar({ viewer, board, ui, xray, onXray }: Props): ReactNode {
  const warnings = board.conversion?.warnings ?? [];
  return (
    <aside id="sidebar" className="sidebar">
      <Panel title="Board">
        <div className="board-name" title={boardStep(viewer)}>
          {board.name}
        </div>
        <dl className="facts">
          {boardFacts(viewer, board).map(([k, v]) => [
            <dt key={`${k}:dt`}>{k}</dt>,
            <dd key={`${k}:dd`}>{v}</dd>,
          ])}
        </dl>
        <button className="primary wide" type="button" onClick={() => downloadGlb(board)}>
          Download GLB
        </button>
      </Panel>
      <Panel title="View">
        <div className="button-row">
          {(
            [
              ['top', 'Top', 't'],
              ['bottom', 'Bottom', 'b'],
              ['iso', 'Iso', 'i'],
            ] as const
          ).map(([view, text, key]) => (
            <button
              key={view}
              type="button"
              title={`${text} (${key})`}
              onClick={() => viewer.setView(view)}
            >
              {text}
            </button>
          ))}
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            id="xray-toggle"
            checked={xray}
            onChange={(e) => onXray(e.target.checked)}
          />
          <span>X-ray</span>
          <kbd>x</kbd>
        </label>
      </Panel>
      <Layers viewer={viewer} />
      <Nets viewer={viewer} ui={ui} />
      {board.conversion && warnings.length > 0 && (
        <details className="panel warnings">
          <summary>{warningsTitle(board.conversion)}</summary>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>
                {w.line ? <span className="muted">{`line ${w.line}: `}</span> : null}
                {w.message}
                {w.occurrences > 1 ? (
                  <span className="muted">{` (${formatCount(w.occurrences)}×)`}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}

/** Toggles for every layer and drill layer, and for the components. */
function Layers({ viewer }: { viewer: BoardViewerElement }): ReactNode {
  const [layers, setLayers] = useState(() => viewer.layers);
  // Shows the components again; set while they are hidden.
  const [components, setComponents] = useState<{ show: () => void } | null>(null);
  const { board, extra } = layerRows(layers);
  const row = ({ layer, color, role }: LayerRow) => (
    <li key={layer.id}>
      <label className="toggle layer-row" title={layer.id}>
        <input
          type="checkbox"
          checked={layer.visible}
          data-layer={layer.id}
          onChange={(e) => {
            viewer.setLayerVisible(layer.id, e.target.checked);
            setLayers(viewer.layers);
          }}
        />
        <span className="swatch" style={{ background: color }} />
        <span className="layer-name">{layer.name}</span>
        <span className="layer-role">{role}</span>
      </label>
    </li>
  );
  return (
    <Panel title="Layers">
      <label className="toggle layer-row">
        <input
          type="checkbox"
          checked={!components}
          onChange={(e) => {
            if (e.target.checked) {
              components?.show();
              setComponents(null);
            } else {
              setComponents({ show: viewer.hide({ ids: viewer.ids('component') }) });
            }
          }}
        />
        <span className="swatch" style={{ background: COMPONENTS_COLOR }} />
        <span>Components</span>
      </label>
      <ul className="layers" id="layer-list">
        {board.map(row)}
        {extra.length > 0 && <li className="layer-group">Paste and drawings</li>}
        {extra.map(row)}
      </ul>
    </Panel>
  );
}

/** Net search; each result highlights its net in its own colour. */
function Nets({ viewer, ui }: { viewer: BoardViewerElement; ui: BoardUi }): ReactNode {
  const nets = useMemo(() => netList(viewer), [viewer]);
  const [query, setQuery] = useState('');
  const { matches, more } = searchNets(nets, query);
  return (
    <Panel title="Nets">
      <input
        type="search"
        id="net-search"
        placeholder={`Search ${formatCount(nets.length)} nets…`}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          const first = matches[0];
          if (e.key === 'Enter' && first) ui.toggleHighlight(first.id, true);
        }}
      />
      <ul className="net-results">
        {matches.map((net) => (
          <li key={net.id}>
            <button
              type="button"
              className="net-result"
              data-net={net.id}
              onClick={() => ui.toggleHighlight(net.id, true)}
            >
              {net.name}
            </button>
          </li>
        ))}
        {more > 0 && <li className="muted">{`${more} more…`}</li>}
        {query.trim() && !matches.length && <li className="muted">No matching net</li>}
      </ul>
      <ul className="net-active" id="net-active">
        {ui.highlights.map(({ net, color }) => (
          <li key={net}>
            <span className="swatch" style={{ background: color }} />
            <button type="button" className="link" onClick={() => viewer.focus(net)}>
              {label(net)}
            </button>
            <button
              type="button"
              className="remove"
              title="Remove highlight"
              onClick={() => ui.toggleHighlight(net)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
