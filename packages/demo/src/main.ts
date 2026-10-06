/**
 * The boardui demo: drop or pick an IPC-2581 file (optionally with a model mapping and models)
 * or a boardui GLB, convert it locally in WebAssembly, view it, and download the GLB.
 *
 * Query parameters: `sample=<id>` opens a sample (`src/samples.ts`), `glb=<url>` loads a GLB,
 * `stats` shows the renderer statistics (backend, fps, draw calls, triangles), `spin` orbits the
 * camera continuously (to measure the frame rate), `backend=webgl` forces WebGL2.
 * `globalThis.demo` exposes the viewer and the last load's timings for tests and the console.
 */
import '@boardui/viewer';
import type { ConvertResult, ModelsInput } from '@boardui/converter';
import type { ElementInfo, LoadProgress } from '@boardui/viewer';
import { $, append, formatBytes, formatCount, formatSeconds, h } from './dom.js';
import { classify, filesFromDrop, filesFromList, type InputFile } from './files.js';
import { formatValue, isElementId, kindLabel, label, summary } from './names.js';
import { SAMPLES, type Sample } from './samples.js';
import { StatsOverlay } from './stats.js';
import './style.css';

declare const __SAMPLE_SIZES__: Record<string, number>;

const params = new URLSearchParams(location.search);
const samplesBase = `${import.meta.env.BASE_URL}samples/`;

// The backend attribute is read when the element connects, so set it first.
const viewer = document.createElement('board-viewer');
viewer.id = 'viewer';
if (params.get('backend') === 'webgl') viewer.setAttribute('backend', 'webgl');
$('#stage').prepend(viewer);

/** Timings of the last load, in milliseconds (conversion steps in seconds). */
interface Timings {
  fetch?: number;
  convert?: number;
  load?: number;
  firstFrame?: number;
  total?: number;
  steps?: ConvertResult['timings'];
}

interface Board {
  name: string;
  glb: ArrayBuffer;
  conversion: ConvertResult | null;
  sample?: Sample;
}

const HIGHLIGHT_COLORS = ['#ffd400', '#00e5ff', '#ff6d00', '#76ff03', '#ff4081', '#b388ff'];
const ROLE_COLORS: Record<string, string> = {
  COPPER: '#c9a15a',
  SOLDERMASK: '#2e8b46',
  SILKSCREEN: '#f2f2f2',
  DIELECTRIC: '#c7b98a',
  drill: '#9aa3ad',
};

let board: Board | null = null;
let job: AbortController | null = null;
let timings: Timings = {};
let selection: string | null = null;
let showComponents: (() => void) | null = null;
const highlights = new Map<string, { color: string; remove: () => void }>();
const tags = new Map<string, { element: HTMLElement; detach: () => void; pinned: boolean }>();
const stats = params.has('stats') ? new StatsOverlay(viewer, $('#stats')) : null;
if (params.has('spin')) viewer.autoRotate = true;

const demo = { viewer, samples: SAMPLES, timings, board: () => board, open: openSample };
Object.assign(globalThis, { demo });

// --- Opening boards -------------------------------------------------------------------------

const setState = (state: 'empty' | 'busy' | 'ready' | 'error') => {
  document.body.dataset.state = state;
};

async function openSample(sample: Sample): Promise<void> {
  const url = (path: string) => samplesBase + path;
  await run(sample.name, async (signal, progress) => {
    const start = performance.now();
    const size = __SAMPLE_SIZES__[sample.xml] ?? 0;
    progress('Downloading', `${sample.xml.split('/').pop()} (${formatBytes(size)})`, 0);
    const xml = await download(url(sample.xml), signal, (f) =>
      progress('Downloading', `${formatBytes(size * f)} of ${formatBytes(size)}`, f * 0.1),
    );
    let models: ModelsInput | undefined;
    if (sample.models) {
      const files = await Promise.all(
        sample.models.files.map(async (path) => ({
          path: path.slice(path.lastIndexOf('/') + 1),
          data: await download(url(path), signal),
        })),
      );
      models = {
        mapping: await (await download(url(sample.models.mapping), signal)).text(),
        files,
      };
    }
    timings.fetch = performance.now() - start;
    setSampleParam(sample.id);
    return convert(
      sample.name,
      xml,
      models,
      signal,
      (p) => progress(p.title, p.step, 0.1 + 0.9 * p.fraction),
      sample,
    );
  });
}

async function openFiles(files: InputFile[]): Promise<void> {
  if (!files.length) return;
  let opened: Awaited<ReturnType<typeof classify>>;
  try {
    opened = await classify(files);
  } catch (error) {
    showError(error);
    return;
  }
  setSampleParam(null);
  if (opened.kind === 'glb') {
    const name = opened.glb.name.replace(/\.glb$/i, '');
    const glb = opened.glb;
    await run(name, async (_signal, progress) => {
      progress('Loading', glb.name, 0.5);
      const buffer = await glb.arrayBuffer();
      const start = performance.now();
      await viewer.load(buffer);
      timings.load = performance.now() - start;
      return { name, glb: buffer, conversion: null };
    });
    return;
  }
  const { xml, mapping, models } = opened;
  const name = xml.name.replace(/\.xml$/i, '');
  const input: ModelsInput | undefined = mapping
    ? { mapping: mapping.file, files: models.map((m) => ({ path: m.path, data: m.file })) }
    : undefined;
  await run(name, (signal, progress) =>
    convert(name, xml, input, signal, (p) => progress(p.title, p.step, p.fraction)),
  );
}

async function loadGlbUrl(url: string): Promise<void> {
  const name =
    url
      .split('/')
      .pop()
      ?.replace(/\.glb$/i, '') ?? 'board';
  await run(name, async (signal, progress) => {
    progress('Downloading', url, 0);
    const start = performance.now();
    const glb = await (
      await download(url, signal, (f) => progress('Downloading', url, f))
    ).arrayBuffer();
    timings.fetch = performance.now() - start;
    const loadStart = performance.now();
    await viewer.load(glb);
    timings.load = performance.now() - loadStart;
    return { name, glb, conversion: null };
  });
}

/** Converts IPC-2581 in the viewer's worker and records the timings. */
async function convert(
  name: string,
  xml: Blob,
  models: ModelsInput | undefined,
  signal: AbortSignal,
  progress: (p: { title: string; step: string; fraction: number }) => void,
  sample?: Sample,
): Promise<Board> {
  const start = performance.now();
  let loadStart = start;
  const onProgress = (p: LoadProgress) => {
    if (p.stage === 'load' && p.step === 'load') loadStart = performance.now();
    const title = p.stage === 'convert' ? 'Converting' : 'Loading';
    progress({
      title,
      step: p.stage === 'convert' ? stepLabel(p.step) : 'building the scene',
      fraction: p.fraction,
    });
  };
  const conversion = await viewer.loadIpc2581(xml, {
    signal,
    onProgress,
    ...(models ? { models } : {}),
  });
  const end = performance.now();
  timings.convert = loadStart - start;
  timings.load = end - loadStart;
  timings.steps = conversion.timings;
  return { name, glb: conversion.glb, conversion, ...(sample ? { sample } : {}) };
}

const STEP_LABELS: Record<string, string> = {
  start: 'starting the converter',
  parse: 'reading the XML',
  'stack-up, features, components': 'stack-up, features and components',
  resolve: 'resolving overlaps',
  'hole cuts': 'cutting holes',
  'cut and sheets': 'soldermask and dielectric sheets',
  extrude: 'extruding layers',
  barrels: 'plated barrels',
  write: 'writing the GLB',
};
const stepLabel = (step: string) => STEP_LABELS[step] ?? step;

/** Runs one load with the progress card; a new load cancels the previous one. */
async function run(
  name: string,
  task: (
    signal: AbortSignal,
    progress: (title: string, step: string, fraction: number) => void,
  ) => Promise<Board>,
): Promise<void> {
  job?.abort();
  const controller = new AbortController();
  job = controller;
  timings = {};
  demo.timings = timings;
  const start = performance.now();
  const card = $('#progress');
  const tick = setInterval(() => {
    $('#progress-time').textContent = formatSeconds((performance.now() - start) / 1000);
  }, 100);
  const progress = (title: string, step: string, fraction: number) => {
    $('#progress-title').textContent = `${title} ${name}`;
    $('#progress-step').textContent = step;
    $('#progress-fill').style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
  };
  progress('Opening', '', 0);
  $('#error').hidden = true;
  card.hidden = false;
  setState('busy');
  clearBoardState();
  try {
    const loaded = await task(controller.signal, progress);
    if (job !== controller) return;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    timings.total = performance.now() - start;
    timings.firstFrame =
      timings.total - (timings.fetch ?? 0) - (timings.convert ?? 0) - (timings.load ?? 0);
    board = loaded;
    showBoard(loaded);
    setState('ready');
  } catch (error) {
    if (job !== controller) return;
    if (controller.signal.aborted) {
      setState(board ? 'ready' : 'empty');
    } else {
      showError(error);
    }
  } finally {
    clearInterval(tick);
    if (job === controller) {
      job = null;
      card.hidden = true;
    }
  }
}

/** Fetches a URL, reporting the downloaded fraction. */
async function download(
  url: string,
  signal: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Couldn’t download ${url}: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !onProgress || !total) return response.blob();
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    received += value.byteLength;
    // With content encoding the length is the compressed size; the fraction is approximate.
    onProgress(Math.min(1, received / total));
  }
  return new Blob(chunks);
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  $('#error-message').textContent = message;
  $('#error').hidden = false;
  setState('error');
}

function setSampleParam(id: string | null): void {
  const next = new URLSearchParams(location.search);
  next.delete('glb');
  if (id) next.set('sample', id);
  else next.delete('sample');
  const query = next.toString().replace(/=(?=&|$)/g, '');
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
}

// --- Board UI -------------------------------------------------------------------------------

/** Resets selection, highlights, tags and the panels before a board is replaced. */
function clearBoardState(): void {
  for (const tag of tags.values()) tag.detach();
  tags.clear();
  highlights.clear();
  showComponents = null;
  selection = null;
  $('#details').hidden = true;
  $('#tooltip').hidden = true;
}

function showBoard(loaded: Board): void {
  $('#empty').hidden = true;
  document.body.dataset.board = loaded.name;
  const sidebar = $('#sidebar');
  sidebar.hidden = false;
  sidebar.replaceChildren(
    boardSection(loaded),
    viewSection(),
    layersSection(),
    netsSection(),
    ...(loaded.conversion?.warnings.length ? [warningsSection(loaded.conversion)] : []),
  );
}

function section(title: string, ...children: (Node | string | null | false)[]): HTMLElement {
  return h('section', { class: 'panel' }, h('h3', {}, title), ...children);
}

function boardSection(loaded: Board): HTMLElement {
  const info = viewer.info('board')?.properties ?? {};
  const source = (info.source ?? {}) as Record<string, string>;
  const c = loaded.conversion;
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
  if (c) rows.push(['Converted in', formatSeconds(c.seconds)]);
  rows.push(['GLB', formatBytes(loaded.glb.byteLength)]);
  const download = h(
    'button',
    {
      class: 'primary wide',
      type: 'button',
      onclick: () => {
        const link = h('a', {
          href: URL.createObjectURL(new Blob([loaded.glb], { type: 'model/gltf-binary' })),
          download: `${loaded.name}.glb`,
        });
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      },
    },
    'Download GLB',
  );
  return section(
    'Board',
    h('div', { class: 'board-name', title: source.step ?? '' }, loaded.name),
    h('dl', { class: 'facts' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    download,
  );
}

function viewSection(): HTMLElement {
  const view = (name: 'top' | 'bottom' | 'iso', text: string, key: string) =>
    h(
      'button',
      { type: 'button', title: `${text} (${key})`, onclick: () => viewer.setView(name) },
      text,
    );
  const xray = h('input', {
    type: 'checkbox',
    id: 'xray-toggle',
    checked: viewer.xray,
    onchange: (e: Event) => setXray((e.target as HTMLInputElement).checked),
  });
  return section(
    'View',
    h(
      'div',
      { class: 'button-row' },
      view('top', 'Top', 't'),
      view('bottom', 'Bottom', 'b'),
      view('iso', 'Iso', 'i'),
    ),
    h('label', { class: 'toggle' }, xray, h('span', {}, 'X-ray'), h('kbd', {}, 'x')),
  );
}

function setXray(on: boolean): void {
  viewer.setXray(on);
  const toggle = document.querySelector<HTMLInputElement>('#xray-toggle');
  if (toggle) toggle.checked = on;
  refreshLayers();
}

function layersSection(): HTMLElement {
  const list = h('ul', { class: 'layers', id: 'layer-list' });
  const components = h('input', {
    type: 'checkbox',
    checked: !showComponents,
    onchange: (e: Event) => {
      if ((e.target as HTMLInputElement).checked) {
        showComponents?.();
        showComponents = null;
      } else {
        showComponents = viewer.hide({ ids: viewer.ids('component') });
      }
    },
  });
  const panel = section(
    'Layers',
    h(
      'label',
      { class: 'toggle layer-row' },
      components,
      h('span', { class: 'swatch', style: 'background:#3a3f47' }),
      h('span', {}, 'Components'),
    ),
    list,
  );
  queueMicrotask(refreshLayers);
  return panel;
}

function refreshLayers(): void {
  const list = document.querySelector('#layer-list');
  if (!list) return;
  list.replaceChildren(
    ...viewer.layers.map((layer) => {
      const color = ROLE_COLORS[layer.kind === 'drill' ? 'drill' : (layer.role ?? '')] ?? '#888';
      const checkbox = h('input', {
        type: 'checkbox',
        checked: layer.visible,
        dataset: { layer: layer.id },
        onchange: (e: Event) =>
          viewer.setLayerVisible(layer.id, (e.target as HTMLInputElement).checked),
      });
      const role = layer.kind === 'drill' ? 'drill' : (layer.role ?? '').toLowerCase();
      return h(
        'li',
        {},
        h(
          'label',
          { class: 'toggle layer-row', title: layer.id },
          checkbox,
          h('span', { class: 'swatch', style: `background:${color}` }),
          h('span', { class: 'layer-name' }, layer.name),
          h('span', { class: 'layer-role' }, role),
        ),
      );
    }),
  );
}

function netsSection(): HTMLElement {
  const nets = viewer
    .ids('net')
    .map((id) => ({ id, name: label(id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const results = h('ul', { class: 'net-results' });
  const active = h('ul', { class: 'net-active', id: 'net-active' });
  const input = h('input', {
    type: 'search',
    id: 'net-search',
    placeholder: `Search ${formatCount(nets.length)} nets…`,
    autocomplete: 'off',
    spellcheck: false,
  });
  const render = () => {
    const query = input.value.trim().toLowerCase();
    const matches = query ? nets.filter((n) => n.name.toLowerCase().includes(query)) : [];
    results.replaceChildren(
      ...matches.slice(0, 40).map((net) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'net-result',
              dataset: { net: net.id },
              onclick: () => toggleHighlight(net.id, true),
            },
            net.name,
          ),
        ),
      ),
      ...(matches.length > 40 ? [h('li', { class: 'muted' }, `${matches.length - 40} more…`)] : []),
      ...(query && !matches.length ? [h('li', { class: 'muted' }, 'No matching net')] : []),
    );
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = results.querySelector<HTMLButtonElement>('.net-result');
      first?.click();
    }
  });
  return section('Nets', input, results, active);
}

/** Highlights a net in the next free colour, or removes its highlight. */
function toggleHighlight(net: string, focus = false): void {
  const existing = highlights.get(net);
  if (existing) {
    existing.remove();
    highlights.delete(net);
  } else {
    const used = new Set([...highlights.values()].map((h) => h.color));
    const color =
      HIGHLIGHT_COLORS.find((c) => !used.has(c)) ??
      HIGHLIGHT_COLORS[highlights.size % HIGHLIGHT_COLORS.length] ??
      '#ffd400';
    highlights.set(net, { color, remove: viewer.highlight({ net }, { color }) });
    if (focus) viewer.focus(net);
  }
  renderHighlights();
}

function renderHighlights(): void {
  const list = document.querySelector('#net-active');
  if (!list) return;
  list.replaceChildren(
    ...[...highlights].map(([net, { color }]) =>
      h(
        'li',
        {},
        h('span', { class: 'swatch', style: `background:${color}` }),
        h(
          'button',
          { type: 'button', class: 'link', onclick: () => viewer.focus(net) },
          label(net),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'remove',
            title: 'Remove highlight',
            onclick: () => toggleHighlight(net),
          },
          '×',
        ),
      ),
    ),
  );
}

function warningsSection(conversion: ConvertResult): HTMLElement {
  const count = conversion.warnings.reduce((n, w) => n + w.occurrences, 0);
  return h(
    'details',
    { class: 'panel warnings' },
    h('summary', {}, `${conversion.warnings.length} converter warnings (${formatCount(count)}×)`),
    h(
      'ul',
      {},
      ...conversion.warnings.map((w) =>
        h(
          'li',
          {},
          w.line ? h('span', { class: 'muted' }, `line ${w.line}: `) : null,
          w.message,
          w.occurrences > 1
            ? h('span', { class: 'muted' }, ` (${formatCount(w.occurrences)}×)`)
            : null,
        ),
      ),
    ),
  );
}

// --- Selection, details and tags -------------------------------------------------------------

/** Selects an element from the UI (the viewer selects on click by itself). */
function selectId(id: string | null, focus = false): void {
  viewer.select(id);
  onSelect(id ? viewer.info(id) : null);
  if (id && focus) viewer.focus(id);
}

function onSelect(info: ElementInfo | null): void {
  const previous = selection;
  selection = info?.id ?? null;
  if (previous && previous !== selection) {
    const tag = tags.get(previous);
    if (tag && !tag.pinned) removeTag(previous);
  }
  if (info && info.kind !== 'net' && info.kind !== 'layer' && !tags.has(info.id))
    addTag(info, false);
  renderDetails(info);
}

function renderDetails(info: ElementInfo | null): void {
  const panel = $('#details');
  if (!info) {
    panel.hidden = true;
    return;
  }
  const { title, detail } = summary(info);
  const rows = Object.entries(info.properties).filter(([, v]) => v !== '' && v !== undefined);
  const value = (key: string, v: unknown) =>
    isElementId(v)
      ? h('button', { type: 'button', class: 'link', onclick: () => selectId(v, true) }, label(v))
      : formatValue(key, v);
  const net = info.kind === 'net' ? info.id : (info.properties.net as string | undefined);
  const tag = tags.get(info.id);
  panel.replaceChildren();
  append(
    panel,
    h(
      'header',
      {},
      h('span', { class: `badge kind-${info.kind}` }, kindLabel(info.kind)),
      h('strong', { class: 'details-title' }, title),
      h(
        'button',
        {
          type: 'button',
          class: 'remove',
          title: 'Clear selection (Esc)',
          onclick: () => selectId(null),
        },
        '×',
      ),
    ),
    detail ? h('div', { class: 'muted details-sub' }, detail) : null,
    h(
      'dl',
      { class: 'facts' },
      ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, value(k, v))]),
    ),
    h(
      'div',
      { class: 'button-row' },
      h('button', { type: 'button', onclick: () => viewer.focus(info.id) }, 'Focus'),
      isElementId(net)
        ? h(
            'button',
            { type: 'button', onclick: () => toggleHighlight(net) },
            highlights.has(net) ? 'Unhighlight net' : 'Highlight net',
          )
        : null,
      tag
        ? h(
            'button',
            {
              type: 'button',
              onclick: () => {
                tag.pinned = !tag.pinned;
                tag.element.classList.toggle('pinned', tag.pinned);
                renderDetails(info);
              },
            },
            tag.pinned ? 'Unpin tag' : 'Pin tag',
          )
        : null,
    ),
  );
  panel.hidden = false;
}

/** Attaches a tag widget that follows an element. */
function addTag(info: ElementInfo, pinned: boolean): void {
  const { title, detail } = summary(info);
  const element = h(
    'div',
    { class: `tag kind-${info.kind}${pinned ? ' pinned' : ''}`, dataset: { id: info.id } },
    h(
      'button',
      { type: 'button', class: 'tag-body', onclick: () => selectId(info.id) },
      h('b', {}, title),
      detail ? h('span', {}, detail) : null,
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'tag-close',
        title: 'Remove tag',
        onclick: () => removeTag(info.id),
      },
      '×',
    ),
  );
  const detach = viewer.attachWidget(info.id, element, {
    anchor: 'top',
    offset: [0, -6],
    occlusion: 'fade',
  });
  tags.set(info.id, { element, detach, pinned });
}

function removeTag(id: string): void {
  tags.get(id)?.detach();
  tags.delete(id);
  if (selection === id) renderDetails(viewer.info(id));
}

viewer.addEventListener('bui-select', (e) => onSelect(e.detail));

// Hover tooltip, next to the pointer.
let pointer = { x: 0, y: 0 };
viewer.addEventListener('pointermove', (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  placeTooltip();
});
viewer.addEventListener('bui-hover', (e) => {
  const tooltip = $('#tooltip');
  const info = e.detail;
  if (!info) {
    tooltip.hidden = true;
    return;
  }
  const { title, detail } = summary(info);
  tooltip.replaceChildren(h('strong', {}, title), detail ? h('span', {}, detail) : '');
  tooltip.hidden = false;
  placeTooltip();
});
function placeTooltip(): void {
  const tooltip = $('#tooltip');
  if (tooltip.hidden) return;
  const stage = $('#stage').getBoundingClientRect();
  tooltip.style.transform = `translate(${pointer.x - stage.left + 14}px, ${pointer.y - stage.top + 14}px)`;
}

// --- Inputs ---------------------------------------------------------------------------------

const fileInput = $<HTMLInputElement>('#file-input');
const pick = () => fileInput.click();
$('#open-button').addEventListener('click', pick);
$('#drop-zone').addEventListener('click', pick);
fileInput.addEventListener('change', () => {
  if (fileInput.files) void openFiles(filesFromList(fileInput.files));
  fileInput.value = '';
});
$('#progress-cancel').addEventListener('click', () => job?.abort());
$('#error-close').addEventListener('click', () => {
  $('#error').hidden = true;
  setState(board ? 'ready' : 'empty');
});

let dragDepth = 0;
const overlay = $('#drop-overlay');
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  overlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) overlay.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  if (e.dataTransfer) void filesFromDrop(e.dataTransfer).then(openFiles, showError);
});

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey || !board)
    return;
  const views: Record<string, 'top' | 'bottom' | 'iso'> = { t: 'top', b: 'bottom', i: 'iso' };
  if (e.key === 'Escape') selectId(null);
  else if (e.key === 'x') setXray(!viewer.xray);
  else if (e.key === 'f' && selection) viewer.focus(selection);
  else if (views[e.key]) viewer.setView(views[e.key] as 'top');
});

// Sample pickers: the top bar's select and the cards of the empty state.
const select = $<HTMLSelectElement>('#sample-select');
for (const group of ['KiCad', 'IPC consortium', 'Hand-written'] as const) {
  const options = SAMPLES.filter((s) => s.group === group).map((s) =>
    h('option', { value: s.id }, `${s.name} (${formatBytes(__SAMPLE_SIZES__[s.xml] ?? 0)})`),
  );
  append(select, h('optgroup', { label: group }, ...options));
}
select.addEventListener('change', () => {
  const sample = SAMPLES.find((s) => s.id === select.value);
  select.value = '';
  if (sample) void openSample(sample);
});
const cards = $('#sample-cards');
for (const sample of SAMPLES) {
  const featured = sample.group !== 'Hand-written';
  append(
    cards,
    h(
      'button',
      {
        type: 'button',
        class: featured ? 'sample-card' : 'sample-chip',
        dataset: { sample: sample.id },
        title: sample.description,
        onclick: () => void openSample(sample),
      },
      h('span', { class: 'sample-group' }, sample.group),
      h('span', { class: 'sample-name' }, sample.name),
      featured ? h('span', { class: 'sample-desc' }, sample.description) : null,
      h('span', { class: 'sample-size' }, formatBytes(__SAMPLE_SIZES__[sample.xml] ?? 0)),
    ),
  );
}

// Start: a sample or GLB from the URL, else the empty state.
const initial = SAMPLES.find((s) => s.id === params.get('sample'));
const glbParam = params.get('glb');
if (initial) void openSample(initial);
else if (glbParam) void loadGlbUrl(glbParam);
stats?.start();
