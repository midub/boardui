import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  detailRows,
  elementNet,
  formatValue,
  isElementId,
  kindLabel,
  label,
  summary,
} from '@boardui/demo-shared';
import { BoardUi, type Tag } from './board-ui';
import { viewer } from './session';

/** The selected element's metadata, with links to its net, pin and component. */
@Component({
  selector: 'div[app-details]',
  host: { id: 'details', class: 'details', '[hidden]': '!ui.selection()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      <header>
        <span [class]="'badge kind-' + v.info.kind">{{ v.kind }}</span>
        <strong class="details-title">{{ v.title }}</strong>
        <button type="button" class="remove" title="Clear selection (Esc)" (click)="ui.select(null)">×</button>
      </header>
      @if (v.detail) {
        <div class="muted details-sub">{{ v.detail }}</div>
      }
      <dl class="facts">
        @for (row of v.rows; track $index) {
          <dt>{{ row.key }}</dt>
          <dd>
            @if (row.link; as id) {
              <button type="button" class="link" (click)="ui.select(id, true)">{{ row.text }}</button>
            } @else {
              {{ row.text }}
            }
          </dd>
        }
      </dl>
      <div class="button-row">
        <button type="button" (click)="focus(v.info.id)">Focus</button>
        @if (v.net; as net) {
          <button type="button" (click)="ui.toggleHighlight(net)">{{ highlighted() ? 'Unhighlight net' : 'Highlight net' }}</button>
        }
        @if (tag(); as tag) {
          <button type="button" (click)="ui.togglePin(v.info.id)">{{ tag.pinned ? 'Unpin tag' : 'Pin tag' }}</button>
        }
      </div>
    }
  `,
})
export class Details {
  protected readonly ui = inject(BoardUi);
  protected readonly view = computed(() => {
    const info = this.ui.selection();
    if (!info) return null;
    const net = elementNet(info);
    return {
      info,
      ...summary(info),
      kind: kindLabel(info.kind),
      net: isElementId(net) ? net : null,
      rows: detailRows(info).map(([key, value]) =>
        isElementId(value)
          ? { key, link: value, text: label(value) }
          : { key, link: null, text: formatValue(key, value) },
      ),
    };
  });
  protected readonly highlighted = computed(() => {
    const net = this.view()?.net;
    return this.ui.highlights().some((h) => h.net === net);
  });
  protected readonly tag = computed(() => {
    const id = this.ui.selection()?.id;
    return this.ui.tags().find((t) => t.info.id === id);
  });

  protected focus(id: string): void {
    viewer().focus(id);
  }
}

/** A tag's content (the widget around it follows its element). */
@Component({
  selector: 'div[app-tag]',
  host: {
    '[class]': "'tag kind-' + tag().info.kind + (tag().pinned ? ' pinned' : '')",
    '[attr.data-id]': 'tag().info.id',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="tag-body" (click)="ui.select(tag().info.id)">
      <b>{{ text().title }}</b>
      @if (text().detail) {
        <span>{{ text().detail }}</span>
      }
    </button>
    <button type="button" class="tag-close" title="Remove tag" (click)="ui.removeTag(tag().info.id)">×</button>
  `,
})
export class TagCard {
  readonly tag = input.required<Tag>();
  protected readonly ui = inject(BoardUi);
  protected readonly text = computed(() => summary(this.tag().info));
}
