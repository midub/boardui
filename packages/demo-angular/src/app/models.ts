import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import {
  modelAttributions,
  modelProblems,
  modelSummary,
  STEP_LICENSES,
} from '@boardui/demo-shared';
import { models } from './session';

/** The 3D models panel: the toggle, how loading went, and the credits. */
@Component({
  selector: 'section[app-models]',
  host: { class: 'panel models' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3>3D models</h3>
    <label class="toggle">
      <input type="checkbox" id="models-toggle" [checked]="state().shown" (change)="toggle($event)" />
      <span id="models-status">{{ summary() }}</span>
    </label>
    @if (problems()) {
      <p class="muted models-problems" id="models-problems">{{ problems() }}</p>
    }
    <p class="muted models-credits" id="models-credits">
      @for (a of attributions(); track a.text) {
        <span>
          @if (a.url) {<a [href]="a.url">{{ a.text }}</a>} @else {{{ a.text }}}{{ a.license ? ' (' + a.license + ')' : '' }}.
        </span>
      }
      Fetched by footprint name; STEP read with
      @for (l of licenses; track l.href; let i = $index) {<span>{{ i ? ' / ' : '' }}<a [href]="l.href">{{ l.text }}</a></span>}
      (LGPL-2.1).
    </p>
  `,
})
export class Models {
  protected readonly state = signal(models.getState());
  protected readonly summary = computed(() => modelSummary(this.state().status));
  protected readonly problems = computed(() => modelProblems(this.state().status));
  protected readonly attributions = computed(() =>
    modelAttributions(models.sources, this.state().status),
  );
  protected readonly licenses = STEP_LICENSES;

  constructor() {
    const unsubscribe = models.subscribe(() => this.state.set(models.getState()));
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  protected toggle(event: Event): void {
    models.setShown((event.target as HTMLInputElement).checked);
  }
}
