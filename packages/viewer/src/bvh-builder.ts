/**
 * Builds the picking BVHs of large meshes in Web Workers (`bvh.worker.ts`), so that loading a
 * dense board doesn't block the main thread for seconds. Without `Worker` (Node, tests) BVHs are
 * built on the calling thread.
 */
import type { BufferGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { BvhRequest, BvhResponse } from './bvh.worker.js';

/** Meshes with fewer triangles are built on the main thread (in idle time): not worth a copy. */
export const WORKER_MIN_TRIANGLES = 50_000;

interface Job {
  geometry: BufferGeometry;
  resolve: (bvh: MeshBVH) => void;
  reject: (error: unknown) => void;
}

/** A small pool of BVH workers; idle workers are terminated. */
export class BvhBuilder {
  readonly #size: number;
  readonly #queue: Job[] = [];
  readonly #idle: Worker[] = [];
  readonly #busy = new Map<Worker, { id: number; job: Job }>();
  #nextId = 0;
  #disposed = false;

  constructor(
    size = Math.max(1, Math.min(3, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1)),
  ) {
    this.#size = size;
  }

  /** Whether builds can run in workers here. */
  static get available(): boolean {
    return typeof Worker !== 'undefined';
  }

  /** Builds an indirect BVH of an indexed geometry. The geometry is not modified. */
  build(geometry: BufferGeometry): Promise<MeshBVH> {
    if (this.#disposed) return Promise.reject(new Error('BvhBuilder disposed'));
    return new Promise((resolve, reject) => {
      this.#queue.push({ geometry, resolve, reject });
      this.#pump();
    });
  }

  /** Terminates the workers; pending builds reject. */
  dispose(): void {
    this.#disposed = true;
    for (const worker of [...this.#idle, ...this.#busy.keys()]) worker.terminate();
    for (const { job } of this.#busy.values()) job.reject(new Error('BvhBuilder disposed'));
    for (const job of this.#queue) job.reject(new Error('BvhBuilder disposed'));
    this.#idle.length = 0;
    this.#busy.clear();
    this.#queue.length = 0;
  }

  #pump(): void {
    while (this.#queue.length && (this.#idle.length || this.#busy.size < this.#size)) {
      const job = this.#queue.shift() as Job;
      const worker = this.#idle.pop() ?? this.#spawn();
      const id = this.#nextId++;
      this.#busy.set(worker, { id, job });
      const position = job.geometry.getAttribute('position').array as Float32Array;
      const index = job.geometry.index?.array as Uint32Array;
      // Copies (structured clone), so the geometry stays usable while the worker builds.
      const request: BvhRequest = { id, position, index };
      worker.postMessage(request);
    }
    if (!this.#queue.length) {
      for (const worker of this.#idle.splice(0)) worker.terminate();
    }
  }

  #spawn(): Worker {
    const worker = new Worker(new URL('./bvh.worker.js', import.meta.url), {
      type: 'module',
      name: 'boardui-bvh',
    });
    worker.onmessage = ({ data }: MessageEvent<BvhResponse>) => {
      const running = this.#busy.get(worker);
      this.#busy.delete(worker);
      this.#idle.push(worker);
      if (running && running.id === data.id) {
        const { geometry } = running.job;
        const serialized = {
          version: 1,
          roots: data.roots,
          index: null,
          indirectBuffer: data.indirectBuffer,
        };
        running.job.resolve(
          MeshBVH.deserialize(serialized as never, geometry, { setIndex: false }),
        );
      }
      this.#pump();
    };
    worker.onerror = (event) => {
      const running = this.#busy.get(worker);
      this.#busy.delete(worker);
      worker.terminate();
      running?.job.reject(new Error(event.message || 'BVH worker failed'));
      this.#pump();
    };
    return worker;
  }
}
