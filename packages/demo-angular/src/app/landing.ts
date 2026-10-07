import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  formatBytes,
  SAMPLE_GROUPS,
  SAMPLES,
  type Sample,
  sampleLabel,
  TEST_CASES,
  TEST_CASES_PAGE,
  testCasePath,
  testCaseUrl,
} from '@boardui/demo-shared';
import { SAMPLE_SIZES } from '@boardui/demo-shared/sizes';

const size = (path: string) => formatBytes(SAMPLE_SIZES[path] ?? 0);

/** The top bar's sample picker. */
@Component({
  selector: 'label[app-sample-picker]',
  host: { class: 'sample-picker' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="sr-only">Sample board</span>
    <select id="sample-select" aria-label="Sample board" (change)="pick($event)">
      <option value="">Samples…</option>
      @for (group of groups; track group.name) {
        <optgroup [label]="group.name">
          @for (sample of group.samples; track sample.id) {
            <option [value]="sample.id">{{ sample.label }}</option>
          }
        </optgroup>
      }
    </select>
  `,
})
export class SamplePicker {
  readonly open = output<Sample>();

  protected readonly groups = SAMPLE_GROUPS.map((name) => ({
    name,
    samples: SAMPLES.filter((s) => s.group === name).map((s) => ({
      id: s.id,
      label: sampleLabel(s, SAMPLE_SIZES),
    })),
  }));

  protected pick(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const sample = SAMPLES.find((s) => s.id === select.value);
    select.value = '';
    if (sample) this.open.emit(sample);
  }
}

/** A sample on the landing page: a card, or a chip for the hand-written ones. */
@Component({
  selector: 'button[app-sample-card]',
  host: {
    type: 'button',
    '[class]': "featured() ? 'sample-card' : 'sample-chip'",
    '[attr.data-sample]': 'sample().id',
    '[title]': 'sample().description',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="sample-group">{{ sample().group }}</span>
    <span class="sample-name">{{ sample().name }}</span>
    @if (featured()) {
      <span class="sample-desc">{{ sample().description }}</span>
    }
    <span class="sample-size">{{ size() }}</span>
  `,
})
export class SampleCard {
  readonly sample = input.required<Sample>();
  protected readonly featured = computed(() => this.sample().group !== 'Hand-written');
  protected readonly size = computed(() => size(this.sample().xml));
}

/** The empty state: drop zone, samples, and links to the IPC consortium test cases. */
@Component({
  selector: 'div[app-landing]',
  host: { id: 'empty', class: 'empty' },
  imports: [SampleCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hero">
      <img src="logo.svg" alt="" width="72" height="72" />
      <h1>Printed circuit boards in 3D</h1>
      <p class="lead">
        Drop an <strong>IPC-2581</strong> file to convert it to a glTF board and explore its
        components, pins and nets. Conversion runs locally in WebAssembly: nothing is uploaded.
      </p>
      <button id="drop-zone" class="drop-zone" type="button" (click)="pickFile.emit()">
        <span class="drop-title">Drop a file here, or click to choose one</span>
        <span class="drop-hint">IPC-2581 <code>.xml</code>, a boardui <code>.glb</code>, or a folder with a board, <code>models.json</code> and its glTF models</span>
      </button>
    </div>
    <div class="samples">
      <h2>Or try a sample</h2>
      <div id="sample-cards" class="sample-cards">
        @for (sample of featured; track sample.id) {
          <button app-sample-card [sample]="sample" (click)="open.emit(sample)"></button>
        }
      </div>
      <div id="sample-chips" class="sample-cards sample-chips">
        @for (sample of handWritten; track sample.id) {
          <button app-sample-card [sample]="sample" (click)="open.emit(sample)"></button>
        }
      </div>
    </div>
    <!-- The IPC consortium test cases aren't part of the demo: links to the consortium's
         archives; the user downloads one and drops the named file from it here. -->
    <div class="samples">
      <h2>IPC consortium test data</h2>
      <p class="samples-hint">
        Download an archive from the <a [href]="testCasesPage">IPC-2581 Consortium</a>, then drop
        the file named on its card here.
      </p>
      <div id="test-case-links" class="sample-cards">
        @for (testCase of testCases; track testCase.id) {
          <a
            class="sample-card"
            [href]="testCase.url"
            target="_blank"
            rel="noopener"
            [title]="'Download the archive with ' + testCase.file + ' from the IPC-2581 Consortium'"
            [attr.data-test-case]="testCase.id"
          >
            <span class="sample-group">IPC consortium</span>
            <span class="sample-name">{{ testCase.name }}</span>
            <span class="sample-desc">
              {{ testCase.description }}
              <br />
              Open <code>{{ testCase.file }}</code> ({{ testCase.size }})
            </span>
            <span class="sample-size">ZIP ↓</span>
          </a>
        }
      </div>
    </div>
    <p class="footnote">
      boardui is open source (MIT):
      <a href="https://github.com/midub/boardui">converter, viewer and profile spec</a>.
    </p>
  `,
})
export class Landing {
  readonly pickFile = output<void>();
  readonly open = output<Sample>();

  protected readonly featured = SAMPLES.filter((s) => s.group !== 'Hand-written');
  protected readonly handWritten = SAMPLES.filter((s) => s.group === 'Hand-written');
  protected readonly testCasesPage = TEST_CASES_PAGE;
  protected readonly testCases = TEST_CASES.map((testCase) => ({
    ...testCase,
    url: testCaseUrl(testCase),
    size: size(testCasePath(testCase)),
  }));
}
