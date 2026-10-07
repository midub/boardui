/** Human-readable names of element IDs (spec §5) and their metadata. */
import type { ElementInfo } from '@boardui/viewer';

/** Decodes a percent-encoded ID segment. */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The segments of an ID after its kind prefix, decoded. */
export function segments(id: string): string[] {
  return id.split('/').slice(1).map(decodeSegment);
}

/**
 * A short label for an element ID: `U3`, `U3.5`, `GND`, `TOP`, `TOP #12`. An element of a panel's
 * instance (spec §6.14) names it: `U3 (board-2)`; the instance itself is `board-2`.
 */
export function label(id: string): string {
  const [kind] = id.split('/');
  const parts = segments(id);
  const own = { cmp: 1, net: 1, pin: 2, feat: 2 }[kind as string];
  const instance = own !== undefined && parts.length > own ? parts.shift() : undefined;
  const text = (() => {
    switch (kind) {
      case 'cmp':
      case 'net':
      case 'layer':
      case 'inst':
        return parts[0] ?? id;
      case 'pin':
        return `${parts[0]}.${parts[1]}`;
      case 'feat':
        return `${parts[0]} #${parts[1]}`;
      default:
        return id;
    }
  })();
  return instance === undefined ? text : `${text} (${instance})`;
}

/** The kind of element an ID names, for display. */
export function kindLabel(kind: string): string {
  return (
    {
      component: 'Component',
      pin: 'Pin',
      net: 'Net',
      feature: 'Feature',
      layer: 'Layer',
      instance: 'Board instance',
    }[kind] ?? kind
  );
}

/** Whether a string is an element ID that can be linked. */
export function isElementId(value: unknown): value is string {
  return typeof value === 'string' && /^(cmp|pin|net|layer|feat|inst)\//.test(value);
}

/** Title and one-line summary of an element, for the tooltip and the tags. */
export function summary(info: ElementInfo): { title: string; detail: string } {
  const p = info.properties;
  const str = (key: string) => (typeof p[key] === 'string' && p[key] ? (p[key] as string) : '');
  const ref = (key: string) => (isElementId(p[key]) ? label(p[key] as string) : '');
  switch (info.kind) {
    case 'component':
      return {
        title: label(info.id),
        detail: [str('part'), str('package'), str('side').toLowerCase()]
          .filter(Boolean)
          .join(' · '),
      };
    case 'instance':
      return {
        title: label(info.id),
        detail: [`step ${str('step')}`, str('side') === 'BOTTOM' ? 'flipped' : '']
          .filter(Boolean)
          .join(' · '),
      };
    case 'pin':
      return {
        title: label(info.id),
        detail: [str('name'), ref('net') && `net ${ref('net')}`].filter(Boolean).join(' · '),
      };
    case 'net':
      return { title: label(info.id), detail: 'net' };
    case 'feature': {
      const what = str('kind').toLowerCase() || 'feature';
      const owner = ref('pin') || ref('component');
      return {
        title: ref('net') || owner || label(info.id),
        detail: [what, owner && ref('net') ? owner : '', label(str('layer') || info.id)]
          .filter(Boolean)
          .join(' · '),
      };
    }
    default:
      return { title: label(info.id), detail: info.kind };
  }
}

/** Formats a property value for the details panel; lengths in metres become millimetres. */
export function formatValue(key: string, value: unknown): string {
  if (typeof value === 'number') {
    if (/^(z(Min|Max)|thickness|tolerance|platingThickness|height|standoff)$/.test(key)) {
      return `${(value * 1e3).toFixed(value < 1e-4 ? 4 : 3)} mm`;
    }
    // An instance's placement (spec §6.14).
    if (key === 'x' || key === 'y') return `${(value * 1e3).toFixed(3)} mm`;
    if (key === 'angle') return `${Number(value.toFixed(4))}°`;
    return Number.isInteger(value) ? String(value) : value.toPrecision(6);
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value === null || value === undefined) return '–';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
