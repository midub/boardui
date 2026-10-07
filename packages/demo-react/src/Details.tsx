import {
  detailRows,
  elementNet,
  formatValue,
  isElementId,
  kindLabel,
  label,
  summary,
} from '@boardui/demo-shared';
import type { BoardViewerElement, ElementInfo } from '@boardui/react';
import type { ReactNode } from 'react';
import type { BoardUi, Tag } from './board-ui.js';

/** The selected element's metadata, with links to its net, pin and component. */
export function Details({
  viewer,
  ui,
}: {
  viewer: () => BoardViewerElement;
  ui: BoardUi;
}): ReactNode {
  const info = ui.selection;
  if (!info) return <div id="details" className="details" hidden />;
  const { title, detail } = summary(info);
  const net = elementNet(info);
  const tag = ui.tags.find((t) => t.info.id === info.id);
  const value = (key: string, v: unknown) =>
    isElementId(v) ? (
      <button type="button" className="link" onClick={() => ui.select(v, true)}>
        {label(v)}
      </button>
    ) : (
      formatValue(key, v)
    );
  return (
    <div id="details" className="details">
      <header>
        <span className={`badge kind-${info.kind}`}>{kindLabel(info.kind)}</span>
        <strong className="details-title">{title}</strong>
        <button
          type="button"
          className="remove"
          title="Clear selection (Esc)"
          onClick={() => ui.select(null)}
        >
          ×
        </button>
      </header>
      {detail && <div className="muted details-sub">{detail}</div>}
      <dl className="facts">
        {detailRows(info).map(([k, v]) => [
          <dt key={`${k}:dt`}>{k}</dt>,
          <dd key={`${k}:dd`}>{value(k, v)}</dd>,
        ])}
      </dl>
      <div className="button-row">
        <button type="button" onClick={() => viewer().focus(info.id)}>
          Focus
        </button>
        {isElementId(net) && (
          <button type="button" onClick={() => ui.toggleHighlight(net)}>
            {ui.highlights.some((h) => h.net === net) ? 'Unhighlight net' : 'Highlight net'}
          </button>
        )}
        {tag && (
          <button type="button" onClick={() => ui.togglePin(info.id)}>
            {tag.pinned ? 'Unpin tag' : 'Pin tag'}
          </button>
        )}
      </div>
    </div>
  );
}

/** A tag's content (the widget around it follows its element). */
export function TagCard({ tag, ui }: { tag: Tag; ui: BoardUi }): ReactNode {
  const { info, pinned } = tag;
  const { title, detail } = summary(info);
  return (
    <div className={`tag kind-${info.kind}${pinned ? ' pinned' : ''}`} data-id={info.id}>
      <button type="button" className="tag-body" onClick={() => ui.select(info.id)}>
        <b>{title}</b>
        {detail && <span>{detail}</span>}
      </button>
      <button
        type="button"
        className="tag-close"
        title="Remove tag"
        onClick={() => ui.removeTag(info.id)}
      >
        ×
      </button>
    </div>
  );
}

/** The hover tooltip's content. */
export function TooltipContent({ info }: { info: ElementInfo }): ReactNode {
  const { title, detail } = summary(info);
  return (
    <>
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </>
  );
}
