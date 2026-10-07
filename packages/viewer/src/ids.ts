/**
 * Element identifiers (spec §5).
 *
 * IDs are opaque, stable strings such as `cmp/C12` or `net/GND`. The viewer reads them from the
 * metadata tables; only feature IDs are derived (`feat/<layer name>/<n>`, or
 * `feat/<instance>/<layer name>/<n>` for a feature of a panel's instance, spec §6.14).
 */

/** Kinds of board elements that carry an ID. */
export type ElementKind = 'board' | 'layer' | 'component' | 'pin' | 'net' | 'feature' | 'instance';

const PREFIXES: ReadonlyArray<readonly [string, ElementKind]> = [
  ['layer/', 'layer'],
  ['cmp/', 'component'],
  ['pin/', 'pin'],
  ['net/', 'net'],
  ['feat/', 'feature'],
  ['inst/', 'instance'],
];

const MUST_ENCODE = /[%/#@\p{White_Space}\p{Cc}]/gu;

/**
 * Percent-encodes one ID segment as spec §5 requires: `%`, `/`, `#`, `@`, whitespace and control
 * characters become `%XX` (UTF-8 bytes, upper-case hex). Everything else is kept.
 *
 * @example `'cmp/' + encodeIdSegment('U 3')` is `'cmp/U%203'`.
 */
export function encodeIdSegment(segment: string): string {
  return segment.replace(MUST_ENCODE, (c) => encodeURIComponent(c));
}

/** Returns the kind of an ID from its prefix, or `null` if the ID is not well-formed. */
export function idKind(id: string): ElementKind | null {
  if (id === 'board') {
    return 'board';
  }
  for (const [prefix, kind] of PREFIXES) {
    if (id.startsWith(prefix) && id.length > prefix.length) {
      return kind;
    }
  }
  return null;
}

/**
 * Builds the ID of feature `source` on a layer or drill layer, e.g. `feat/TOP/12`. A feature of
 * an instance (spec §6.14) gets the instance's ID, e.g. `feat/board-2/TOP/12` for `inst/board-2`.
 */
export function featureId(layerId: string, source: number, instanceId?: string | null): string {
  const scope = instanceId ? `${instanceId.slice('inst/'.length)}/` : '';
  return `feat/${scope}${layerId.slice('layer/'.length)}/${source}`;
}

/**
 * Splits a feature ID into its layer ID, source index and instance ID (`null` for the converted
 * step's own features), or returns `null` if `id` is not a well-formed feature ID.
 */
export function parseFeatureId(
  id: string,
): { layerId: string; source: number; instanceId: string | null } | null {
  const match = /^feat\/(?:([^/]+)\/)?([^/]+)\/(0|[1-9][0-9]*)$/.exec(id);
  if (!match) {
    return null;
  }
  return {
    layerId: `layer/${match[2]}`,
    source: Number(match[3]),
    instanceId: match[1] === undefined ? null : `inst/${match[1]}`,
  };
}
