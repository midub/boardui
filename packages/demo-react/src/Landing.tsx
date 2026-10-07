import {
  formatBytes,
  SAMPLE_GROUPS,
  SAMPLES,
  type Sample,
  sampleLabel,
  TEST_CASES,
  testCasePath,
  testCaseUrl,
} from '@boardui/demo-shared';
import { SAMPLE_SIZES } from '@boardui/demo-shared/sizes';
import type { ReactNode } from 'react';

const logo = `${import.meta.env.BASE_URL}logo.svg`;
const size = (path: string) => formatBytes(SAMPLE_SIZES[path] ?? 0);

/** The top bar's sample picker. */
export function SamplePicker({ onOpen }: { onOpen: (sample: Sample) => void }): ReactNode {
  return (
    <label className="sample-picker">
      <span className="sr-only">Sample board</span>
      <select
        id="sample-select"
        aria-label="Sample board"
        value=""
        onChange={(e) => {
          const sample = SAMPLES.find((s) => s.id === e.target.value);
          if (sample) onOpen(sample);
        }}
      >
        <option value="">Samples…</option>
        {SAMPLE_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {SAMPLES.filter((s) => s.group === group).map((s) => (
              <option key={s.id} value={s.id}>
                {sampleLabel(s, SAMPLE_SIZES)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function SampleCard({ sample, onOpen }: { sample: Sample; onOpen: () => void }): ReactNode {
  const featured = sample.group !== 'Hand-written';
  return (
    <button
      type="button"
      className={featured ? 'sample-card' : 'sample-chip'}
      data-sample={sample.id}
      title={sample.description}
      onClick={onOpen}
    >
      <span className="sample-group">{sample.group}</span>
      <span className="sample-name">{sample.name}</span>
      {featured && <span className="sample-desc">{sample.description}</span>}
      <span className="sample-size">{size(sample.xml)}</span>
    </button>
  );
}

/** The empty state: drop zone, samples, and links to the IPC consortium test cases. */
export function Landing({
  hidden,
  onPick,
  onOpen,
}: {
  hidden: boolean;
  onPick: () => void;
  onOpen: (sample: Sample) => void;
}): ReactNode {
  const card = (sample: Sample) => (
    <SampleCard key={sample.id} sample={sample} onOpen={() => onOpen(sample)} />
  );
  return (
    <div id="empty" className="empty" hidden={hidden}>
      <div className="hero">
        <img src={logo} alt="" width="72" height="72" />
        <h1>Printed circuit boards in 3D</h1>
        <p className="lead">
          Drop an <strong>IPC-2581</strong> file to convert it to a glTF board and explore its
          components, pins and nets. Conversion runs locally in WebAssembly: nothing is uploaded.
        </p>
        <button id="drop-zone" className="drop-zone" type="button" onClick={onPick}>
          <span className="drop-title">Drop a file here, or click to choose one</span>
          <span className="drop-hint">
            IPC-2581 <code>.xml</code>, a boardui <code>.glb</code>, or a folder with a board,{' '}
            <code>models.json</code> and its glTF models
          </span>
        </button>
      </div>
      <div className="samples">
        <h2>Or try a sample</h2>
        <div id="sample-cards" className="sample-cards">
          {SAMPLES.filter((s) => s.group !== 'Hand-written').map(card)}
        </div>
        <div id="sample-chips" className="sample-cards sample-chips">
          {SAMPLES.filter((s) => s.group === 'Hand-written').map(card)}
        </div>
      </div>
      {/* The IPC consortium test cases aren't part of the demo: links to the files in the
          repository, which the user downloads and then drops here. */}
      <div className="samples">
        <h2>IPC consortium test data</h2>
        <p className="samples-hint">Download a file, then drop it here.</p>
        <div id="test-case-links" className="sample-cards">
          {TEST_CASES.map((testCase) => (
            <a
              key={testCase.id}
              className="sample-card"
              href={testCaseUrl(testCase)}
              download={testCase.file}
              target="_blank"
              rel="noopener"
              title={`Download ${testCase.file}`}
              data-test-case={testCase.id}
            >
              <span className="sample-group">IPC consortium</span>
              <span className="sample-name">{testCase.name}</span>
              <span className="sample-desc">{testCase.description}</span>
              <span className="sample-size">{`${size(testCasePath(testCase))} ↓`}</span>
            </a>
          ))}
        </div>
      </div>
      <p className="footnote">
        boardui is open source (MIT):{' '}
        <a href="https://github.com/midub/boardui">converter, viewer and profile spec</a>.
      </p>
    </div>
  );
}
