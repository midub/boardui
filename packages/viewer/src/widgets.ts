/**
 * HTML widgets that follow board elements. Each frame every widget's anchor is projected to the
 * screen; occlusion is checked with ray casts, at most once per {@link OCCLUSION_INTERVAL} per
 * widget.
 */
import { type Box3, type Camera, Vector3 } from 'three';

/**
 * Where a widget attaches to its element's bounding box:
 * - `'top'`: centre of the face that points away from the board (+Y above the mid-plane, −Y
 *   below it); the widget sits above the point;
 * - `'center'`: centre of the box; the widget is centred on it;
 * - `[x, y, z]`: offset in metres from the centre of the box; the widget is centred on it.
 */
export type WidgetAnchor = 'top' | 'center' | readonly [number, number, number];

/** What a widget does when its anchor is hidden behind the board: nothing, fade, or hide. */
export type WidgetOcclusion = 'hide' | 'fade' | 'none';

/** Options of `attachWidget`. */
export interface WidgetOptions {
  /** Default `'top'`. */
  anchor?: WidgetAnchor;
  /** Screen-space offset in CSS pixels, `[x, y]` with +y down. Default `[0, 0]`. */
  offset?: readonly [number, number];
  /** Default `'fade'`. */
  occlusion?: WidgetOcclusion;
}

/** Minimum time between two occlusion checks of one widget, in milliseconds. */
export const OCCLUSION_INTERVAL = 150;
/** Opacity of a faded, occluded widget. */
export const FADED_OPACITY = 0.3;

/** The point a widget attaches to. */
export function anchorPoint(box: Box3, anchor: WidgetAnchor, target = new Vector3()): Vector3 {
  box.getCenter(target);
  if (anchor === 'top') {
    target.y = target.y < 0 ? box.min.y : box.max.y;
  } else if (anchor !== 'center') {
    target.x += anchor[0];
    target.y += anchor[1];
    target.z += anchor[2];
  }
  return target;
}

/**
 * Projects a point to CSS pixels of a `width × height` viewport, with the origin at the top
 * left. Returns `null` if the point lies behind the (perspective) camera.
 */
export function projectToScreen(
  point: Vector3,
  camera: Camera,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const view = point.clone().applyMatrix4(camera.matrixWorldInverse);
  if (view.z >= 0) {
    return null;
  }
  const ndc = view.applyMatrix4(camera.projectionMatrix);
  return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
}

/** The style a widget gets for one frame. */
export interface WidgetPlacement {
  transform: string;
  visibility: 'visible' | 'hidden';
  opacity: string;
}

/**
 * Computes a widget's style from its screen position (or `null` behind the camera) and occlusion
 * state.
 */
export function placement(
  screen: { x: number; y: number } | null,
  options: Required<WidgetOptions>,
  occluded: boolean,
): WidgetPlacement {
  if (!screen || (occluded && options.occlusion === 'hide')) {
    return { transform: '', visibility: 'hidden', opacity: '' };
  }
  const x = screen.x + options.offset[0];
  const y = screen.y + options.offset[1];
  const shift = options.anchor === 'top' ? '-100%' : '-50%';
  return {
    transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, ${shift})`,
    visibility: 'visible',
    opacity: occluded && options.occlusion === 'fade' ? String(FADED_OPACITY) : '',
  };
}

/** What the widget layer needs from the viewer. */
export interface WidgetHost {
  /** Bounding box of an element in world coordinates, or `null` if it has no geometry. */
  box(id: string): Box3 | null;
  /** Whether something other than the element itself lies between `from` and `to`. */
  occluded(id: string, from: Vector3, to: Vector3): boolean;
}

interface Widget {
  readonly id: string;
  readonly element: { readonly style: CSSStyleDeclaration };
  readonly options: Required<WidgetOptions>;
  occluded: boolean;
  nextCheck: number;
}

/** Positions widgets every frame. */
export class WidgetLayer {
  readonly #host: WidgetHost;
  readonly #widgets = new Set<Widget>();
  readonly #point = new Vector3();
  readonly #eye = new Vector3();

  constructor(host: WidgetHost) {
    this.#host = host;
  }

  /** Number of attached widgets. */
  get size(): number {
    return this.#widgets.size;
  }

  /**
   * Starts positioning an element. The caller places it in the overlay.
   *
   * @returns A function that stops positioning it and clears the styles set here.
   */
  attach(
    id: string,
    element: { readonly style: CSSStyleDeclaration },
    options: WidgetOptions = {},
  ): () => void {
    const widget: Widget = {
      id,
      element,
      options: {
        anchor: options.anchor ?? 'top',
        offset: options.offset ?? [0, 0],
        occlusion: options.occlusion ?? 'fade',
      },
      occluded: false,
      nextCheck: 0,
    };
    this.#widgets.add(widget);
    return () => {
      if (this.#widgets.delete(widget)) {
        for (const property of ['transform', 'visibility', 'opacity'] as const) {
          element.style[property] = '';
        }
      }
    };
  }

  /**
   * Positions every widget for the current camera.
   *
   * @param now Current time in milliseconds, for throttling occlusion checks.
   */
  update(camera: Camera, width: number, height: number, now: number): void {
    camera.getWorldPosition(this.#eye);
    for (const widget of this.#widgets) {
      const box = this.#host.box(widget.id);
      const point = box && anchorPoint(box, widget.options.anchor, this.#point);
      const screen = point && projectToScreen(point, camera, width, height);
      if (point && screen && widget.options.occlusion !== 'none' && now >= widget.nextCheck) {
        widget.occluded = this.#host.occluded(widget.id, this.#eye, point);
        widget.nextCheck = now + OCCLUSION_INTERVAL;
      }
      const style = placement(screen ?? null, widget.options, widget.occluded);
      Object.assign(widget.element.style, style);
    }
  }
}
