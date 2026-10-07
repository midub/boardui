/**
 * What the demo's panels show about a loaded board, independent of the UI framework: board
 * facts, layer rows, the net search, element details, and the keyboard shortcuts.
 */
import type { ConvertResult } from '@boardui/converter';
import {
  type BoardViewerElement,
  type ElementInfo,
  type LayerState,
  OPTIONAL_ROLES,
} from '@boardui/viewer';
import { formatBytes, formatCount, formatSeconds } from './format.js';
import { formatValue, label } from './names.js';
import type { Board } from './session.js';

/** Colours of net highlights, used in turn. */
export const HIGHLIGHT_COLORS = ['#ffd400', '#00e5ff', '#ff6d00', '#76ff03', '#ff4081', '#b388ff'];

/** Swatch colours of layers without a material colour, by role. */
export const ROLE_COLORS: Record<string, string> = {
  COPPER: '#c9a15a',
  SOLDERMASK: '#2e8b46',
  SILKSCREEN: '#f2f2f2',
  DIELECTRIC: '#c7b98a',
  PASTE: '#a4a7ab',
  COURTYARD: '#c07aae',
  ASSEMBLY: '#7db2c4',
  DOCUMENTATION: '#9fbf73',
  drill: '#9aa3ad',
};

/** Swatch colour of the components row. */
export const COMPONENTS_COLOR = '#3a3f47';

/** The next highlight colour: the first one not in use, else one in turn. */
export function nextHighlightColor(used: readonly string[]): string {
  return (
    HIGHLIGHT_COLORS.find((c) => !used.includes(c)) ??
    HIGHLIGHT_COLORS[used.length % HIGHLIGHT_COLORS.length] ??
    '#ffd400'
  );
}

/** Rows of the board panel. */
export function boardFacts(viewer: BoardViewerElement, board: Board): [string, string][] {
  const info = viewer.info('board')?.properties ?? {};
  const source = (info.source ?? {}) as {
    functionMode?: string;
    software?: { name: string; revision?: string };
  };
  const c = board.conversion;
  const rows: [string, string][] = [
    ['Components', formatCount(viewer.ids('component').length)],
    ['Nets', formatCount(viewer.ids('net').length)],
    ['Layers', String(viewer.layers.length)],
  ];
  if (c) {
    rows.push(['Features', formatCount(c.stats.features)]);
    rows.push(['Triangles', formatCount(c.stats.triangles)]);
  }
  rows.push(['Thickness', formatValue('thickness', info.thickness)]);
  if (source.functionMode) rows.push(['Mode', source.functionMode]);
  if (source.software) {
    const { name, revision } = source.software;
    rows.push(['Exported by', revision ? `${name} ${revision}` : name]);
  }
  if (c) rows.push(['Converted in', formatSeconds(c.seconds)]);
  rows.push(['GLB', formatBytes(board.glb.byteLength)]);
  return rows;
}

/** The board's step name (tooltip of the board name), if known. */
export function boardStep(viewer: BoardViewerElement): string {
  const source = (viewer.info('board')?.properties.source ?? {}) as Record<string, string>;
  return source.step ?? '';
}

/** Saves the GLB as `<name>.glb`. */
export function downloadGlb(board: Board): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([board.glb], { type: 'model/gltf-binary' }));
  link.download = `${board.name}.glb`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/** A row of the layer list. */
export interface LayerRow {
  layer: LayerState;
  color: string;
  /** `copper`, `soldermask`, …, or `drill`. */
  role: string;
}

/**
 * The layer list: the board's layers, then paste and drawings (hidden by default) as their own
 * group, `Paste and drawings`.
 */
export function layerRows(layers: readonly LayerState[]): { board: LayerRow[]; extra: LayerRow[] } {
  const optional = (layer: LayerState) => !!layer.role && OPTIONAL_ROLES.has(layer.role);
  const row = (layer: LayerState): LayerRow => ({
    layer,
    color:
      layer.color ?? ROLE_COLORS[layer.kind === 'drill' ? 'drill' : (layer.role ?? '')] ?? '#888',
    role: layer.kind === 'drill' ? 'drill' : (layer.role ?? '').toLowerCase(),
  });
  return {
    board: layers.filter((l) => !optional(l)).map(row),
    extra: layers.filter(optional).map(row),
  };
}

/** A net of the net search. */
export interface NetEntry {
  id: string;
  name: string;
}

/** The board's nets, by name. */
export function netList(viewer: BoardViewerElement): NetEntry[] {
  return viewer
    .ids('net')
    .map((id) => ({ id, name: label(id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}

/** Results of the net search: the first `limit` matches, and how many more there are. */
export function searchNets(
  nets: readonly NetEntry[],
  query: string,
  limit = 40,
): { matches: NetEntry[]; more: number } {
  const q = query.trim().toLowerCase();
  const all = q ? nets.filter((n) => n.name.toLowerCase().includes(q)) : [];
  return { matches: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

/**
 * The properties of an element that the details panel lists, then a component's BOM attributes
 * (value, description, MPN, LCSC, … as the source names them; profile 0.8). An attribute named
 * like a property is left out, so that every row has its own name.
 */
export function detailRows(info: ElementInfo): [string, unknown][] {
  const { attributes, ...properties } = info.properties;
  const rows = Object.entries(properties).filter(([, v]) => v !== '' && v !== undefined);
  if (attributes && typeof attributes === 'object') {
    rows.push(...Object.entries(attributes).filter(([name]) => !Object.hasOwn(properties, name)));
  }
  return rows;
}

/** The net of an element (itself for a net), for "Highlight net". */
export function elementNet(info: ElementInfo): string | undefined {
  return info.kind === 'net' ? info.id : (info.properties.net as string | undefined);
}

/** Whether a selected element gets a tag (not nets and layers, which have no single place). */
export function hasTag(info: ElementInfo): boolean {
  return info.kind !== 'net' && info.kind !== 'layer';
}

/** Title of the converter warnings panel. */
export function warningsTitle(conversion: ConvertResult): string {
  const count = conversion.warnings.reduce((n, w) => n + w.occurrences, 0);
  return `${conversion.warnings.length} converter warnings (${formatCount(count)}×)`;
}

/** What a key does: `t`, `b`, `i` views, `x` x-ray, `f` focus the selection, `Esc` clear it. */
export type Shortcut = 'top' | 'bottom' | 'iso' | 'xray' | 'focus' | 'clear';

/** The shortcut of a key press, or `null` (typing in a field, modifiers, other keys). */
export function shortcut(event: KeyboardEvent): Shortcut | null {
  const target = event.target as Element | null;
  if (target?.closest?.('input, select, textarea')) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const keys: Record<string, Shortcut> = {
    t: 'top',
    b: 'bottom',
    i: 'iso',
    x: 'xray',
    f: 'focus',
    Escape: 'clear',
  };
  return keys[event.key] ?? null;
}
