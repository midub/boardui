/**
 * The `?stats` overlay: renderer backend, frame rate, draw calls and triangles of the last
 * frame. The viewer renders on demand, so the frame rate is only meaningful while the view moves:
 * orbit the board, or tick "spin" (`?spin`) to render continuously.
 */
import type { BoardViewerElement } from '@boardui/viewer';
import { formatCount, h } from './dom.js';

/** Frame-rate samples over this window, in milliseconds. */
const WINDOW = 1000;

export class StatsOverlay {
  readonly #viewer: BoardViewerElement;
  readonly #root: HTMLElement;
  readonly #text = h('pre', { class: 'stats-text' });
  readonly #samples: { time: number; frames: number }[] = [];
  #shown = 0;
  /** Frame rate of the last full window while frames were rendered, for tests and the console. */
  fps = 0;

  constructor(viewer: BoardViewerElement, root: HTMLElement) {
    this.#viewer = viewer;
    this.#root = root;
    const spin = h('input', {
      type: 'checkbox',
      id: 'spin-toggle',
      checked: viewer.autoRotate,
      onchange: (e: Event) => {
        viewer.autoRotate = (e.target as HTMLInputElement).checked;
      },
    });
    root.replaceChildren(this.#text, h('label', { class: 'toggle' }, spin, h('span', {}, 'spin')));
    root.hidden = false;
    Object.assign(globalThis, { stats: this });
  }

  start(): void {
    const tick = (time: number) => {
      this.#update(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  #update(time: number): void {
    const stats = this.#viewer.stats();
    const samples = this.#samples;
    samples.push({ time, frames: stats?.frames ?? 0 });
    while (samples.length > 2 && time - (samples[1]?.time ?? time) >= WINDOW) samples.shift();
    const first = samples[0];
    const span = first ? time - first.time : 0;
    const frames = first ? (stats?.frames ?? 0) - first.frames : 0;
    if (span >= WINDOW * 0.9) this.fps = (frames * 1000) / span;
    if (time - this.#shown < 250) return;
    this.#shown = time;
    this.#text.textContent = stats
      ? [
          `${stats.backend}`,
          `${frames ? `${this.fps.toFixed(1)} fps` : 'idle (no frames)'}`,
          `${formatCount(stats.drawCalls)} draw calls`,
          `${formatCount(stats.triangles)} triangles`,
          `${formatCount(stats.frames)} frames`,
        ].join('\n')
      : 'no frame yet';
    this.#root.dataset.fps = this.fps.toFixed(1);
  }
}
