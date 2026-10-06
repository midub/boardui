/**
 * The sample boards of the picker: the repository's `spec/samples`. The Vite config copies the
 * files listed in `SAMPLES` into the build (`samples/…`, next to the app) and serves them in dev,
 * so the demo needs no other host and the samples match its version.
 *
 * The IPC consortium test cases are test data only and not part of the demo
 * (`spec/samples/README.md`): `TEST_CASES` only links to them in the repository.
 */

/** The git tag that the test case links point at. */
export const TEST_CASES_REF = 'v1.0.0';

/** A sample board. Paths are relative to `spec/samples/`. */
export interface Sample {
  /** Stable ID, used in `?sample=<id>`. */
  id: string;
  name: string;
  group: 'Hand-written' | 'KiCad';
  description: string;
  xml: string;
  /** A model mapping and the model files it names. */
  models?: { mapping: string; files: string[] };
}

const handWritten = (id: string, description: string): Sample => ({
  id,
  name: id,
  group: 'Hand-written',
  description,
  xml: `hand-written/${id}/${id}.xml`,
});

export const SAMPLES: readonly Sample[] = [
  {
    id: 'royalblue54l-feather',
    name: 'RoyalBlue54L Feather',
    group: 'KiCad',
    description: 'nRF54L15 Feather by Lord’s Boards, 8 layers, from KiCad 9 (CERN-OHL-P)',
    xml: 'kicad-royalblue54l-feather/royalblue54l-feather.xml',
  },
  handWritten('minimal-2layer', 'One resistor, two pads, a trace and a via'),
  handWritten('bottom-placement', 'A package on the bottom side at 0°, 30°, 90° and 270°'),
  handWritten('slots', 'Plated and non-plated slots'),
  handWritten('overlap-priority', 'Pad over trace over plane'),
  handWritten('negative-polarity', 'A plane with negative cut-outs'),
  handWritten('zero-width-lines', 'Silkscreen lines of zero width, drawn as hairlines'),
  handWritten('units-inch', 'minimal-2layer in inches'),
  handWritten('units-micron', 'minimal-2layer in microns'),
  {
    ...handWritten('user-models', 'minimal-2layer with a glTF model for the resistor'),
    models: {
      mapping: 'hand-written/user-models/models.json',
      files: ['hand-written/user-models/r0603.gltf'],
    },
  },
];

/** Every file of every sample, relative to `spec/samples/`. */
export function sampleFiles(): string[] {
  return SAMPLES.flatMap((s) => [
    s.xml,
    ...(s.models ? [s.models.mapping, ...s.models.files] : []),
  ]);
}

/** An IPC consortium test case in `spec/samples/ipc-testcases/`, offered as a download link. */
export interface TestCase {
  id: string;
  name: string;
  description: string;
  /** File name in `spec/samples/ipc-testcases/`. */
  file: string;
}

export const TEST_CASES: readonly TestCase[] = [
  {
    id: 'testcase1',
    name: 'Test case 1',
    description: 'Large assembly: 36k features, 1,656 components',
    file: 'testcase1-RevC-Assembly.xml',
  },
  {
    id: 'testcase10',
    name: 'Test case 10',
    description: 'Dense assembly board',
    file: 'testcase10-RevC-Assembly.xml',
  },
  {
    id: 'testcase3',
    name: 'Test case 3',
    description: 'No stack-up or soldermask: default thicknesses, profile cut-outs',
    file: 'testcase3-RevC-Assembly.xml',
  },
];

/** A test case's path relative to `spec/samples/`. */
export const testCasePath = (t: TestCase): string => `ipc-testcases/${t.file}`;

/** Where a test case is downloaded from: the file in the repository at `TEST_CASES_REF`. */
export const testCaseUrl = (t: TestCase): string =>
  `https://github.com/midub/boardui/raw/${TEST_CASES_REF}/spec/samples/${testCasePath(t)}`;
