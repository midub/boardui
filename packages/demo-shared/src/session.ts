/**
 * Opening boards, independent of the UI framework: a sample (downloaded with progress), dropped or
 * picked files (converted in the viewer's worker), or a GLB URL; one load at a time, cancellable,
 * with timings, and the `?sample=` parameter kept in the URL. The UI renders {@link DemoState}
 * (`subscribe` / `getState`, e.g. with React's `useSyncExternalStore`) and calls the methods.
 */
import type { ConvertResult, ModelsInput } from '@boardui/converter';
import type { BoardViewerElement, LoadProgress } from '@boardui/viewer';
import { classify, type InputFile } from './files.js';
import { formatBytes } from './format.js';
import type { DemoModels } from './models.js';
import { SAMPLES, type Sample } from './samples.js';

/** A loaded board. */
export interface Board {
  /** {@link DemoState.generation} of the load that opened it. */
  id: number;
  name: string;
  glb: ArrayBuffer;
  conversion: ConvertResult | null;
  sample?: Sample;
}

/** Timings of the last load, in milliseconds (conversion steps in seconds). */
export interface Timings {
  fetch?: number;
  convert?: number;
  load?: number;
  firstFrame?: number;
  total?: number;
  steps?: ConvertResult['timings'];
}

/** The progress card of a load. */
export interface Progress {
  /** E.g. `Converting minimal-2layer`. */
  title: string;
  /** E.g. `resolving overlaps`. */
  step: string;
  /** `0…1`. */
  fraction: number;
  /** Seconds since the load started. */
  seconds: number;
}

/** `empty` (landing page), `busy` (loading), `ready` (a board is shown) or `error`. */
export type Status = 'empty' | 'busy' | 'ready' | 'error';

export interface DemoState {
  status: Status;
  /** Increases when a load starts; the UI then resets the selection, tags and highlights. */
  generation: number;
  /** The board shown; while another one loads, still the previous one. */
  board: Board | null;
  progress: Progress | null;
  /** Message of the error card. */
  error: string | null;
}

export interface DemoOptions {
  /** URL of the samples in the build, e.g. `${import.meta.env.BASE_URL}samples/`. */
  samplesBase: string;
  /** File sizes of the samples (`@boardui/demo-shared/sizes`). */
  sizes: Readonly<Record<string, number>>;
}

type Report = (title: string, step: string, fraction: number) => void;
type Task = (signal: AbortSignal, progress: Report) => Promise<Omit<Board, 'id'>>;

const STEP_LABELS: Record<string, string> = {
  start: 'starting the converter',
  parse: 'reading the XML',
  'stack-up, features, components': 'stack-up, features and components',
  resolve: 'resolving overlaps',
  'hole cuts': 'cutting holes',
  'cut and sheets': 'soldermask and dielectric sheets',
  extrude: 'extruding layers',
  barrels: 'plated barrels',
  write: 'writing the GLB',
};

/** A converter step as the progress card shows it. */
export const stepLabel = (step: string): string => STEP_LABELS[step] ?? step;

/** Resolves after the next two animation frames (the board's first frame is on screen). */
const nextFrames = () =>
  new Promise<void>((resolve) => {
    const raf = globalThis.requestAnimationFrame ?? ((f: () => void) => setTimeout(f, 16));
    raf(() => raf(() => resolve()));
  });

export class DemoSession {
  /** The page's viewer; set once it is mounted, before anything is opened. */
  viewer: BoardViewerElement | null = null;
  /** Timings of the last load. */
  timings: Timings = {};
  readonly #options: DemoOptions;
  readonly #listeners = new Set<() => void>();
  #state: DemoState = { status: 'empty', generation: 0, board: null, progress: null, error: null };
  #job: AbortController | null = null;

  constructor(options: DemoOptions) {
    this.#options = options;
  }

  get state(): DemoState {
    return this.#state;
  }

  /** The current state (a new object after every change). */
  readonly getState = (): DemoState => this.#state;

  /** Calls `listener` after every state change; returns the unsubscribe function. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Opens what the page's query names: `?sample=<id>`, else `?glb=<url>`. */
  openFromQuery(search: string): void {
    const params = new URLSearchParams(search);
    const sample = SAMPLES.find((s) => s.id === params.get('sample'));
    const glb = params.get('glb');
    if (sample) void this.openSample(sample);
    else if (glb) void this.openGlbUrl(glb);
  }

  /** Downloads a sample (and its models), converts and shows it. */
  async openSample(sample: Sample): Promise<void> {
    const url = (path: string) => this.#options.samplesBase + path;
    await this.#run(sample.name, async (signal, progress) => {
      const start = performance.now();
      const size = this.#options.sizes[sample.xml] ?? 0;
      progress('Downloading', `${sample.xml.split('/').pop()} (${formatBytes(size)})`, 0);
      const xml = await download(url(sample.xml), signal, (f) =>
        progress('Downloading', `${formatBytes(size * f)} of ${formatBytes(size)}`, f * 0.1),
      );
      let models: ModelsInput | undefined;
      if (sample.models) {
        const files = await Promise.all(
          sample.models.files.map(async (path) => ({
            path: path.slice(path.lastIndexOf('/') + 1),
            data: await download(url(path), signal),
          })),
        );
        models = {
          mapping: await (await download(url(sample.models.mapping), signal)).text(),
          files,
        };
      }
      this.timings.fetch = performance.now() - start;
      setSampleParam(sample.id);
      const board = await this.#convert(sample.name, xml, models, signal, (title, step, f) =>
        progress(title, step, 0.1 + 0.9 * f),
      );
      return { ...board, sample };
    });
  }

  /** Opens dropped or picked files: IPC-2581 (with a model mapping and models) or a GLB. */
  async openFiles(files: readonly InputFile[]): Promise<void> {
    if (!files.length) return;
    let opened: Awaited<ReturnType<typeof classify>>;
    try {
      opened = await classify(files);
    } catch (error) {
      this.showError(error);
      return;
    }
    setSampleParam(null);
    if (opened.kind === 'glb') {
      const glb = opened.glb;
      const name = glb.name.replace(/\.glb$/i, '');
      await this.#run(name, async (_signal, progress) => {
        progress('Loading', glb.name, 0.5);
        const buffer = await glb.arrayBuffer();
        const start = performance.now();
        await this.#viewer().load(buffer);
        this.timings.load = performance.now() - start;
        return { name, glb: buffer, conversion: null };
      });
      return;
    }
    const { xml, mapping, models } = opened;
    const name = xml.name.replace(/\.xml$/i, '');
    const input: ModelsInput | undefined = mapping
      ? { mapping: mapping.file, files: models.map((m) => ({ path: m.path, data: m.file })) }
      : undefined;
    await this.#run(name, (signal, progress) => this.#convert(name, xml, input, signal, progress));
  }

  /** Downloads a boardui GLB and shows it. */
  async openGlbUrl(url: string): Promise<void> {
    const name =
      url
        .split('/')
        .pop()
        ?.replace(/\.glb$/i, '') ?? 'board';
    await this.#run(name, async (signal, progress) => {
      progress('Downloading', url, 0);
      const start = performance.now();
      const glb = await (
        await download(url, signal, (f) => progress('Downloading', url, f))
      ).arrayBuffer();
      this.timings.fetch = performance.now() - start;
      const loadStart = performance.now();
      await this.#viewer().load(glb);
      this.timings.load = performance.now() - loadStart;
      return { name, glb, conversion: null };
    });
  }

  /** Cancels the load in progress. */
  cancel(): void {
    this.#job?.abort();
  }

  /** Shows the error card. */
  showError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.#set({ status: 'error', error: message });
  }

  /** Closes the error card. */
  dismissError(): void {
    this.#set({ status: this.#state.board ? 'ready' : 'empty', error: null });
  }

  #set(patch: Partial<DemoState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  #viewer(): BoardViewerElement {
    if (!this.viewer) throw new Error('The viewer is not mounted');
    return this.viewer;
  }

  /** Converts IPC-2581 in the viewer's worker and records the timings. */
  async #convert(
    name: string,
    xml: Blob,
    models: ModelsInput | undefined,
    signal: AbortSignal,
    progress: Report,
  ): Promise<Omit<Board, 'id'>> {
    const start = performance.now();
    let loadStart = start;
    const onProgress = (p: LoadProgress) => {
      if (p.stage === 'load' && p.step === 'load') loadStart = performance.now();
      progress(
        p.stage === 'convert' ? 'Converting' : 'Loading',
        p.stage === 'convert' ? stepLabel(p.step) : 'building the scene',
        p.fraction,
      );
    };
    const conversion = await this.#viewer().loadIpc2581(xml, {
      signal,
      onProgress,
      ...(models ? { models } : {}),
    });
    const end = performance.now();
    this.timings.convert = loadStart - start;
    this.timings.load = end - loadStart;
    this.timings.steps = conversion.timings;
    return { name, glb: conversion.glb, conversion };
  }

  /** Runs one load with the progress card; a new load cancels the previous one. */
  async #run(name: string, task: Task): Promise<void> {
    this.#job?.abort();
    const controller = new AbortController();
    this.#job = controller;
    this.timings = {};
    const generation = this.#state.generation + 1;
    const start = performance.now();
    let progress: Progress = { title: `Opening ${name}`, step: '', fraction: 0, seconds: 0 };
    const report: Report = (title, step, fraction) => {
      if (this.#job !== controller) return;
      progress = { ...progress, title: `${title} ${name}`, step, fraction: Math.min(1, fraction) };
      this.#set({ progress });
    };
    const tick = setInterval(() => {
      progress = { ...progress, seconds: (performance.now() - start) / 1000 };
      if (this.#job === controller) this.#set({ progress });
    }, 100);
    this.#set({ status: 'busy', generation, progress, error: null });
    try {
      const loaded = await task(controller.signal, report);
      if (this.#job !== controller) return;
      await nextFrames();
      const t = this.timings;
      t.total = performance.now() - start;
      t.firstFrame = t.total - (t.fetch ?? 0) - (t.convert ?? 0) - (t.load ?? 0);
      this.#job = null;
      this.#set({ status: 'ready', board: { ...loaded, id: generation }, progress: null });
    } catch (error) {
      if (this.#job !== controller) return;
      this.#job = null;
      if (controller.signal.aborted) {
        this.#set({ status: this.#state.board ? 'ready' : 'empty', progress: null });
      } else {
        this.#set({ progress: null });
        this.showError(error);
      }
    } finally {
      clearInterval(tick);
    }
  }
}

/** Fetches a URL, reporting the downloaded fraction. */
export async function download(
  url: string,
  signal: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Couldn’t download ${url}: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !onProgress || !total) return response.blob();
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    received += value.byteLength;
    // With content encoding the length is the compressed size; the fraction is approximate.
    onProgress(Math.min(1, received / total));
  }
  return new Blob(chunks);
}

/** Puts `?sample=<id>` into the URL (or removes it), and removes `?glb=`. */
function setSampleParam(id: string | null): void {
  if (!globalThis.location || !globalThis.history) return;
  const next = new URLSearchParams(location.search);
  next.delete('glb');
  if (id) next.set('sample', id);
  else next.delete('sample');
  const query = next.toString().replace(/=(?=&|$)/g, '');
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}

/**
 * `globalThis.demo` for tests and the console: the viewer, the samples, the last load's timings,
 * the board, `open(sample)`, and the runtime models' state.
 */
export function exposeDemo(session: DemoSession, models?: DemoModels): void {
  const demo = {
    get viewer() {
      return session.viewer;
    },
    models: () => models?.getState() ?? null,
    samples: SAMPLES,
    get timings() {
      return session.timings;
    },
    board: () => session.state.board,
    open: (sample: Sample) => session.openSample(sample),
  };
  Object.assign(globalThis, { demo });
}
