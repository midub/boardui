/**
 * Runtime 3D models in the demos: after every board load the viewer tries the sources (a mapping
 * from `?models=<url>` first, then KiCad's libraries on gitlab.com) and the panel shows how it
 * went. The apps pass {@link DemoModels.sources} and {@link DemoModels.shown} to the viewer and
 * report its model events to {@link DemoModels.update}.
 */
import { kicadSource, mappingSource, registerLoaders } from '@boardui/models';
import type { ModelAttribution, ModelSource, ModelStatus } from '@boardui/viewer';
import { formatCount } from './format.js';

/** What the models part of the panel shows. */
export interface ModelsState {
  /** Status of the loaded board's models; `null` until the viewer reports. */
  status: ModelStatus | null;
  /** Whether runtime models are shown (the toggle). */
  shown: boolean;
}

/** Links to the licences of the third-party code that reads STEP, in the build (`licenses/`). */
export const STEP_LICENSES = [
  { text: 'occt-import-js', href: 'licenses/occt-import-js.txt' },
  { text: 'Open CASCADE Technology', href: 'licenses/occt.txt' },
] as const;

export class DemoModels {
  /** The viewer's model sources, in order. */
  readonly sources: readonly ModelSource[];
  readonly #listeners = new Set<() => void>();
  #state: ModelsState = { status: null, shown: true };

  /** @param search The page's query: `models=<url>` adds a model mapping before KiCad. */
  constructor(search: string) {
    registerLoaders();
    const mapping = new URLSearchParams(search).get('models');
    this.sources = [...(mapping ? [mappingSource(mapping)] : []), kicadSource()];
  }

  /** The current state (a new object after every change). */
  readonly getState = (): ModelsState => this.#state;

  /** Calls `listener` after every state change; returns the unsubscribe function. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** A model event of the viewer (`bui-model-progress`, `bui-model-done`). */
  update(status: ModelStatus): void {
    this.#set({ status });
  }

  /** A new board is loading: its models start from nothing. */
  reset(): void {
    this.#set({ status: null });
  }

  /** Shows the runtime models or the placeholder bodies. */
  setShown(shown: boolean): void {
    this.#set({ shown });
  }

  #set(patch: Partial<ModelsState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }
}

/**
 * The status line, e.g. `41 of 56 components from KiCad`, `loading… 12 of 56 tried`, `no models
 * found for 17 components`.
 */
export function modelSummary(status: ModelStatus | null): string {
  if (!status) return 'looking for models…';
  if (!status.total) return 'no components with a placeholder body';
  const from = status.sources
    .filter((s) => s.loaded)
    .map((s) => `${s.loaded} from ${s.name}`)
    .join(', ');
  const found = status.loaded
    ? `${formatCount(status.loaded)} of ${formatCount(status.total)} components${from ? ` (${from})` : ''}`
    : `none of ${formatCount(status.total)} components`;
  return status.complete ? found : `loading… ${status.done} of ${status.total} tried, ${found}`;
}

/** Failures and missing models in a line, e.g. `3 not in the library, 1 failed: …`. */
export function modelProblems(status: ModelStatus | null): string {
  if (!status) return '';
  const missing = status.sources.reduce((n, s) => n + s.missing, 0);
  const parts: string[] = [];
  if (missing) parts.push(`${missing} named model${missing === 1 ? '' : 's'} missing`);
  if (status.failureCount) {
    const first = status.failures[0];
    parts.push(
      `${status.failureCount} failed${first ? ` (${first.component}: ${first.message})` : ''}`,
    );
  }
  return parts.join(', ');
}

/** Attributions of the sources that supplied models (all sources before any did). */
export function modelAttributions(
  sources: readonly ModelSource[],
  status: ModelStatus | null,
): ModelAttribution[] {
  const used = status?.sources.filter((s) => s.loaded).map((s) => s.name);
  return sources
    .filter((s) => s.attribution && (!used?.length || used.includes(s.name)))
    .map((s) => s.attribution as ModelAttribution);
}
