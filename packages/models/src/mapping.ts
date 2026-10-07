/**
 * `mappingSource`: models from your own server, named by a model mapping file
 * (`spec/schema/models.schema.json`) read at runtime.
 */
import type {
  ModelAttribution,
  ModelComponent,
  ModelFormat,
  ModelRef,
  ModelSource,
} from '@boardui/viewer';

/** What a rule matches; every given field must match (`*` and `?` are wildcards). */
export interface MappingMatch {
  part?: string;
  package?: string;
  refDes?: string;
  /** BOM attributes (spec §8.4), e.g. `{ "MPN": "GRM155*" }`. */
  attributes?: Record<string, string>;
}

/** A rule of the mapping file. */
export interface MappingRule {
  match: MappingMatch;
  /**
   * Path or URL of the model, relative to the mapping file. May hold placeholders: `{part}`,
   * `{package}`, `{refDes}`, `{side}`, `{mount}` and any attribute name, e.g. `{MPN}`, filled in
   * URL-encoded; a rule whose placeholder has no value doesn't match.
   */
  file: string;
  /** Default: from the file's extension (`.glb`, `.gltf`, `.step`/`.stp`, `.obj`). */
  format?: ModelFormat;
  offsetMm?: [number, number, number];
  rotationDeg?: [number, number, number];
  scale?: number;
}

/** The model mapping file. */
export interface MappingFile {
  version: 1;
  models: MappingRule[];
}

export interface MappingSourceOptions {
  /** Default `Models`, or the mapping's file name. */
  name?: string;
  attribution?: ModelAttribution;
  /** Base of relative paths when the mapping is given as an object; default the page's URL. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

const EXTENSIONS: Record<string, ModelFormat> = {
  glb: 'glb',
  gltf: 'gltf',
  step: 'step',
  stp: 'step',
  obj: 'obj',
};

/**
 * Models from your own server: a model mapping file (spec §6.9, `spec/schema/models.schema.json`),
 * loaded from a URL (once, on first use) or given as an object. Rules that match more than the
 * package (`part`, `refDes`, `attributes`) are tried first, then those that match the package
 * only, each in file order; the first that matches names the model. A rule's file that doesn't
 * exist (HTTP 404) means this source has no model for the component, and the viewer tries the
 * next source.
 *
 * @example
 * ```json
 * { "version": 1, "models": [
 *   { "match": { "attributes": { "MPN": "GRM155*" } }, "file": "capacitors/0402.glb" },
 *   { "match": { "package": "*" }, "file": "https://models.example.com/{package}.step" }
 * ] }
 * ```
 */
export function mappingSource(
  mapping: string | URL | MappingFile,
  options: MappingSourceOptions = {},
): ModelSource {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const isFile = typeof mapping === 'object' && !(mapping instanceof URL);
  const base = isFile
    ? (options.baseUrl ?? globalThis.location?.href ?? 'http://localhost/')
    : new URL(String(mapping), globalThis.location?.href).href;
  let rules: Promise<MappingRule[]> | null = null;
  const load = (signal: AbortSignal): Promise<MappingRule[]> => {
    rules ??= (async () => {
      const file = isFile
        ? mapping
        : ((await (async () => {
            const response = await fetcher(base, { signal });
            if (!response.ok) throw new Error(`${base}: HTTP ${response.status}`);
            return response.json();
          })()) as MappingFile);
      return orderRules(checkMapping(file));
    })();
    rules.catch(() => {
      rules = null;
    });
    return rules;
  };
  const name =
    options.name ??
    (isFile ? 'Models' : decodeURIComponent(base.split(/[?#]/)[0]?.split('/').pop() || 'Models'));
  return {
    name,
    ...(options.attribution ? { attribution: options.attribution } : {}),
    async resolve(component, _board, signal) {
      for (const rule of await load(signal)) {
        if (!matches(rule.match, component)) continue;
        const file = expand(rule.file, component);
        if (file === null) continue;
        const url = new URL(file, base).href;
        const format =
          rule.format ??
          EXTENSIONS[/\.([a-z0-9]+)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase() ?? ''];
        if (!format) continue;
        const ref: ModelRef = {
          key: url,
          url,
          format,
          transform: {
            offsetMm: rule.offsetMm ?? [0, 0, 0],
            rotationDeg: rule.rotationDeg ?? [0, 0, 0],
            scale: rule.scale ?? 1,
          },
          ...(options.attribution ? { attribution: options.attribution } : {}),
        };
        return ref;
      }
      return null;
    },
  };
}

/** Checks the shape of a mapping file. @throws on a malformed one. */
export function checkMapping(file: unknown): MappingRule[] {
  const mapping = file as Partial<MappingFile> | null;
  if (mapping?.version !== 1 || !Array.isArray(mapping.models)) {
    throw new Error('Not a model mapping file (version 1 with "models")');
  }
  mapping.models.forEach((rule, i) => {
    const match = rule?.match as MappingMatch | undefined;
    if (!match || typeof rule.file !== 'string' || !Object.keys(match).length) {
      throw new Error(`Model mapping rule ${i}: needs "match" and "file"`);
    }
  });
  return mapping.models;
}

/** Rules that match more than the package first, then package-only ones, each in file order. */
export function orderRules(rules: readonly MappingRule[]): MappingRule[] {
  const packageOnly = (rule: MappingRule) =>
    Object.keys(rule.match).every((key) => key === 'package');
  return [...rules.filter((r) => !packageOnly(r)), ...rules.filter(packageOnly)];
}

/** Whether a component matches a rule's `match`. */
export function matches(match: MappingMatch, component: ModelComponent): boolean {
  for (const key of ['part', 'package', 'refDes'] as const) {
    const pattern = match[key];
    if (pattern !== undefined && !glob(pattern, component[key])) return false;
  }
  for (const [name, pattern] of Object.entries(match.attributes ?? {})) {
    const value = attribute(component, name);
    if (value === undefined || !glob(pattern, value)) return false;
  }
  return true;
}

/** Whether `value` matches `pattern`, where `*` stands for any text and `?` for one character. */
export function glob(pattern: string, value: string): boolean {
  if (!/[*?]/.test(pattern)) return pattern === value;
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${source}$`, 's').test(value);
}

/** Fills the placeholders of a file template, or `null` if one has no value. */
export function expand(template: string, component: ModelComponent): string | null {
  let missing = false;
  const fields: Record<string, string> = {
    part: component.part,
    package: component.package,
    refDes: component.refDes,
    side: component.side,
    mount: component.mount,
  };
  const file = template.replace(/\{([^{}]+)\}/g, (_, name: string) => {
    const value = Object.hasOwn(fields, name) ? fields[name] : attribute(component, name);
    if (!value) missing = true;
    return encodeURIComponent(value ?? '');
  });
  return missing ? null : file;
}

function attribute(component: ModelComponent, name: string): string | undefined {
  return Object.hasOwn(component.attributes, name) ? component.attributes[name] : undefined;
}
