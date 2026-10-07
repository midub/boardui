/**
 * The `?stats` overlay's numbers: renderer backend, frame rate, draw calls and triangles of the
 * last frame. The viewer renders on demand, so the frame rate is only meaningful while the view
 * moves: orbit the board, or tick "spin" (`?spin`) to render continuously.
 */
import type { RenderStats } from '@boardui/viewer';
import { formatCount } from './format.js';

/** Frame-rate samples over this window, in milliseconds. */
const WINDOW = 1000;
/** The text is updated at most this often, in milliseconds. */
const REFRESH = 250;

/** Measures the frame rate from `viewer.stats()`, sampled once per animation frame. */
export class StatsMeter {
  readonly #samples: { time: number; frames: number }[] = [];
  #shown = Number.NEGATIVE_INFINITY;
  /** Frame rate of the last full window while frames were rendered, for tests and the console. */
  fps = 0;

  /**
   * Records the statistics at `time` (`requestAnimationFrame`'s timestamp). Returns the overlay's
   * text when it is due for an update, else `null`.
   */
  update(time: number, stats: RenderStats | null): string | null {
    const samples = this.#samples;
    samples.push({ time, frames: stats?.frames ?? 0 });
    while (samples.length > 2 && time - (samples[1]?.time ?? time) >= WINDOW) samples.shift();
    const first = samples[0];
    const span = first ? time - first.time : 0;
    const frames = first ? (stats?.frames ?? 0) - first.frames : 0;
    if (span >= WINDOW * 0.9) this.fps = (frames * 1000) / span;
    if (time - this.#shown < REFRESH) return null;
    this.#shown = time;
    return stats
      ? [
          `${stats.backend}`,
          `${frames ? `${this.fps.toFixed(1)} fps` : 'idle (no frames)'}`,
          `${formatCount(stats.drawCalls)} draw calls`,
          `${formatCount(stats.triangles)} triangles`,
          `${formatCount(stats.frames)} frames`,
        ].join('\n')
      : 'no frame yet';
  }
}
