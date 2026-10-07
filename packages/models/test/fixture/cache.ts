/** An in-memory stand-in for `CacheStorage`. */
export function memoryCaches(): Pick<CacheStorage, 'open'> & {
  entries: Map<string, Map<string, Response>>;
} {
  const entries = new Map<string, Map<string, Response>>();
  return {
    entries,
    async open(name: string) {
      let cache = entries.get(name);
      if (!cache) {
        cache = new Map();
        entries.set(name, cache);
      }
      const store = cache;
      return {
        async match(request: RequestInfo | URL) {
          return store.get(String(request))?.clone();
        },
        async put(request: RequestInfo | URL, response: Response) {
          store.set(String(request), response.clone());
        },
      } as unknown as Cache;
    },
  };
}
