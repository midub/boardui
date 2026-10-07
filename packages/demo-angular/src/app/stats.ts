import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  model,
  signal,
} from '@angular/core';
import { StatsMeter } from '@boardui/demo-shared';
import { session } from './session';

/** The `?stats` overlay: backend, frame rate, draw calls, triangles; and the spin toggle. */
@Component({
  selector: 'div[app-stats]',
  host: { id: 'stats', class: 'stats', '[attr.data-fps]': 'fps()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pre class="stats-text">{{ text() }}</pre>
    <label class="toggle">
      <input type="checkbox" id="spin-toggle" [checked]="spin()" (change)="onSpin($event)" />
      <span>spin</span>
    </label>
  `,
})
export class Stats {
  readonly spin = model.required<boolean>();
  protected readonly text = signal('');
  protected readonly fps = signal('0.0');

  constructor() {
    const meter = new StatsMeter();
    Object.assign(globalThis, { stats: meter });
    let frame = 0;
    const tick = (time: number) => {
      const next = meter.update(time, session.viewer?.stats() ?? null);
      if (next !== null) {
        this.text.set(next);
        this.fps.set(meter.fps.toFixed(1));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(frame));
  }

  protected onSpin(event: Event): void {
    this.spin.set((event.target as HTMLInputElement).checked);
  }
}
