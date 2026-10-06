/**
 * Dev page: loads a generated fixture into <board-viewer> and exposes the API through controls.
 * Query parameters: `board=small|dense`, `backend=webgl`.
 */
import '../src/index.js';
import { denseBoardGlb, smallBoardGlb } from '../test/fixture/boards.js';

const params = new URLSearchParams(location.search);
const boardName = params.get('board') === 'dense' ? 'dense' : 'small';
const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

// The backend attribute is read on connect, so set it before the element enters the page.
const viewer = document.createElement('board-viewer');
if (params.get('backend') === 'webgl') {
  viewer.setAttribute('backend', 'webgl');
}
document.body.prepend(viewer);
Object.assign(globalThis, { viewer });

const status = $<HTMLPreElement>('#status');
const boardSelect = $<HTMLSelectElement>('#board');
const webgl = $<HTMLInputElement>('#webgl');
boardSelect.value = boardName;
webgl.checked = params.get('backend') === 'webgl';
const reload = () => {
  const next = new URLSearchParams({ board: boardSelect.value });
  if (webgl.checked) next.set('backend', 'webgl');
  location.search = next.toString();
};
boardSelect.addEventListener('change', reload);
webgl.addEventListener('change', reload);

status.textContent = `Generating ${boardName} fixture…`;
await new Promise((resolve) => setTimeout(resolve, 0));
let start = performance.now();
const glb = boardName === 'dense' ? denseBoardGlb() : smallBoardGlb();
const generated = performance.now() - start;
start = performance.now();
await viewer.load(glb);
const loaded = performance.now() - start;
const sizeMb = (glb.byteLength / 1e6).toFixed(1);

const showStats = () => {
  const stats = viewer.stats();
  status.textContent = [
    `${boardName}: ${sizeMb} MB GLB, generated in ${generated.toFixed(0)} ms, loaded in ${loaded.toFixed(0)} ms`,
    stats
      ? `${stats.backend}: ${stats.drawCalls} draw calls, ${stats.triangles} triangles`
      : 'not rendered yet',
  ].join('\n');
};
setInterval(showStats, 500);

$('#download').addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
  link.download = `boardui-fixture-${boardName}.glb`;
  link.click();
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  button.addEventListener('click', () => viewer.setView(button.dataset.view as 'top'));
}
$<HTMLInputElement>('#xray').addEventListener('change', (e) =>
  viewer.setXray((e.target as HTMLInputElement).checked),
);

const layers = $('#layers');
for (const layer of viewer.layers) {
  const label = document.createElement('label');
  const box = Object.assign(document.createElement('input'), {
    type: 'checkbox',
    checked: layer.visible,
  });
  box.addEventListener('change', () => viewer.setLayerVisible(layer.id, box.checked));
  label.append(box, ` ${layer.id} `, layer.role ? `(${layer.role.toLowerCase()})` : '(drill)');
  layers.append(label);
}

const nets = $<HTMLSelectElement>('#net');
for (const id of viewer.ids('net').slice(0, 500)) {
  nets.append(new Option(id, id));
}
const highlights: (() => void)[] = [];
$('#highlight').addEventListener('click', () => {
  highlights.push(
    viewer.highlight({ net: nets.value }, { color: $<HTMLInputElement>('#color').value }),
  );
});
$('#clear').addEventListener('click', () => {
  for (const clear of highlights.splice(0)) clear();
});

const hidden: (() => void)[] = [];
$('#focus').addEventListener('click', () => viewer.selection && viewer.focus(viewer.selection));
$('#hide').addEventListener('click', () => {
  if (viewer.selection) hidden.push(viewer.hide({ ids: [viewer.selection] }));
});
$('#show').addEventListener('click', () => {
  for (const show of hidden.splice(0)) show();
});

const widget = (id: string, text: string, className = 'tag') =>
  viewer.attachWidget(
    id,
    Object.assign(document.createElement('span'), { className, textContent: text }),
    {
      anchor: 'top',
      offset: [0, -6],
      occlusion: 'fade',
    },
  );
$('#widget').addEventListener('click', () => {
  const id = viewer.selection;
  if (id) widget(id, (viewer.info(id)?.properties.refDes as string) ?? id);
});
const first = viewer.ids('component')[0];
if (first) widget(first, viewer.info(first)?.properties.refDes as string);
if (boardName === 'small') {
  widget('cmp/C1', 'C1 (bottom)');
  widget('net/%2FSDA', 'SDA', 'tag net');
}

const show = (target: HTMLElement, detail: unknown) => {
  target.textContent = JSON.stringify(detail, null, 1);
};
viewer.addEventListener('bui-hover', (e) => show($('#hover'), e.detail));
viewer.addEventListener('bui-select', (e) => show($('#selection'), e.detail));
