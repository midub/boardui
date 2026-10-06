/**
 * The GPU side of the viewer: `WebGPURenderer` (WebGPU, or WebGL2 as fallback), scene, camera,
 * orbit controls and an on-demand render loop. Kept thin; the board logic lives elsewhere.
 */
import {
  type Box3,
  DirectionalLight,
  NeutralToneMapping,
  type Object3D,
  PerspectiveCamera,
  type Ray,
  Raycaster,
  Scene,
  Sphere,
  Vector2,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu';
import { fitBoxDistance } from './camera.js';

/** Rendering statistics of the last frame. */
export interface RenderStats {
  /** `'WebGPU'`, or `'WebGL2'` when `WebGPURenderer` fell back. */
  backend: 'WebGPU' | 'WebGL2';
  drawCalls: number;
  triangles: number;
  /** Frames rendered so far. Frames are rendered on demand, so this counts changes. */
  frames: number;
}

/** How long camera moves animate, in milliseconds. */
const FLIGHT_MS = 400;

interface Flight {
  start: number;
  fromTarget: Vector3;
  fromPosition: Vector3;
  toTarget: Vector3;
  toPosition: Vector3;
}

/** Renders one scene into a canvas, on demand. */
export class BoardRenderer {
  readonly renderer: WebGPURenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(35, 1, 1e-4, 10);
  readonly controls: OrbitControls;
  readonly #canvas: HTMLCanvasElement;
  readonly #beforeRender: (now: number) => boolean;
  readonly #raycaster = new Raycaster();
  readonly #content: Object3D[] = [];
  #frame = 0;
  #frames = 0;
  #flight: Flight | null = null;
  /** Radius of the board's bounding sphere. */
  #radius = 1;

  /**
   * @param beforeRender Called before every frame; return `true` to request another frame.
   */
  private constructor(
    canvas: HTMLCanvasElement,
    renderer: WebGPURenderer,
    beforeRender: (now: number) => boolean,
  ) {
    this.#canvas = canvas;
    this.renderer = renderer;
    this.#beforeRender = beforeRender;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', () => this.requestRender());
    this.scene.environment = new PMREMGenerator(renderer).fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    const light = new DirectionalLight(0xffffff, 1.2);
    light.position.set(0.5, 1, 0.8);
    this.scene.add(light);
  }

  /**
   * Creates the renderer and waits until its backend is ready.
   *
   * @param forceWebGL Use the WebGL2 backend even where WebGPU is available.
   */
  static async create(
    canvas: HTMLCanvasElement,
    beforeRender: (now: number) => boolean,
    forceWebGL = false,
  ): Promise<BoardRenderer> {
    const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true, forceWebGL });
    renderer.toneMapping = NeutralToneMapping;
    // Frames are rendered on demand; keep the statistics of the last one (see `stats`).
    renderer.info.autoReset = false;
    renderer.setPixelRatio(globalThis.devicePixelRatio ?? 1);
    await renderer.init();
    return new BoardRenderer(canvas, renderer, beforeRender);
  }

  /** Replaces what is shown (lights and environment stay). */
  setContent(objects: Object3D[]): void {
    this.scene.remove(...this.#content);
    this.#content.splice(0, this.#content.length, ...objects);
    if (objects.length) this.scene.add(...objects);
    this.requestRender();
  }

  /** Matches the drawing buffer to the canvas's CSS size. */
  resize(width: number, height: number): void {
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** Adapts zoom limits and clipping planes to a board of this size. */
  setBounds(board: Box3): void {
    this.#radius = Math.max(board.getBoundingSphere(new Sphere()).radius, 1e-4);
    this.controls.minDistance = this.#radius / 200;
    this.controls.maxDistance = this.#radius * 20;
  }

  /**
   * Moves the camera so that `box` fills the view, looking along `direction` (from the box
   * towards the camera), or along the current view direction.
   *
   * @param margin Room around the box, as a factor of its projected size.
   */
  frame(box: Box3, direction?: Vector3, animate = true, margin = 1.05): void {
    const center = box.getCenter(new Vector3());
    const dir = (direction ?? this.camera.position.clone().sub(this.controls.target)).normalize();
    const { fov, aspect, up } = this.camera;
    const fit = fitBoxDistance(box, dir, up, fov, aspect, margin);
    const distance = Math.max(fit, this.controls.minDistance);
    const toPosition = center.clone().addScaledVector(dir, distance);
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (animate && !reduced) {
      this.#flight = {
        start: performance.now(),
        fromTarget: this.controls.target.clone(),
        fromPosition: this.camera.position.clone(),
        toTarget: center,
        toPosition,
      };
    } else {
      this.#flight = null;
      this.controls.target.copy(center);
      this.camera.position.copy(toPosition);
    }
    this.controls.update();
    this.requestRender();
  }

  /** The ray through a point given in client (CSS) coordinates. */
  rayAt(clientX: number, clientY: number, target: Ray): Ray {
    const rect = this.#canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(ndc, this.camera);
    return target.copy(this.#raycaster.ray);
  }

  /** Schedules a frame. */
  requestRender(): void {
    if (!this.#frame) {
      this.#frame = requestAnimationFrame((now) => this.#render(now));
    }
  }

  /** Statistics of the last rendered frame. */
  stats(): RenderStats {
    const backend = (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend;
    const { drawCalls, triangles } = this.renderer.info.render;
    return { backend: backend ? 'WebGPU' : 'WebGL2', drawCalls, triangles, frames: this.#frames };
  }

  dispose(): void {
    cancelAnimationFrame(this.#frame);
    this.controls.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }

  #render(now: number): void {
    this.#frame = 0;
    let again = false;
    if (this.#flight) {
      const f = this.#flight;
      const t = Math.min(1, (now - f.start) / FLIGHT_MS);
      const ease = t * t * (3 - 2 * t);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, ease);
      this.camera.position.lerpVectors(f.fromPosition, f.toPosition, ease);
      if (t === 1) this.#flight = null;
      again = true;
    }
    again = this.controls.update() || again;
    // Near and far follow the orbit distance: enough depth precision for 10 µm silkscreen on
    // the soldermask, whether the whole board or a single pad fills the view.
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = distance / 100;
    this.camera.far = distance + 4 * this.#radius;
    this.camera.updateProjectionMatrix();
    again = this.#beforeRender(now) || again;
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    this.#frames++;
    if (again) this.requestRender();
  }
}
