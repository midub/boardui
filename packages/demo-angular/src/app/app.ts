import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { BoardViewer, Widget } from '@boardui/angular';
import {
  DEMOS,
  demoHref,
  filesFromList,
  formatSeconds,
  listenForDrops,
  type Sample,
  shortcut,
  summary,
} from '@boardui/demo-shared';
import { BoardUi } from './board-ui';
import { Details, TagCard } from './details';
import { Landing, SamplePicker } from './landing';
import { models, params, session, viewer } from './session';
import { Sidebar } from './sidebar';
import { Stats } from './stats';

@Component({
  selector: 'app-root',
  imports: [BoardViewer, Widget, SamplePicker, Landing, Sidebar, Details, TagCard, Stats],
  providers: [BoardUi],
  host: { '(window:keydown)': 'onKey($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="topbar">
      <a class="brand" href="./" title="boardui">
        <img src="logo.svg" alt="" width="28" height="28" />
        <span>boardui</span>
      </a>
      <span class="tagline">
        IPC-2581 boards in 3D, converted in your browser; part models from gitlab.com
      </span>
      <span class="spacer"></span>
      <label app-sample-picker (open)="openSample($event)"></label>
      <button id="open-button" class="primary" type="button" (click)="pick()">Open file…</button>
      @if (demos().length > 1) {
        <nav class="demo-switch" aria-label="UI framework">
          @for (demo of demos(); track demo.id) {
            @if (demo.current) {
              <a href="./" aria-current="page">{{ demo.name }}</a>
            } @else {
              <a [href]="demo.href">{{ demo.name }}</a>
            }
          }
        </nav>
      }
      <a class="icon-link" href="https://github.com/midub/boardui" title="Source on GitHub">GitHub</a>
    </header>
    <main class="layout">
      @if (state().board; as board) {
        <aside app-sidebar [board]="board" [(xray)]="xray"></aside>
      } @else {
        <aside id="sidebar" class="sidebar" hidden></aside>
      }
      <section id="stage" class="stage" #stage>
        <bui-board-viewer
          id="viewer"
          [backend]="backend"
          [autoRotate]="spin()"
          [xray]="xray()"
          [modelSources]="models.sources"
          [modelsShown]="modelsShown()"
          (load)="models.reset()"
          (modelProgress)="models.update($event)"
          (modelDone)="models.update($event)"
          (select)="ui.onSelect($event)"
          (hover)="ui.hover.set($event)"
        >
          @for (tag of ui.tags(); track tag.info.id) {
            <bui-widget
              [target]="tag.info.id"
              anchor="top"
              [offset]="[0, -6]"
              occlusion="fade"
              class="tag-widget"
            >
              <div app-tag [tag]="tag"></div>
            </bui-widget>
          }
        </bui-board-viewer>
        <div app-landing [hidden]="!!state().board" (pickFile)="pick()" (open)="openSample($event)"></div>
        <div id="progress" class="progress-card" [hidden]="!state().progress">
          <div class="progress-title" id="progress-title">{{ state().progress?.title }}</div>
          <div class="progress-step" id="progress-step">{{ state().progress?.step }}</div>
          <div class="progress-bar">
            <div id="progress-fill" [style.width.%]="percent()"></div>
          </div>
          <div class="progress-foot">
            <span id="progress-time">{{ seconds() }}</span>
            <button id="progress-cancel" type="button" (click)="cancel()">Cancel</button>
          </div>
        </div>
        <div id="error" class="error-card" role="alert" [hidden]="state().status !== 'error'">
          <strong>Couldn’t open the board</strong>
          <p id="error-message">{{ state().error }}</p>
          <button id="error-close" type="button" (click)="dismissError()">Close</button>
        </div>
        <div id="tooltip" class="tooltip" #tooltip [hidden]="!hover()">
          @if (hover(); as h) {
            <strong>{{ h.title }}</strong>
            @if (h.detail) {
              <span>{{ h.detail }}</span>
            }
          }
        </div>
        <div app-details></div>
        @if (showStats) {
          <div app-stats [(spin)]="spin"></div>
        } @else {
          <div id="stats" class="stats" hidden></div>
        }
        <div id="drop-overlay" class="drop-overlay" [hidden]="!dragging()">
          <span>Drop to open</span>
        </div>
      </section>
    </main>
    <input id="file-input" #fileInput type="file" multiple hidden (change)="onFiles($event)" />
  `,
})
export class App {
  protected readonly ui = inject(BoardUi);
  protected readonly state = signal(session.getState());
  protected readonly xray = signal(false);
  protected readonly spin = signal(params.has('spin'));
  protected readonly dragging = signal(false);
  protected readonly backend = params.get('backend') === 'webgl' ? 'webgl' : undefined;
  protected readonly showStats = params.has('stats');
  protected readonly models = models;
  protected readonly modelsShown = signal(models.getState().shown);
  protected readonly hover = computed(() => {
    const info = this.ui.hover();
    return info ? summary(info) : null;
  });
  protected readonly percent = computed(() =>
    Math.round((this.state().progress?.fraction ?? 0) * 100),
  );
  protected readonly seconds = computed(() => {
    const seconds = this.state().progress?.seconds;
    return seconds ? formatSeconds(seconds) : '';
  });
  /** This demo in the other frameworks, with the current query (`?sample=` follows the board). */
  protected readonly demos = computed(() => {
    this.state();
    return DEMOS.map((demo) => ({
      ...demo,
      current: demo.id === 'angular',
      href: demoHref(demo.id, location),
    }));
  });

  private readonly viewerComponent = viewChild.required(BoardViewer);
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly tooltip = viewChild.required<ElementRef<HTMLElement>>('tooltip');
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  #pointer = { x: 0, y: 0 };

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(models.subscribe(() => this.modelsShown.set(models.getState().shown)));
    destroyRef.onDestroy(
      session.subscribe(() => {
        const state = session.getState();
        // A load started: the selection, tags and highlights were the previous board's.
        if (state.generation !== this.state().generation) this.ui.reset();
        this.state.set(state);
      }),
    );
    // Files dropped anywhere on the page.
    destroyRef.onDestroy(
      listenForDrops(window, {
        onDragging: (on) => this.dragging.set(on),
        onFiles: (files) => void session.openFiles(files),
        onError: (error) => session.showError(error),
      }),
    );
    effect(() => {
      document.body.dataset.state = this.state().status;
    });
    effect(() => {
      const board = this.state().board;
      if (board) document.body.dataset.board = board.name;
    });
    // The tooltip follows the pointer, without change detection.
    afterRenderEffect(() => {
      this.ui.hover();
      this.#placeTooltip();
    });
    afterNextRender(() => {
      const element = this.viewerComponent().element;
      element.addEventListener('pointermove', (e) => {
        this.#pointer = { x: e.clientX, y: e.clientY };
        this.#placeTooltip();
      });
      // Open what the URL names once the viewer is there.
      session.viewer = element;
      session.openFromQuery(location.search);
    });
  }

  protected pick(): void {
    this.fileInput().nativeElement.click();
  }

  protected openSample(sample: Sample): void {
    void session.openSample(sample);
  }

  protected onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) void session.openFiles(filesFromList(input.files));
    input.value = '';
  }

  protected cancel(): void {
    session.cancel();
  }

  protected dismissError(): void {
    session.dismissError();
  }

  /** The keyboard shortcuts, while a board is shown. */
  protected onKey(event: KeyboardEvent): void {
    const key = this.state().board ? shortcut(event) : null;
    if (!key) return;
    if (key === 'clear') this.ui.select(null);
    else if (key === 'xray') this.xray.update((on) => !on);
    else if (key === 'focus') {
      const selection = this.ui.selection();
      if (selection) viewer().focus(selection.id);
    } else viewer().setView(key);
  }

  #placeTooltip(): void {
    const element = this.tooltip().nativeElement;
    if (element.hidden) return;
    const rect = this.stage().nativeElement.getBoundingClientRect();
    const { x, y } = this.#pointer;
    element.style.transform = `translate(${x - rect.left + 14}px, ${y - rect.top + 14}px)`;
  }
}
