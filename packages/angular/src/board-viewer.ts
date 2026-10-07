import '@boardui/viewer';
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  effect,
  inject,
  input,
  type OnInit,
  output,
  ViewEncapsulation,
} from '@angular/core';
import type {
  BoardViewerElement,
  ElementInfo,
  LoadProgress,
  ModelSource,
  ModelStatus,
} from '@boardui/viewer';

/** `undefined` stays `undefined` (the element's setting is left alone), anything else is a boolean. */
function optionalBoolean(value: unknown): boolean | undefined {
  return value === undefined ? undefined : booleanAttribute(value);
}

/**
 * `<board-viewer>` as an Angular component: `src`, `backend`, `autoRotate`, `xray`,
 * `modelSources` and `modelsShown` as signal inputs, its events as the outputs `hover`, `select`,
 * `progress`, `load`, `unload`, `error`, `modelProgress` and `modelDone`, and the element as
 * {@link element} for its methods. Its content is not rendered, except
 * {@link Widget}s, which the viewer shows over the board.
 *
 * The component's element is the box: it is `display: block` and 400 px high by default, and the
 * `<board-viewer>` inside fills it (style the inner `board-viewer` for its background).
 *
 * @example
 * ```html
 * <bui-board-viewer #viewer="buiBoardViewer" src="board.glb" style="height: 600px"
 *   (select)="selected.set($event)" />
 * <button (click)="viewer.element.setView('top')">Top</button>
 * ```
 */
@Component({
  selector: 'bui-board-viewer',
  exportAs: 'buiBoardViewer',
  template: '',
  styles: `
    bui-board-viewer { display: block; position: relative; height: 400px; }
    bui-board-viewer > board-viewer { position: absolute; inset: 0; height: auto; }
  `,
  // The styles are for the <board-viewer> that the component creates, outside its template.
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardViewer implements OnInit {
  /** URL of a GLB to load (the `src` attribute); failures emit {@link error}. */
  readonly src = input<string | undefined>();
  /**
   * `'webgl'` uses WebGL2 even where WebGPU is available. Read when the element is created;
   * changing it later has no effect.
   */
  readonly backend = input<'webgl' | undefined>();
  /** Whether the camera orbits the board on its own (`autoRotate`); unset leaves it alone. */
  readonly autoRotate = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });
  /** X-ray mode (`setXray`). Leave it unset to control x-ray through the element. */
  readonly xray = input<boolean | undefined, unknown>(undefined, { transform: optionalBoolean });
  /**
   * Where runtime models come from (`modelSources`), e.g. `[kicadSource()]` of `@boardui/models`;
   * a new array starts over. Unset leaves the element's sources alone.
   */
  readonly modelSources = input<readonly ModelSource[] | undefined>();
  /** Runtime models shown or the placeholder bodies (`modelsShown`); unset leaves it alone. */
  readonly modelsShown = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });

  /** The element under the pointer changed (`bui-hover`); `null` off the board. */
  readonly hover = output<ElementInfo | null>();
  /** The user clicked an element, or empty space (`bui-select`, `null`). */
  readonly select = output<ElementInfo | null>();
  /** Progress of `loadIpc2581` (`bui-progress`). */
  readonly progress = output<LoadProgress>();
  /**
   * A board was loaded and replaced the previous one (`bui-load`), from `src`, `load` or
   * `loadIpc2581`: `info('board')`.
   */
  readonly load = output<ElementInfo>();
  /** The board is about to be replaced (`bui-unload`); the next one follows with {@link load}. */
  readonly unload = output<ElementInfo>();
  /** Loading {@link src} failed (`error`). */
  readonly error = output<ErrorEvent>();
  /** Runtime models are loading (`bui-model-progress`). */
  readonly modelProgress = output<ModelStatus>();
  /** Every component has been tried for a runtime model (`bui-model-done`). */
  readonly modelDone = output<ModelStatus>();

  /** The `<board-viewer>` element, for its methods (`load`, `loadIpc2581`, `highlight`, …). */
  readonly element: BoardViewerElement = inject(DOCUMENT).createElement('board-viewer');
  readonly #host: HTMLElement = inject(ElementRef).nativeElement;

  constructor() {
    const element = this.element;
    element.addEventListener('bui-hover', (e) => this.hover.emit(e.detail));
    element.addEventListener('bui-select', (e) => this.select.emit(e.detail));
    element.addEventListener('bui-progress', (e) => this.progress.emit(e.detail));
    element.addEventListener('bui-load', (e) => this.load.emit(e.detail));
    element.addEventListener('bui-unload', (e) => this.unload.emit(e.detail));
    element.addEventListener('error', (e) => this.error.emit(e));
    element.addEventListener('bui-model-progress', (e) => this.modelProgress.emit(e.detail));
    element.addEventListener('bui-model-done', (e) => this.modelDone.emit(e.detail));
    // Angular also listens for `(select)` as a DOM event on this component's element, and a text
    // field's `select` event bubbles: keep those of fields in widgets from reaching it.
    element.addEventListener('select', (e) => e.stopPropagation());

    effect(() => this.#setSrc(this.src()));
    effect(() => {
      const on = this.autoRotate();
      if (on !== undefined) element.autoRotate = on;
    });
    effect(() => {
      const on = this.xray();
      if (on !== undefined && element.xray !== on) element.setXray(on);
    });
    effect(() => {
      const sources = this.modelSources();
      if (sources !== undefined) element.modelSources = sources;
    });
    effect(() => {
      const on = this.modelsShown();
      if (on !== undefined && element.modelsShown !== on) element.modelsShown = on;
    });
  }

  ngOnInit(): void {
    // The element reads `backend` when it connects: it is connected only now that the inputs are
    // set (Angular would connect an element of the template before setting its bindings).
    const backend = this.backend();
    if (backend) this.element.setAttribute('backend', backend);
    this.#setSrc(this.src());
    this.#host.prepend(this.element);
  }

  #setSrc(src: string | undefined): void {
    if (!src) this.element.removeAttribute('src');
    else if (this.element.getAttribute('src') !== src) this.element.setAttribute('src', src);
  }
}
