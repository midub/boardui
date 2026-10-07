/**
 * The demo exists once per UI framework, each built on that framework's wrapper of
 * `<board-viewer>`. GitHub Pages serves each at `/boardui/<id>/` (`src/build/site.ts`); `/boardui/`
 * redirects to the first. Each demo links to the others, keeping the query (`?sample=…`) and hash.
 */

/** A demo app: `packages/demo-<id>`, served at `<site>/<id>/`. */
export interface Demo {
  id: string;
  name: string;
}

/** The demos; the first is the default. A demo shows the switch when there is more than one. */
export const DEMOS: readonly Demo[] = [{ id: 'react', name: 'React' }];

/** The URL of another demo, relative to the current one, with the current query and hash. */
export function demoHref(id: string, location: { search: string; hash: string }): string {
  return `../${id}/${location.search}${location.hash}`;
}
