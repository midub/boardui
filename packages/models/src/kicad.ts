/**
 * `kicadSource`: models from KiCad's libraries on gitlab.com, found through the footprint that
 * KiCad's IPC-2581 export names.
 */
import type {
  ModelAttribution,
  ModelBoard,
  ModelComponent,
  ModelRef,
  ModelSource,
} from '@boardui/viewer';
import { type CacheStorageLike, FileCache, Limiter, type RequestStats } from './http.js';
import { KICAD_LIBRARIES } from './kicad-libraries.js';
import {
  type KicadModel,
  kicadFootprint,
  kicadModelMatrix,
  libraryModelPath,
  parseKicadModels,
} from './kicad-mod.js';

/** The newest tag of the libraries per KiCad major version (checked 2026-10-07). */
export const KICAD_TAGS: Readonly<Record<number, string>> = {
  8: '8.0.9',
  9: '9.0.9.1',
  10: '10.0.7',
};
/** The tag used when the board doesn't say which KiCad made it. */
export const KICAD_DEFAULT_TAG = '10.0.7';

/** Credit for KiCad's models. */
export const KICAD_ATTRIBUTION: ModelAttribution = {
  text: 'KiCad libraries',
  url: 'https://gitlab.com/kicad/libraries',
  license: 'CC-BY-SA 4.0 with an exception for designs and generated files',
};

export interface KicadSourceOptions {
  /**
   * Tag of the libraries, e.g. `9.0.9.1`. Default: the newest tag of the KiCad major version that
   * exported the board (`BOARDUI_board.source.software`, profile 0.8), else {@link KICAD_DEFAULT_TAG}.
   */
  ref?: string;
  /**
   * GitLab API base URL; another host with the same API (a caching proxy, a mirror) can stand in.
   * Default `https://gitlab.com/api/v4`.
   */
  baseUrl?: string;
  /** Default `kicad/libraries/kicad-footprints`. */
  footprints?: string;
  /** Default `kicad/libraries/kicad-packages3D`. */
  models?: string;
  /** Footprint libraries taken as KiCad's own. Default {@link KICAD_LIBRARIES}. */
  libraries?: Iterable<string>;
  /** Requests at a time; default 4. */
  concurrency?: number;
  /** Cache Storage for footprints, `null` for none; default `globalThis.caches`. */
  cache?: CacheStorageLike | null;
  fetch?: typeof fetch;
}

/** A {@link ModelSource} with its request counters. */
export interface KicadSource extends ModelSource {
  /** Requests to GitLab (footprints and models) and footprint cache hits. */
  readonly stats: RequestStats;
}

/** Cache Storage cache of footprint files. */
export const KICAD_CACHE_NAME = 'boardui-kicad-v1';

/**
 * Models from KiCad's libraries: for a component whose package and part name a footprint of a
 * standard KiCad library (as KiCad's IPC-2581 export does), it reads the footprint's `.kicad_mod`
 * and loads its first visible 3D model as STEP, both through GitLab's API (which allows
 * cross-origin requests), placed as KiCad places it. Other components resolve to `null` without
 * any request. Register the STEP loader (`registerModelLoader('step', stepLoader())`).
 *
 * Requests: at most `concurrency` at a time, each file once, footprints cached in Cache Storage
 * (files at a tag never change); after HTTP 429 the source stops asking until GitLab's pause is
 * over.
 */
export function kicadSource(options: KicadSourceOptions = {}): KicadSource {
  const base = (options.baseUrl ?? 'https://gitlab.com/api/v4').replace(/\/$/, '');
  const footprints = options.footprints ?? 'kicad/libraries/kicad-footprints';
  const models = options.models ?? 'kicad/libraries/kicad-packages3D';
  const libraries = [...(options.libraries ?? KICAD_LIBRARIES)];
  const limiter = new Limiter(options.concurrency ?? 4, options.fetch);
  const cache = new FileCache(KICAD_CACHE_NAME, options.cache);
  const parsed = new Map<string, Promise<KicadModel[] | null>>();

  const fileUrl = (project: string, path: string, tag: string) =>
    `${base}/projects/${encodeURIComponent(project)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(tag)}`;

  /** The models of a footprint, or `null` if it doesn't exist; each file is read once. */
  const footprintModels = (url: string, signal: AbortSignal): Promise<KicadModel[] | null> => {
    let models = parsed.get(url);
    if (!models) {
      models = (async () => {
        let data = await cache.get(url);
        if (data === undefined) {
          data = await limiter.fetch(url, signal);
          void cache.put(url, data);
        } else {
          limiter.stats.cached++;
        }
        return data === null ? null : parseKicadModels(new TextDecoder().decode(data));
      })();
      parsed.set(url, models);
      // A failed or aborted read is tried again next time.
      models.catch(() => parsed.delete(url));
    }
    return models;
  };

  return {
    name: 'KiCad',
    attribution: KICAD_ATTRIBUTION,
    stats: limiter.stats,
    async resolve(component: ModelComponent, board: ModelBoard, signal: AbortSignal) {
      const found = kicadFootprint(component, libraries);
      if (!found) return null;
      const tag = options.ref ?? kicadTag(board.source.software);
      const url = fileUrl(footprints, `${found.library}.pretty/${found.footprint}.kicad_mod`, tag);
      const model = (await footprintModels(url, signal))?.find((m) => !m.hide);
      const path = model && libraryModelPath(model.path);
      if (!model || !path) return null;
      const ref: ModelRef = {
        key: `kicad/${tag}/${path}`,
        format: 'step',
        load: (loadSignal) => limiter.fetch(fileUrl(models, path, tag), loadSignal),
        transform: { matrix: kicadModelMatrix(model) },
        immutable: true,
        attribution: KICAD_ATTRIBUTION,
      };
      return ref;
    },
  };
}

/**
 * The library tag for the software that exported a board: the newest of its KiCad major version
 * ({@link KICAD_TAGS}; a development version `x.99` counts as `x + 1`), else
 * {@link KICAD_DEFAULT_TAG}.
 */
export function kicadTag(software: ModelBoard['source']['software']): string {
  if (!software || !/kicad/i.test(software.name)) return KICAD_DEFAULT_TAG;
  const match = /^(\d+)\.(\d+)/.exec(software.revision ?? '');
  if (!match) return KICAD_DEFAULT_TAG;
  const major = Number(match[1]) + (Number(match[2]) >= 99 ? 1 : 0);
  return KICAD_TAGS[major] ?? KICAD_DEFAULT_TAG;
}
