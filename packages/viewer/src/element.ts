import type { ConvertCallOptions, ConvertResult } from '@boardui/converter';
import { type Box3, Color, type Material, Matrix4, Mesh, Ray, Vector3 } from 'three';
import type { LayerRole, Side } from './board-extension.js';
import { BoardModel, type ElementInfo, type LayerModel, type ListableKind } from './board-model.js';
import { BvhBuilder, WORKER_MIN_TRIANGLES } from './bvh-builder.js';
import { type ViewPreset, viewDirection } from './camera.js';
import { type BoardSource, loadGltf } from './load.js';
import { BoardMaterials, XRAY_COPPER_OPACITY, XRAY_OPACITY } from './materials.js';
import { ModelCache } from './model-cache.js';
import type { ModelSource } from './model-sources.js';
import { Picker } from './picking.js';
import { BoardRenderer, type RenderStats } from './renderer.js';
import { type ModelMemory, type ModelStatus, RuntimeModels } from './runtime-models.js';
import { ElementState } from './state.js';
import { OCCLUSION_INTERVAL, WidgetLayer, type WidgetOptions } from './widgets.js';

/** Elements to highlight or hide: a list of IDs, or one net. */
export type ElementTarget = { ids: readonly string[] } | { net: string };

/** A layer as listed by {@link BoardViewerElement.layers}. */
export interface LayerState {
  id: string;
  name: string;
  /** `'drill'` for drill layers, which have no role or side. */
  kind: 'layer' | 'drill';
  role?: LayerRole;
  side?: Side;
  /** Base colour of the layer's material as a CSS hex colour (sRGB), e.g. for a swatch. */
  color?: string;
  visible: boolean;
}

/** Progress of {@link BoardViewerElement.loadIpc2581}. */
export interface LoadProgress {
  /** `'convert'` while the converter runs (in a worker), then `'load'`. */
  stage: 'convert' | 'load';
  /** The converter's pipeline step (e.g. `'parse'`, `'resolve'`), or `'load'`. */
  step: string;
  /** Estimated share of the whole job done, `0…1`. */
  fraction: number;
}

/** Options of {@link BoardViewerElement.loadIpc2581}. */
export interface LoadIpc2581Options extends Omit<ConvertCallOptions, 'onProgress'> {
  /** Called as the conversion and loading progress; `bui-progress` events carry the same. */
  onProgress?: (progress: LoadProgress) => void;
}

/** Events of `<board-viewer>`. */
export interface BoardViewerEventMap extends HTMLElementEventMap {
  /** The element under the pointer changed; `null` when the pointer left the board. */
  'bui-hover': CustomEvent<ElementInfo | null>;
  /** The user clicked an element, or empty space (`null`). */
  'bui-select': CustomEvent<ElementInfo | null>;
  /** Progress of {@link BoardViewerElement.loadIpc2581}. */
  'bui-progress': CustomEvent<LoadProgress>;
  /**
   * A board was loaded (`src`, `load` or `loadIpc2581`) and replaced the previous one; widgets,
   * highlights and `info()` work on it now. `detail` is `info('board')`.
   */
  'bui-load': CustomEvent<ElementInfo>;
  /**
   * The loaded board is about to be replaced by another one, which follows with `bui-load`.
   * The board is still loaded while listeners run. `detail` is `info('board')`.
   */
  'bui-unload': CustomEvent<ElementInfo>;
  /**
   * Runtime models are loading for the loaded board ({@link BoardViewerElement.modelSources}):
   * sent after each batch of models swapped in. `detail` is a snapshot of the status.
   */
  'bui-model-progress': CustomEvent<ModelStatus>;
  /**
   * Every component with a placeholder body has been tried; `detail` is the final status. Not
   * sent when a load, unload or new sources stop the run first.
   */
  'bui-model-done': CustomEvent<ModelStatus>;
}

/** Constant depth bias of the soldermask, in units of the depth buffer's resolution. */
const MASK_DEPTH_BIAS = 4;
/** Share of {@link LoadProgress.fraction} taken by the conversion; loading takes the rest. */
const CONVERT_SHARE = 0.9;

/** Pointer travel (CSS px) below which a press and release count as a click. */
const CLICK_SLOP = 4;
/** `focus(id)` leaves room around the element, as a factor of its size. */
const FOCUS_MARGIN = 4;

const STYLE = `
:host { display: block; position: relative; height: 400px; overflow: hidden; background: #1d2026; }
canvas { display: block; width: 100%; height: 100%; touch-action: none; outline: none; }
.overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
::slotted(*) { position: absolute; left: 0; top: 0; pointer-events: auto; will-change: transform; }
`;

/**
 * `HTMLElement`, or a stand-in where there is none (server-side rendering in Node), so that the
 * module can be imported there; the element is only defined in a browser.
 */
const ElementBase: typeof HTMLElement =
  globalThis.HTMLElement ?? (class {} as unknown as typeof HTMLElement);

interface Loaded {
  model: BoardModel;
  state: ElementState;
  materials: BoardMaterials;
  picker: Picker;
  /**
   * Layers that the pointer picks and that hide widgets: all but the translucent soldermask.
   * Dielectric sheets only block: over bare board the pointer finds nothing.
   */
  pickLayers: LayerModel[];
  /** Tint overlays of the copper and drill layers, with their state texel ranges. */
  overlays: { mesh: Mesh; start: number; end: number }[];
  /** Builds the BVHs of large layer meshes in workers; `null` until needed. */
  bvhs: BvhBuilder | null;
  /** Resolves when every pickable layer has its BVH. */
  pickable: Promise<void>;
}

/**
 * `<board-viewer>`: shows a boardui glTF board (spec/README.md) with orbit controls, layer
 * toggles, hover and selection, highlights, x-ray and HTML widgets.
 *
 * Attributes: `src` (URL of a GLB to load; failures dispatch an `error` event),
 * `backend="webgl"` (use the WebGL2 backend even where WebGPU is available; read when the
 * element connects).
 *
 * Every board that is loaded dispatches `bui-load` once it is in place, and `bui-unload` just
 * before another board replaces it; a failed load dispatches neither and keeps the current board.
 *
 * The soldermask is translucent (spec §6.5): the pointer picks, and widgets see, through it.
 * Dielectric sheets can't be hovered or selected, but they hide what lies behind the board.
 *
 * Element IDs follow spec §5. Methods that take one ID throw a `RangeError` for an unknown ID;
 * methods that take several skip unknown ones. All need a loaded board.
 */
export class BoardViewerElement extends ElementBase {
  static readonly observedAttributes = ['src'];

  readonly #canvas = document.createElement('canvas');
  readonly #widgets = new WidgetLayer({
    box: (id) => this.#widgetBox(id),
    visible: (id) => this.#widgetVisible(id),
    occluded: (id, from, to) => this.#occluded(id, from, to),
  });
  /** Bounding boxes of the widget targets of the loaded board, resolved once each. */
  readonly #widgetBoxes = new Map<string, Box3 | null>();
  /** Whether a widget target is drawn, as of {@link #visibility}. */
  readonly #widgetVisibility = new Map<string, { version: number; visible: boolean }>();
  /** Bumped whenever layers or elements are shown or hidden. */
  #visibility = 0;
  readonly #resize = new ResizeObserver(() => this.#onResize());
  readonly #ray = new Ray();
  #renderer: BoardRenderer | null = null;
  #rendererPending: Promise<void> | null = null;
  #loaded: Loaded | null = null;
  #loadToken = 0;
  #hover: string | null = null;
  #selection: string | null = null;
  #xray = false;
  #autoRotate = false;
  /** Pointer position while it is over the canvas with no button pressed. */
  #pointer: { x: number; y: number } | null = null;
  /** Whether the element under the pointer must be picked again. */
  #hoverStale = false;
  #press: { x: number; y: number } | null = null;
  #settleUntil = 0;
  readonly #lastView = new Matrix4();
  #modelSources: readonly ModelSource[] = [];
  #modelsShown = true;
  #modelRun: RuntimeModels | null = null;
  #modelCache: ModelCache | null = null;
  /** Models loaded for the current board, so that switching sources or reloading reuses them. */
  readonly #modelMemory: ModelMemory = new Map();

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.part.add('overlay');
    overlay.append(Object.assign(document.createElement('slot'), { name: 'widget' }));
    shadow.append(style, this.#canvas, overlay);
    this.#canvas.addEventListener('pointermove', (e) => this.#onPointerMove(e));
    this.#canvas.addEventListener('pointerleave', () => this.#onPointerMove(null));
    this.#canvas.addEventListener('pointerdown', (e) => {
      this.#press = { x: e.clientX, y: e.clientY };
    });
    this.#canvas.addEventListener('pointerup', (e) => this.#onPointerUp(e));
  }

  connectedCallback(): void {
    this.#resize.observe(this);
    this.#rendererPending ??= BoardRenderer.create(
      this.#canvas,
      (now) => this.#beforeRender(now),
      this.getAttribute('backend') === 'webgl',
    ).then((renderer) => {
      if (!this.isConnected) {
        renderer.dispose();
        this.#rendererPending = null;
        return;
      }
      this.#renderer = renderer;
      renderer.autoRotate = this.#autoRotate;
      this.#onResize();
      this.#showLoaded();
    });
  }

  disconnectedCallback(): void {
    this.#resize.disconnect();
    this.#renderer?.dispose();
    this.#renderer = null;
    this.#rendererPending = null;
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === 'src' && value) {
      this.load(value).catch((error: unknown) => {
        this.dispatchEvent(new ErrorEvent('error', { error, message: String(error) }));
      });
    }
  }

  /**
   * Loads a boardui asset, replacing the current board. Highlights, hidden elements and the
   * selection are reset; widgets stay attached. Dispatches `bui-unload` for the current board
   * just before it is replaced, and `bui-load` once the new one is in place (before the returned
   * promise resolves). If another load starts first, this one is dropped: it resolves without
   * events.
   *
   * @param source URL of a GLB, or its bytes.
   * @throws if the asset can't be loaded or is not a boardui asset; the current board stays.
   */
  async load(source: BoardSource): Promise<void> {
    const token = ++this.#loadToken;
    const model = await BoardModel.fromGltf(await loadGltf(source));
    if (token !== this.#loadToken) {
      model.dispose();
      return;
    }
    const state = new ElementState(model.stateCount);
    const materials = new BoardMaterials(state);
    const overlays: Loaded['overlays'] = [];
    for (const layer of model.layers) {
      const copper = !('role' in layer.info) || layer.info.role === 'COPPER';
      for (const mesh of layer.meshes) {
        const source = mesh.material as Material;
        const xray = copper ? XRAY_COPPER_OPACITY : XRAY_OPACITY;
        mesh.material = materials.layer(source, layer.stateOffset, xray);
        if ('role' in layer.info && layer.info.role === 'SOLDERMASK') {
          // The mask's bottom face lies on the dielectric and the copper (spec §6.5, ADR 0006):
          // push it back a little so that the copper wins where they meet (seen from below with
          // the dielectric hidden). A constant bias only: a slope-scaled one pushes the whole
          // mask behind the copper (20 µm below its top) in oblique views.
          const material = mesh.material as Material;
          material.polygonOffset = true;
          material.polygonOffsetFactor = 0;
          material.polygonOffsetUnits = MASK_DEPTH_BIAS;
        }
        if (copper) {
          const overlay = new Mesh(mesh.geometry, materials.overlay(source, layer.stateOffset));
          overlay.renderOrder = 1; // after the soldermask
          layer.group.add(overlay);
          overlays.push({
            mesh: overlay,
            start: layer.stateOffset,
            end: layer.stateOffset + layer.table.count,
          });
        }
      }
    }
    for (const { mesh, rowAttribute } of model.componentBatches) {
      mesh.material = materials.components(
        mesh.material as Material,
        rowAttribute,
        model.componentOffset,
      );
    }
    materials.setXray(this.#xray);
    model.bodies.showModels(this.#modelsShown);
    const pickLayers = model.layers.filter(
      (layer) => !('role' in layer.info) || layer.info.role !== 'SOLDERMASK',
    );
    const picker = new Picker(model);
    const loaded: Loaded = {
      model,
      state,
      materials,
      picker,
      pickLayers,
      overlays,
      bvhs: null,
      pickable: Promise.resolve(),
    };
    this.#unload();
    this.#loaded = loaded;
    this.#showLoaded();
    loaded.pickable = this.#prepareBvhs(loaded);
    this.#dispatch('bui-load', model.describe('board') as ElementInfo);
    if (this.#loaded === loaded) this.#startModels(loaded);
  }

  /**
   * Whether a board is loaded: from its `bui-load` on (methods that need a board work then).
   * Stays `true` while another board loads, until that one replaces it.
   */
  get loaded(): boolean {
    return this.#loaded !== null;
  }

  /**
   * Converts an IPC-2581 file with `@boardui/converter` (WebAssembly in a Web Worker; nothing
   * leaves the machine) and loads the result, replacing the current board. Progress is reported
   * to `options.onProgress` and as `bui-progress` events.
   *
   * @param input The XML file or its bytes (an `ArrayBuffer` is transferred and detached).
   * @param options Converter options (`models`, `tolerance`, …) and `signal` to cancel.
   * @returns The conversion: the GLB (for download), warnings, stats and timings.
   * @throws `ConvertError` if the file can't be converted.
   */
  async loadIpc2581(
    input: Blob | ArrayBuffer | Uint8Array,
    options: LoadIpc2581Options = {},
  ): Promise<ConvertResult> {
    const { onProgress, ...convertOptions } = options;
    const report = (progress: LoadProgress) => {
      onProgress?.(progress);
      this.#dispatch('bui-progress', progress);
    };
    report({ stage: 'convert', step: 'start', fraction: 0 });
    const { convertIpc2581 } = await import('@boardui/converter');
    const result = await convertIpc2581(input, {
      ...convertOptions,
      onProgress: ({ step, fraction }) =>
        report({ stage: 'convert', step, fraction: fraction * CONVERT_SHARE }),
    });
    options.signal?.throwIfAborted();
    report({ stage: 'load', step: 'load', fraction: CONVERT_SHARE });
    await this.load(result.glb);
    report({ stage: 'load', step: 'done', fraction: 1 });
    return result;
  }

  /**
   * Resolves when the loaded board can be picked everywhere: the BVHs of large layers are built
   * in workers after loading, and until then hover and widget occlusion skip those layers.
   */
  whenPickable(): Promise<void> {
    return this.#loaded?.pickable ?? Promise.resolve();
  }

  /** The layers and drill layers of the loaded board, top to bottom. */
  get layers(): LayerState[] {
    return (this.#loaded?.model.layers ?? []).map((layer) => {
      const info = layer.info;
      const state: LayerState = {
        id: layer.id,
        name: info.name,
        kind: layer.kind,
        visible: layer.group.visible,
      };
      if (layer.color) state.color = layer.color;
      if ('role' in info) {
        state.role = info.role;
        state.side = info.side;
      }
      return state;
    });
  }

  /** Shows or hides a layer or drill layer. */
  setLayerVisible(id: string, visible: boolean): void {
    const layer = this.#model().layer(id);
    if (!layer) throw new RangeError(`Unknown layer: ${id}`);
    layer.group.visible = visible;
    this.#visibility++;
    this.#requestRender();
  }

  /**
   * Where runtime models come from, tried in order for every component with a placeholder body
   * (e.g. `kicadSource()` and `mappingSource(url)` of `@boardui/models`). After each load the
   * models are fetched in the background and replace the placeholders as they arrive
   * (`bui-model-progress`, `bui-model-done`); `bui-load` doesn't wait for them. Setting it starts
   * over for the loaded board. Default: none.
   */
  get modelSources(): readonly ModelSource[] {
    return this.#modelSources;
  }

  set modelSources(sources: readonly ModelSource[]) {
    this.#modelSources = [...sources];
    if (this.#loaded) this.#startModels(this.#loaded);
  }

  /**
   * Whether runtime models are shown (default) or the placeholder bodies they replace. Models
   * embedded by the converter (`--models`) are always shown.
   */
  get modelsShown(): boolean {
    return this.#modelsShown;
  }

  set modelsShown(on: boolean) {
    this.#modelsShown = on;
    const loaded = this.#loaded;
    if (!loaded) return;
    loaded.model.bodies.showModels(on);
    this.#modelsChanged(loaded);
  }

  /** Status of the runtime models of the loaded board, or `null` without sources or board. */
  get modelStatus(): ModelStatus | null {
    return this.#modelRun ? structuredClone(this.#modelRun.status) : null;
  }

  /** Whether x-ray mode is on. */
  get xray(): boolean {
    return this.#xray;
  }

  /**
   * Turns x-ray mode on or off: every layer and component becomes translucent, copper less so
   * than the rest, so that the copper of both sides shows. Layer visibility stays as it is: inner
   * copper (hidden by default) shows only when switched on, since inner planes would cover the
   * view of a multilayer board.
   */
  setXray(on: boolean): void {
    this.#xray = on;
    this.#loaded?.materials.setXray(on);
    this.#requestRender();
  }

  /**
   * Tints elements, for example a net. Later highlights cover earlier ones.
   *
   * @param options.color Any CSS colour.
   * @returns A function that removes the highlight.
   */
  highlight(target: ElementTarget, options: { color: string }): () => void {
    const { state } = this.#require();
    const c = new Color(options.color);
    const remove = state.highlight(this.#texels(target), [c.r, c.g, c.b]);
    this.#requestRender();
    return () => {
      remove();
      this.#requestRender();
    };
  }

  /**
   * Hides elements; they are not drawn and can't be picked.
   *
   * @returns A function that shows them again.
   */
  hide(target: ElementTarget): () => void {
    const show = this.#require().state.hide(this.#texels(target));
    this.#visibility++;
    this.#requestRender();
    return () => {
      show();
      this.#visibility++;
      this.#requestRender();
    };
  }

  /** The selected element's ID, or `null`. */
  get selection(): string | null {
    return this.#selection;
  }

  /** Selects an element (any kind: a net selects all its copper), or clears the selection. */
  select(id: string | null): void {
    const { state, model } = this.#require();
    const texels = id === null ? [] : model.emphasis(this.#resolve(model, id));
    state.setSelection(texels);
    this.#selection = id;
    this.#requestRender();
  }

  /** Gives the element keyboard focus, as `HTMLElement.focus` does. */
  override focus(options?: FocusOptions): void;
  /** Flies the camera to a board element. */
  override focus(id: string): void;
  override focus(target?: string | FocusOptions): void {
    if (typeof target !== 'string') {
      super.focus(target);
      return;
    }
    const box = this.#resolve(this.#model(), target).box;
    if (box) this.#renderer?.frame(box, undefined, true, FOCUS_MARGIN);
  }

  /**
   * Whether the camera orbits the board on its own. The board is then rendered every frame,
   * which is also how to measure the frame rate (see {@link stats}).
   */
  get autoRotate(): boolean {
    return this.#autoRotate;
  }

  set autoRotate(on: boolean) {
    this.#autoRotate = on;
    if (this.#renderer) this.#renderer.autoRotate = on;
  }

  /**
   * Points the camera from above, from below or obliquely, framing what is shown (see
   * {@link frame}).
   */
  setView(view: ViewPreset): void {
    this.#renderer?.frame(this.#shownBounds(this.#require()), viewDirection(view));
  }

  /**
   * Frames what is shown, keeping the view direction: visible layers and components, without
   * hidden elements, so that drawings on a hidden layer (e.g. a documentation layer) don't widen
   * the view. Showing or hiding layers doesn't move the camera; call this or {@link setView} to
   * frame the new set.
   */
  frame(): void {
    this.#renderer?.frame(this.#shownBounds(this.#require()));
  }

  /**
   * Shows an HTML element above the board, following a board element. The element is moved into
   * `<board-viewer>` (`slot="widget"`), so page styles apply to it.
   *
   * @returns A function that removes the element again.
   */
  attachWidget(id: string, element: HTMLElement, options: WidgetOptions = {}): () => void {
    this.#resolve(this.#model(), id);
    element.slot = 'widget';
    this.append(element);
    const detach = this.#widgets.attach(id, element, options);
    this.#requestRender();
    return () => {
      detach();
      element.remove();
      element.removeAttribute('slot');
    };
  }

  /** Metadata of an element, or `null` if the ID is unknown. */
  info(id: string): ElementInfo | null {
    return this.#loaded?.model.describe(id) ?? null;
  }

  /** IDs of all layers, components, pins or nets of the loaded board. */
  ids(kind: ListableKind): string[] {
    return this.#loaded?.model.ids(kind) ?? [];
  }

  /** Statistics of the last rendered frame, or `null` before the first one. */
  stats(): RenderStats | null {
    return this.#renderer?.stats() ?? null;
  }

  override addEventListener<K extends keyof BoardViewerEventMap>(
    type: K,
    listener: (this: BoardViewerElement, event: BoardViewerEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  override removeEventListener<K extends keyof BoardViewerEventMap>(
    type: K,
    listener: (this: BoardViewerElement, event: BoardViewerEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }

  #model(): BoardModel {
    return this.#require().model;
  }

  #require(): Loaded {
    if (!this.#loaded) throw new Error('No board loaded');
    return this.#loaded;
  }

  #resolve(model: BoardModel, id: string) {
    const resolved = model.resolve(id);
    if (!resolved) throw new RangeError(`Unknown element: ${id}`);
    return resolved;
  }

  #texels(target: ElementTarget): number[] {
    const { model } = this.#require();
    const ids = 'net' in target ? [target.net] : target.ids;
    return ids.flatMap((id) => [...(model.resolve(id)?.texels ?? [])]);
  }

  /** Releases the loaded board, after telling listeners (`bui-unload`). */
  #unload(): void {
    if (!this.#loaded) return;
    this.#dispatch('bui-unload', this.#loaded.model.describe('board') as ElementInfo);
    this.#modelRun?.abort();
    this.#modelRun = null;
    this.#loaded.bvhs?.dispose();
    this.#widgetBoxes.clear();
    this.#widgetVisibility.clear();
    this.#renderer?.setContent([]);
    this.#loaded.materials.dispose();
    this.#loaded.model.dispose();
    this.#loaded = null;
    this.#hover = null;
    this.#selection = null;
  }

  /** Puts the loaded board into the scene and frames it, once both board and renderer exist. */
  #showLoaded(): void {
    const renderer = this.#renderer;
    const loaded = this.#loaded;
    if (!renderer || !loaded) return;
    renderer.setContent([loaded.model.root]);
    // Zoom limits and clipping cover the whole board, hidden layers too.
    renderer.setBounds(loaded.model.bounds);
    renderer.frame(this.#shownBounds(loaded), viewDirection('iso'), false);
  }

  /**
   * Starts loading runtime models for the loaded board, after removing those of an earlier run.
   */
  #startModels(loaded: Loaded): void {
    this.#modelRun?.abort();
    this.#modelRun = null;
    const { model, materials } = loaded;
    const removed = model.bodies.clearModels();
    for (const batch of removed) materials.release(batch.mesh.material as Material);
    if (removed.length) this.#modelsChanged(loaded);
    if (!this.#modelSources.length) return;
    this.#modelCache ??= new ModelCache();
    const run: RuntimeModels = new RuntimeModels({
      model,
      sources: this.#modelSources,
      cache: this.#modelCache,
      memory: this.#modelMemory,
      apply: (key, geometry, rows, matrices) => {
        if (this.#modelRun !== run) return;
        for (const batch of model.bodies.removeModel(key)) {
          materials.release(batch.mesh.material as Material);
        }
        for (const batch of model.bodies.setModel(key, geometry.parts, rows, matrices)) {
          batch.mesh.material = materials.components(
            batch.mesh.material as Material,
            batch.rowAttribute,
            model.componentOffset,
          );
        }
        materials.setXray(this.#xray);
      },
      report: (status) => {
        if (this.#modelRun !== run) return;
        this.#modelsChanged(loaded);
        const type = status.complete ? 'bui-model-done' : 'bui-model-progress';
        this.#dispatch(type, structuredClone(status));
      },
    });
    this.#modelRun = run;
    void run.run();
  }

  /** Bodies changed (runtime models swapped in or out): bounds, widgets and the frame follow. */
  #modelsChanged({ model }: Loaded): void {
    model.updateBounds();
    this.#renderer?.setBounds(model.bounds);
    this.#widgetBoxes.clear();
    this.#visibility++;
    this.#requestRender();
  }

  /** Bounding box of what is shown; the whole board if nothing is. */
  #shownBounds({ model, state }: Loaded): Box3 {
    const box = model.visibleBounds((texel) => state.isHidden(texel));
    return box.isEmpty() ? model.bounds : box;
  }

  /**
   * Builds the BVHs of the pickable layers so that the first hover doesn't stall: large meshes
   * in workers, small ones on the main thread in idle time. Resolves when all are built (or the
   * board was replaced).
   */
  #prepareBvhs(loaded: Loaded): Promise<void> {
    const idleMeshes: Mesh[] = [];
    const builds: Promise<void>[] = [];
    for (const mesh of loaded.pickLayers.flatMap((layer) => layer.meshes)) {
      const triangles = (mesh.geometry.index?.count ?? 0) / 3;
      if (!BvhBuilder.available || triangles < WORKER_MIN_TRIANGLES) {
        idleMeshes.push(mesh);
        continue;
      }
      loaded.bvhs ??= new BvhBuilder();
      loaded.picker.setPending(mesh, true);
      const build = loaded.bvhs.build(mesh.geometry).then(
        (bvh) => {
          if (this.#loaded !== loaded) return;
          loaded.picker.setBvh(mesh, bvh);
          this.#hoverStale = true;
          this.#settleUntil = performance.now() + 2 * OCCLUSION_INTERVAL;
          this.#renderer?.requestRender();
        },
        () => {
          // No worker (e.g. a content security policy): build on first use.
          if (this.#loaded === loaded) loaded.picker.setPending(mesh, false);
        },
      );
      builds.push(build);
    }
    const idle = globalThis.requestIdleCallback ?? ((callback) => setTimeout(callback, 50));
    builds.push(
      new Promise<void>((resolve) => {
        const next = () => {
          const mesh = idleMeshes.shift();
          if (!mesh || this.#loaded !== loaded) {
            resolve();
            return;
          }
          loaded.picker.bvh(mesh);
          idle(next);
        };
        idle(next);
      }),
    );
    return Promise.all(builds).then(() => {});
  }

  #onResize(): void {
    this.#renderer?.resize(this.clientWidth, this.clientHeight);
  }

  #requestRender(): void {
    this.#settleUntil = performance.now() + 2 * OCCLUSION_INTERVAL;
    this.#hoverStale = true;
    this.#renderer?.requestRender();
  }

  #onPointerMove(event: PointerEvent | null): void {
    this.#pointer = event && !event.buttons ? { x: event.clientX, y: event.clientY } : null;
    if (!this.#pointer) this.#setHover(null);
    this.#hoverStale = true;
    this.#renderer?.requestRender();
  }

  #onPointerUp(event: PointerEvent): void {
    const press = this.#press;
    this.#press = null;
    if (!press || Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP) return;
    if (!this.#loaded) return;
    const id = this.#pick(event.clientX, event.clientY);
    this.select(id);
    this.#emit('bui-select', id);
  }

  #pick(clientX: number, clientY: number): string | null {
    const renderer = this.#renderer;
    const loaded = this.#loaded;
    if (!renderer || !loaded) return null;
    const { picker, state, model, pickLayers } = loaded;
    const ray = renderer.rayAt(clientX, clientY, this.#ray);
    const hit = picker.pick(ray, (t) => state.isHidden(t), pickLayers);
    if (!hit) return null;
    const layer = model.layerOfTexel(hit.texel);
    return layer && 'role' in layer.info && layer.info.role === 'DIELECTRIC'
      ? null
      : model.idOfTexel(hit.texel);
  }

  #setHover(id: string | null): void {
    if (id === this.#hover || !this.#loaded) return;
    this.#hover = id;
    const model = this.#loaded.model;
    this.#loaded.state.setHover(id ? model.emphasis(this.#resolve(model, id)) : []);
    this.#emit('bui-hover', id);
  }

  #emit(type: 'bui-hover' | 'bui-select', id: string | null): void {
    this.#dispatch(type, id ? this.info(id) : null);
  }

  #dispatch<
    K extends
      | 'bui-hover'
      | 'bui-select'
      | 'bui-progress'
      | 'bui-load'
      | 'bui-unload'
      | 'bui-model-progress'
      | 'bui-model-done',
  >(type: K, detail: BoardViewerEventMap[K]['detail']): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** Whether any part of a widget's element is drawn: on a visible layer and not hidden. */
  #widgetVisible(id: string): boolean {
    const cached = this.#widgetVisibility.get(id);
    if (cached?.version === this.#visibility) return cached.visible;
    const loaded = this.#loaded;
    const element = loaded?.model.resolve(id);
    let visible = false;
    if (loaded && element) {
      const { model, state } = loaded;
      if (element.kind === 'board' || (element.kind === 'layer' && !element.texels.length)) {
        visible = element.kind === 'board' || !!model.layer(id)?.group.visible;
      } else {
        visible = element.texels.some((texel) => {
          const layer = model.layerOfTexel(texel);
          const shown = layer ? layer.group.visible : model.componentGroup.visible;
          return shown && !state.isHidden(texel);
        });
      }
    }
    this.#widgetVisibility.set(id, { version: this.#visibility, visible });
    return visible;
  }

  #widgetBox(id: string): Box3 | null {
    let box = this.#widgetBoxes.get(id);
    if (box === undefined && this.#loaded) {
      box = this.#loaded.model.resolve(id)?.box ?? null;
      this.#widgetBoxes.set(id, box);
    }
    return box ?? null;
  }

  #occluded(id: string, from: Vector3, to: Vector3): boolean {
    const loaded = this.#loaded;
    const element = loaded?.model.resolve(id);
    if (!loaded || !element) return false;
    const direction = new Vector3().subVectors(to, from);
    const distance = direction.length();
    this.#ray.set(from, direction.normalize());
    const hit = loaded.picker.pick(this.#ray, (t) => loaded.state.isHidden(t), loaded.pickLayers);
    return (
      !!hit && hit.distance < distance * (1 - 1e-3) && !loaded.model.contains(element, hit.texel)
    );
  }

  /** Per-frame work before rendering; returns whether another frame is needed. */
  #beforeRender(now: number): boolean {
    const renderer = this.#renderer;
    if (!renderer || !this.#loaded) return false;
    // Keep rendering a little after the view changes, so widgets get a final occlusion check.
    if (!this.#lastView.equals(renderer.camera.matrixWorld)) {
      this.#lastView.copy(renderer.camera.matrixWorld);
      this.#settleUntil = now + 2 * OCCLUSION_INTERVAL;
      this.#hoverStale = true;
    }
    if (this.#pointer && this.#hoverStale) {
      this.#setHover(this.#pick(this.#pointer.x, this.#pointer.y));
    }
    this.#hoverStale = false;
    const { materials, overlays, state } = this.#loaded;
    materials.sync();
    for (const overlay of overlays) {
      overlay.mesh.visible = state.tintedIn(overlay.start, overlay.end);
    }
    if (this.#widgets.size) {
      this.#widgets.update(renderer.camera, this.clientWidth, this.clientHeight, now);
    }
    return this.#widgets.size > 0 && now < this.#settleUntil;
  }
}
