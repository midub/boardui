import { type Box3, Color, type Material, Matrix4, Mesh, Ray, Vector3 } from 'three';
import type { LayerRole, Side } from './board-extension.js';
import { BoardModel, type ElementInfo, type LayerModel, type ListableKind } from './board-model.js';
import { type ViewPreset, viewDirection } from './camera.js';
import { type BoardSource, loadGltf } from './load.js';
import { BoardMaterials } from './materials.js';
import { Picker } from './picking.js';
import { BoardRenderer, type RenderStats } from './renderer.js';
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
  visible: boolean;
}

/** Events of `<board-viewer>`. */
export interface BoardViewerEventMap extends HTMLElementEventMap {
  /** The element under the pointer changed; `null` when the pointer left the board. */
  'bui-hover': CustomEvent<ElementInfo | null>;
  /** The user clicked an element, or empty space (`null`). */
  'bui-select': CustomEvent<ElementInfo | null>;
}

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
}

/**
 * `<board-viewer>`: shows a boardui glTF board (spec/README.md) with orbit controls, layer
 * toggles, hover and selection, highlights, x-ray and HTML widgets.
 *
 * Attributes: `src` (URL of a GLB to load; failures dispatch an `error` event),
 * `backend="webgl"` (use the WebGL2 backend even where WebGPU is available; read when the
 * element connects).
 *
 * The soldermask is translucent (spec §6.5): the pointer picks, and widgets see, through it.
 * Dielectric sheets can't be hovered or selected, but they hide what lies behind the board.
 *
 * Element IDs follow spec §5. Methods that take one ID throw a `RangeError` for an unknown ID;
 * methods that take several skip unknown ones. All need a loaded board.
 */
export class BoardViewerElement extends HTMLElement {
  static readonly observedAttributes = ['src'];

  readonly #canvas = document.createElement('canvas');
  readonly #widgets = new WidgetLayer({
    box: (id) => this.#widgetBox(id),
    occluded: (id, from, to) => this.#occluded(id, from, to),
  });
  /** Bounding boxes of the widget targets of the loaded board, resolved once each. */
  readonly #widgetBoxes = new Map<string, Box3 | null>();
  readonly #resize = new ResizeObserver(() => this.#onResize());
  readonly #ray = new Ray();
  #renderer: BoardRenderer | null = null;
  #rendererPending: Promise<void> | null = null;
  #loaded: Loaded | null = null;
  #loadToken = 0;
  #hover: string | null = null;
  #selection: string | null = null;
  #xray = false;
  /** Pointer position while it is over the canvas with no button pressed. */
  #pointer: { x: number; y: number } | null = null;
  /** Whether the element under the pointer must be picked again. */
  #hoverStale = false;
  #press: { x: number; y: number } | null = null;
  #settleUntil = 0;
  readonly #lastView = new Matrix4();

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
   * selection are reset; widgets stay attached.
   *
   * @param source URL of a GLB, or its bytes.
   * @throws if the asset can't be loaded or is not a boardui asset.
   */
  async load(source: BoardSource): Promise<void> {
    const token = ++this.#loadToken;
    const model = await BoardModel.fromGltf(await loadGltf(source));
    if (token !== this.#loadToken) {
      model.dispose();
      return;
    }
    this.#unload();
    const state = new ElementState(model.stateCount);
    const materials = new BoardMaterials(state);
    const overlays: Loaded['overlays'] = [];
    for (const layer of model.layers) {
      const copper = !('role' in layer.info) || layer.info.role === 'COPPER';
      for (const mesh of layer.meshes) {
        const source = mesh.material as Material;
        mesh.material = materials.layer(source, layer.stateOffset);
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
    for (const { mesh, rows } of model.componentBatches) {
      mesh.material = materials.components(mesh.material as Material, rows, model.componentOffset);
    }
    materials.setXray(this.#xray);
    const pickLayers = model.layers.filter(
      (layer) => !('role' in layer.info) || layer.info.role !== 'SOLDERMASK',
    );
    const picker = new Picker(model);
    this.#loaded = { model, state, materials, picker, pickLayers, overlays };
    this.#showLoaded();
    this.#prepareBvhs(this.#loaded);
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
    this.#requestRender();
  }

  /** Whether x-ray mode is on. */
  get xray(): boolean {
    return this.#xray;
  }

  /** Turns x-ray mode on or off: every layer and component becomes translucent. */
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
    this.#requestRender();
    return () => {
      show();
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
    const texels = id === null ? [] : this.#resolve(model, id).texels;
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

  /** Points the camera from above, from below or obliquely, framing the whole board. */
  setView(view: ViewPreset): void {
    this.#renderer?.frame(this.#model().bounds, viewDirection(view));
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

  #unload(): void {
    if (!this.#loaded) return;
    this.#widgetBoxes.clear();
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
    renderer.setBounds(loaded.model.bounds);
    renderer.frame(loaded.model.bounds, viewDirection('iso'), false);
  }

  /** Builds the BVHs of the pickable layers in idle time, so the first hover doesn't stall. */
  #prepareBvhs(loaded: Loaded): void {
    const meshes = loaded.pickLayers.flatMap((layer) => layer.meshes);
    const idle = globalThis.requestIdleCallback ?? ((callback) => setTimeout(callback, 50));
    const next = () => {
      const mesh = meshes.shift();
      if (mesh && this.#loaded === loaded) {
        loaded.picker.bvh(mesh);
        idle(next);
      }
    };
    idle(next);
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
    this.#loaded.state.setHover(id ? this.#resolve(this.#loaded.model, id).texels : []);
    this.#emit('bui-hover', id);
  }

  #emit(type: 'bui-hover' | 'bui-select', id: string | null): void {
    const detail = id ? this.info(id) : null;
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
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
