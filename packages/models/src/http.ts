/**
 * Requests of the sources: a concurrency limit that stops on HTTP 429, and a persistent cache
 * of immutable responses (files at a git tag) in Cache Storage, missing files included.
 */

/** The part of `CacheStorage` that the sources use (a fake in tests). */
export type CacheStorageLike = Pick<CacheStorage, 'open'>;

/** A server refused requests (HTTP 429); the source stops asking it until `until`. */
export class RateLimitError extends Error {
  constructor(
    readonly host: string,
    /** `Date.now()` time after which requests are made again. */
    readonly until: number,
  ) {
    super(`${host} rate limit reached (HTTP 429): requests stopped`);
    this.name = 'RateLimitError';
  }
}

/** Counters of a source's requests. */
export interface RequestStats {
  /** Requests sent. */
  requests: number;
  /** Bytes received. */
  bytes: number;
  /** Responses taken from the persistent cache. */
  cached: number;
}

/** Default pause after HTTP 429 without `Retry-After`. */
const RATE_LIMIT_PAUSE = 60_000;

/**
 * Fetches with at most `concurrency` requests at a time; after HTTP 429 every request fails
 * with {@link RateLimitError} until the pause (`Retry-After`, else a minute) is over.
 */
export class Limiter {
  readonly stats: RequestStats = { requests: 0, bytes: 0, cached: 0 };
  readonly #concurrency: number;
  readonly #fetch: typeof fetch;
  readonly #queue: (() => void)[] = [];
  #active = 0;
  #blocked: RateLimitError | null = null;

  constructor(concurrency: number, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.#concurrency = Math.max(1, concurrency);
    this.#fetch = fetcher;
  }

  /**
   * Fetches a URL's body; `null` for HTTP 404 or 410.
   *
   * @throws RateLimitError after HTTP 429; an `Error` for other failures.
   */
  async fetch(url: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
    this.#check();
    await this.#slot(signal);
    try {
      this.#check();
      this.stats.requests++;
      const response = await this.#fetch(url, { signal });
      if (response.status === 429) {
        const retry = Number(response.headers.get('retry-after'));
        const pause = Number.isFinite(retry) && retry > 0 ? retry * 1000 : RATE_LIMIT_PAUSE;
        this.#blocked = new RateLimitError(new URL(url).host, Date.now() + pause);
        throw this.#blocked;
      }
      if (response.status === 404 || response.status === 410) return null;
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      this.stats.bytes += data.byteLength;
      return data;
    } finally {
      this.#active--;
      this.#queue.shift()?.();
    }
  }

  #check(): void {
    if (this.#blocked && Date.now() < this.#blocked.until) throw this.#blocked;
    this.#blocked = null;
  }

  #slot(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.#active < this.#concurrency) {
      this.#active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const start = () => {
        signal.removeEventListener('abort', abort);
        this.#active++;
        resolve();
      };
      const abort = () => {
        const at = this.#queue.indexOf(start);
        if (at >= 0) this.#queue.splice(at, 1);
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      this.#queue.push(start);
    });
  }
}

/**
 * A persistent cache of immutable files by URL, in Cache Storage (`name`); without Cache
 * Storage (or with `storage` `null`) it does nothing. Errors are swallowed.
 */
export class FileCache {
  readonly #cache: Promise<Cache | null>;

  constructor(name: string, storage: CacheStorageLike | null | undefined = globalThis.caches) {
    this.#cache = storage ? storage.open(name).catch(() => null) : Promise.resolve(null);
  }

  /** The cached file: its bytes, `null` if it is known to be missing, `undefined` if unknown. */
  async get(url: string): Promise<ArrayBuffer | null | undefined> {
    try {
      const response = await (await this.#cache)?.match(url);
      if (!response) return undefined;
      return response.headers.get('x-boardui-missing') ? null : await response.arrayBuffer();
    } catch {
      return undefined;
    }
  }

  /** Stores a file, or that it is missing (`null`). */
  async put(url: string, data: ArrayBuffer | null): Promise<void> {
    try {
      const response =
        data === null
          ? new Response('', { headers: { 'x-boardui-missing': '1' } })
          : new Response(data);
      await (await this.#cache)?.put(url, response);
    } catch {
      // Full or not allowed: fetched again next time.
    }
  }
}
