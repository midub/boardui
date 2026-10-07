/**
 * Loads runtime models for a loaded board (spec/README.md, "Runtime models"): asks the sources
 * for every component with a placeholder body, loads what they find (deduplicated per key,
 * cached), and swaps the models in, a batch of scene updates at a time.
 */
import type { Matrix4 } from 'three';
import type { BoardModel } from './board-model.js';
import type { ModelCache } from './model-cache.js';
import {
  type ModelAttribution,
  type ModelBoard,
  type ModelComponent,
  type ModelGeometry,
  type ModelRef,
  type ModelSource,
  modelLoader,
  transformMatrix,
} from './model-sources.js';

/** How one source did, in {@link ModelStatus.sources}. */
export interface ModelSourceStatus {
  readonly name: string;
  readonly attribution?: ModelAttribution;
  /** Components showing a model of this source. */
  loaded: number;
  /** Components for which the source named a model that doesn't exist (HTTP 404). */
  missing: number;
  /** Components for which the source, or loading its model, failed. */
  failed: number;
}

/** A failure, in {@link ModelStatus.failures}. */
export interface ModelFailure {
  readonly source: string;
  /** Component ID. */
  readonly component: string;
  /** {@link ModelRef.key}, if the source resolved one. */
  readonly key?: string;
  readonly message: string;
}

/** Progress of the runtime models of the loaded board (`bui-model-progress`, `bui-model-done`). */
export interface ModelStatus {
  /** Components whose placeholder body a runtime model may replace. */
  total: number;
  /** Components every source has been asked for, or that have a model. */
  done: number;
  /** Components showing a runtime model. */
  loaded: number;
  /** Per source, in order. */
  sources: ModelSourceStatus[];
  /** The first failures (at most {@link MAX_FAILURES}); {@link failureCount} counts all. */
  failures: ModelFailure[];
  failureCount: number;
  /** Distinct models loaded (by key). */
  models: number;
  /** Models taken from the persistent cache. */
  cached: number;
  /** Requests for model files that the viewer made (sources make their own). */
  requests: number;
  /** Bytes of model files downloaded by the viewer and the sources' `load`. */
  bytes: number;
  /** Triangles of the runtime models, as drawn (all instances). */
  triangles: number;
  /** Milliseconds since loading started. */
  ms: number;
  /** Whether every component has been tried. */
  complete: boolean;
}

/** Failures listed in {@link ModelStatus.failures}. */
export const MAX_FAILURES = 50;
/** Components resolved and loaded at the same time. */
const CONCURRENCY = 8;
/** Scene updates are batched: at most one per this many milliseconds. */
const FLUSH_INTERVAL = 150;

/** Models loaded before, by key: kept while the element lives, pruned to the board's models. */
export type ModelMemory = Map<string, Promise<ModelGeometry | null>>;

interface Pending {
  geometry: ModelGeometry;
  rows: number[];
  matrices: Matrix4[];
}

export interface RuntimeModelsOptions {
  model: BoardModel;
  sources: readonly ModelSource[];
  cache: ModelCache;
  memory: ModelMemory;
  /** Puts models into the scene: called with the new batches of a key. */
  apply: (key: string, geometry: ModelGeometry, rows: Uint32Array, matrices: Matrix4[]) => void;
  /** After a batch of scene updates, and when done. */
  report: (status: ModelStatus) => void;
}

/** One run over the components of a board; {@link abort} stops it. */
export class RuntimeModels {
  readonly status: ModelStatus;
  readonly #options: RuntimeModelsOptions;
  readonly #controller = new AbortController();
  readonly #board: ModelBoard;
  readonly #start = performance.now();
  /** Models of this run by key, with all their instances so far. */
  readonly #byKey = new Map<string, Pending>();
  readonly #dirty = new Set<string>();
  /** Loads in flight in this run. */
  readonly #loads = new Map<string, Promise<ModelGeometry | null>>();
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #lastFlush = 0;

  constructor(options: RuntimeModelsOptions) {
    this.#options = options;
    const { model, sources } = options;
    const source = model.board.source as ModelBoard['source'];
    this.#board = { profileVersion: model.board.profileVersion, source };
    let total = 0;
    for (let row = 0; row < model.components.count; row++) {
      if (model.bodies.replaceable(row)) total++;
    }
    this.status = {
      total,
      done: 0,
      loaded: 0,
      sources: sources.map((s) => ({
        name: s.name,
        ...(s.attribution ? { attribution: s.attribution } : {}),
        loaded: 0,
        missing: 0,
        failed: 0,
      })),
      failures: [],
      failureCount: 0,
      models: 0,
      cached: 0,
      requests: 0,
      bytes: 0,
      triangles: 0,
      ms: 0,
      complete: false,
    };
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /** Runs to completion; resolves early (without a final report) when aborted. */
  async run(): Promise<void> {
    const { model, sources } = this.#options;
    const rows: number[] = [];
    if (sources.length) {
      for (let row = 0; row < model.components.count; row++) {
        if (model.bodies.replaceable(row)) rows.push(row);
      }
    }
    let next = 0;
    const worker = async () => {
      while (next < rows.length && !this.signal.aborted) {
        const row = rows[next++] as number;
        await this.#component(row);
        this.status.done++;
        this.#scheduleFlush();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
    if (this.signal.aborted) return;
    this.#flush(true);
  }

  abort(): void {
    this.#controller.abort();
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
  }

  /** The component of a row as sources see it. */
  component(row: number): ModelComponent {
    const { model } = this.#options;
    const { components } = model;
    const get = (name: string) => String(components.get(name, row) ?? '');
    return {
      id: get('id'),
      refDes: get('refDes'),
      part: get('part'),
      package: get('package'),
      side: get('side'),
      mount: get('mount'),
      attributes: model.componentAttributes(row),
    };
  }

  async #component(row: number): Promise<void> {
    const { sources, model } = this.#options;
    const component = this.component(row);
    for (const [i, source] of sources.entries()) {
      const stats = this.status.sources[i] as ModelSourceStatus;
      let ref: ModelRef | null = null;
      try {
        ref = await source.resolve(component, this.#board, this.signal);
        if (this.signal.aborted) return;
        if (!ref) continue;
        const geometry = await this.#load(ref);
        if (this.signal.aborted) return;
        if (!geometry) {
          stats.missing++;
          continue;
        }
        const node = model.bodies.nodeMatrix(row);
        if (!node) return;
        const matrix = node.clone().multiply(transformMatrix(ref.transform));
        let pending = this.#byKey.get(ref.key);
        if (!pending) {
          pending = { geometry, rows: [], matrices: [] };
          this.#byKey.set(ref.key, pending);
          this.status.models++;
        }
        pending.rows.push(row);
        pending.matrices.push(matrix);
        this.#dirty.add(ref.key);
        stats.loaded++;
        this.status.loaded++;
        this.status.triangles += triangles(geometry);
        return;
      } catch (error) {
        if (this.signal.aborted) return;
        stats.failed++;
        this.status.failureCount++;
        if (this.status.failures.length < MAX_FAILURES) {
          this.status.failures.push({
            source: source.name,
            component: component.id,
            ...(ref ? { key: ref.key } : {}),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  /** Loads a model once per key: from memory, the cache, or its source. `null` if missing. */
  #load(ref: ModelRef): Promise<ModelGeometry | null> {
    let load = this.#loads.get(ref.key);
    if (load) return load;
    const { memory } = this.#options;
    const known = memory.get(ref.key);
    if (known) {
      this.status.cached++;
      load = known;
    } else {
      load = this.#fetchAndParse(ref);
      const loaded = load;
      load.then(
        () => memory.set(ref.key, loaded),
        () => {},
      );
    }
    this.#loads.set(ref.key, load);
    return load;
  }

  async #fetchAndParse(ref: ModelRef): Promise<ModelGeometry | null> {
    const loader = modelLoader(ref.format);
    if (!loader) throw new Error(`No loader for ${ref.format} models`);
    // Only immutable models go into the persistent cache: it never revalidates, so a model whose
    // URL keeps its content changeable is left to the HTTP cache.
    const cache = ref.immutable ? this.#options.cache : null;
    const signal = this.signal;
    const cached = await cache?.get(ref.key, loader.cacheVersion);
    if (cached?.kind === 'missing') return null;
    if (cached?.kind === 'parsed') {
      this.status.cached++;
      return { parts: cached.parts };
    }
    let data = cached?.kind === 'file' ? cached.data : null;
    if (data) {
      this.status.cached++;
    } else {
      if (ref.url) {
        this.status.requests++;
        const response = await fetch(ref.url, { signal });
        if (response.status === 404 || response.status === 410) {
          void cache?.putMissing(ref.key);
          return null;
        }
        if (!response.ok) throw new Error(`${ref.url}: HTTP ${response.status}`);
        data = await response.arrayBuffer();
      } else if (ref.load) {
        data = await ref.load(signal);
        if (!data) {
          void cache?.putMissing(ref.key);
          return null;
        }
      } else {
        throw new Error(`Model ${ref.key} has neither url nor load`);
      }
      this.status.bytes += data.byteLength;
    }
    const geometry = await loader.load(data, { ref, signal });
    // A model without triangles would hide the placeholder and show nothing: a failure, so the
    // next source gets its turn.
    if (!triangles(geometry)) throw new Error(`Model ${ref.key} has no triangles`);
    if (loader.cacheVersion === undefined) {
      if (cached?.kind !== 'file') void cache?.putFile(ref.key, data);
    } else {
      void cache?.putParsed(ref.key, loader.cacheVersion, geometry.parts);
    }
    return geometry;
  }

  #scheduleFlush(): void {
    if (this.#flushTimer !== null || !this.#dirty.size) return;
    const wait = Math.max(0, this.#lastFlush + FLUSH_INTERVAL - performance.now());
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      if (!this.signal.aborted) this.#flush(false);
    }, wait);
  }

  /** Puts the models found since the last flush into the scene, and reports. */
  #flush(complete: boolean): void {
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
    this.#lastFlush = performance.now();
    for (const key of this.#dirty) {
      const pending = this.#byKey.get(key) as Pending;
      this.#options.apply(key, pending.geometry, Uint32Array.from(pending.rows), pending.matrices);
    }
    this.#dirty.clear();
    this.status.ms = performance.now() - this.#start;
    this.status.complete = complete;
    if (complete) this.#prune();
    this.#options.report(this.status);
  }

  /** Forgets the models that this board doesn't use, releasing their geometry. */
  #prune(): void {
    const { memory } = this.#options;
    for (const [key, load] of memory) {
      if (this.#byKey.has(key) || this.#loads.has(key)) continue;
      memory.delete(key);
      void load.then(
        (geometry) => {
          for (const part of geometry?.parts ?? []) part.geometry.dispose();
        },
        () => {},
      );
    }
  }
}

/** Triangles of a model (one instance). */
export function triangles(geometry: ModelGeometry): number {
  let count = 0;
  for (const { geometry: g } of geometry.parts) {
    const drawn = g.index?.count ?? g.getAttribute('position')?.count ?? 0;
    count += Math.min(drawn, g.drawRange.count) / 3;
  }
  return Math.round(count);
}
