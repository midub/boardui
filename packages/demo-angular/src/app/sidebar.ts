import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  model,
} from '@angular/core';
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
import type { ViewPreset } from '@boardui/viewer';
import { BoardUi } from './board-ui';
import { viewer } from './session';

/** Toggles for every layer and drill layer, and for the components. */
@Component({
  selector: 'section[app-layers]',
  host: { class: 'panel' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3>Layers</h3>
    <label class="toggle layer-row">
      <input type="checkbox" [checked]="!components()" (change)="toggleComponents($event)" />
      <span class="swatch" [style.background]="componentsColor"></span>
      <span>Components</span>
    </label>
    <ul class="layers" id="layer-list">
      @for (item of items(); track item.key) {
        @if (item.row; as row) {
          <li>
            <label class="toggle layer-row" [title]="row.layer.id">
              <input
                type="checkbox"
                [checked]="row.layer.visible"
                [attr.data-layer]="row.layer.id"
                (change)="setLayer(row.layer.id, $event)"
              />
              <span class="swatch" [style.background]="row.color"></span>
              <span class="layer-name">{{ row.layer.name }}</span>
              <span class="layer-role">{{ row.role }}</span>
            </label>
          </li>
        } @else {
          <li class="layer-group">Paste and drawings</li>
        }
      }
    </ul>
  `,
})
export class Layers {
  /** The board; the layers are the viewer's. */
  readonly board = input.required<Board>();

  protected readonly componentsColor = COMPONENTS_COLOR;
  protected readonly layers = linkedSignal(() => {
    this.board();
    return viewer().layers;
  });
  /** The board's layers, then a group heading and the paste and drawing layers. */
  protected readonly items = computed(() => {
    const { board, extra } = layerRows(this.layers());
    const row = (r: LayerRow) => ({ key: r.layer.id, row: r });
    return [
      ...board.map(row),
      ...(extra.length ? [{ key: '', row: null }] : []),
      ...extra.map(row),
    ];
  });
  /** Shows the components again; set while they are hidden. */
  protected readonly components = linkedSignal<Board, { show: () => void } | null>({
    source: this.board,
    computation: () => null,
  });

  protected setLayer(id: string, event: Event): void {
    viewer().setLayerVisible(id, (event.target as HTMLInputElement).checked);
    this.layers.set(viewer().layers);
  }

  protected toggleComponents(event: Event): void {
    if ((event.target as HTMLInputElement).checked) {
      this.components()?.show();
      this.components.set(null);
    } else {
      this.components.set({ show: viewer().hide({ ids: viewer().ids('component') }) });
    }
  }
}

/** Net search; each result highlights its net in its own colour. */
@Component({
  selector: 'section[app-nets]',
  host: { class: 'panel' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3>Nets</h3>
    <input
      type="search"
      id="net-search"
      [placeholder]="placeholder()"
      autocomplete="off"
      spellcheck="false"
      [value]="query()"
      (input)="onQuery($event)"
      (keydown.enter)="highlightFirst()"
    />
    <ul class="net-results">
      @for (net of found().matches; track net.id) {
        <li>
          <button
            type="button"
            class="net-result"
            [attr.data-net]="net.id"
            (click)="ui.toggleHighlight(net.id, true)"
          >{{ net.name }}</button>
        </li>
      }
      @if (found().more > 0) {
        <li class="muted">{{ found().more }} more…</li>
      }
      @if (query().trim() && !found().matches.length) {
        <li class="muted">No matching net</li>
      }
    </ul>
    <ul class="net-active" id="net-active">
      @for (highlight of ui.highlights(); track highlight.net) {
        <li>
          <span class="swatch" [style.background]="highlight.color"></span>
          <button type="button" class="link" (click)="focus(highlight.net)">{{ label(highlight.net) }}</button>
          <button
            type="button"
            class="remove"
            title="Remove highlight"
            (click)="ui.toggleHighlight(highlight.net)"
          >×</button>
        </li>
      }
    </ul>
  `,
})
export class Nets {
  /** The board; the nets are the viewer's. */
  readonly board = input.required<Board>();

  protected readonly ui = inject(BoardUi);
  protected readonly label = label;
  protected readonly nets = computed(() => {
    this.board();
    return netList(viewer());
  });
  protected readonly placeholder = computed(
    () => `Search ${formatCount(this.nets().length)} nets…`,
  );
  protected readonly query = linkedSignal({ source: this.board, computation: () => '' });
  protected readonly found = computed(() => searchNets(this.nets(), this.query()));

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected highlightFirst(): void {
    const first = this.found().matches[0];
    if (first) this.ui.toggleHighlight(first.id, true);
  }

  protected focus(net: string): void {
    viewer().focus(net);
  }
}

/** The panels of the loaded board. */
@Component({
  selector: 'aside[app-sidebar]',
  host: { id: 'sidebar', class: 'sidebar' },
  imports: [Layers, Nets],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <h3>Board</h3>
      <div class="board-name" [title]="step()">{{ board().name }}</div>
      <dl class="facts">
        @for (fact of facts(); track $index) {
          <dt>{{ fact[0] }}</dt>
          <dd>{{ fact[1] }}</dd>
        }
      </dl>
      <button class="primary wide" type="button" (click)="download()">Download GLB</button>
    </section>
    <section class="panel">
      <h3>View</h3>
      <div class="button-row">
        @for (view of views; track view.view) {
          <button type="button" [title]="view.title" (click)="setView(view.view)">{{ view.text }}</button>
        }
      </div>
      <label class="toggle">
        <input type="checkbox" id="xray-toggle" [checked]="xray()" (change)="onXray($event)" />
        <span>X-ray</span>
        <kbd>x</kbd>
      </label>
    </section>
    <section app-layers [board]="board()"></section>
    <section app-nets [board]="board()"></section>
    @if (board().conversion; as conversion) {
      @if (conversion.warnings.length) {
        <details class="panel warnings">
          <summary>{{ warningsTitle(conversion) }}</summary>
          <ul>
            @for (w of conversion.warnings; track $index) {
              <li>@if (w.line) {<span class="muted">line {{ w.line }}: </span>}{{ w.message }}@if (w.occurrences > 1) {<span class="muted"> ({{ formatCount(w.occurrences) }}×)</span>}</li>
            }
          </ul>
        </details>
      }
    }
  `,
})
export class Sidebar {
  readonly board = input.required<Board>();
  readonly xray = model.required<boolean>();

  protected readonly views: readonly { view: ViewPreset; text: string; title: string }[] = [
    { view: 'top', text: 'Top', title: 'Top (t)' },
    { view: 'bottom', text: 'Bottom', title: 'Bottom (b)' },
    { view: 'iso', text: 'Iso', title: 'Iso (i)' },
  ];
  protected readonly warningsTitle = warningsTitle;
  protected readonly formatCount = formatCount;
  protected readonly step = computed(() => {
    this.board();
    return boardStep(viewer());
  });
  protected readonly facts = computed(() => boardFacts(viewer(), this.board()));

  protected download(): void {
    downloadGlb(this.board());
  }

  protected setView(view: ViewPreset): void {
    viewer().setView(view);
  }

  protected onXray(event: Event): void {
    this.xray.set((event.target as HTMLInputElement).checked);
  }
}
