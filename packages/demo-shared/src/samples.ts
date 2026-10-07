/**
 * The sample boards of the picker: the repository's `spec/samples`. The demo builds copy the
 * files listed in `SAMPLES` into the build (`samples/…`, next to the app; `src/build/samples.ts`)
 * and serve them in dev, so the demos need no other host and the samples match their version.
 *
 * The IPC consortium test cases are test data only, and the repository doesn't host them
 * (`spec/samples/README.md`): `TEST_CASES` links to the consortium's archives.
 */

import { formatBytes } from './format.js';

/** The IPC-2581 Consortium's page with the RevC test cases. */
export const TEST_CASES_PAGE = 'https://www.ipc2581.com/ipc-2581-revc-test-cases/';

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
  handWritten('panel', 'A panel: boards repeated, nested, rotated and flipped by StepRepeat'),
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

/**
 * An IPC consortium test case, offered as a link to the consortium's archive that contains it
 * (`spec/samples/ipc-testcases/sources.json`).
 */
export interface TestCase {
  id: string;
  name: string;
  description: string;
  /** File name in the archive, and in `spec/samples/ipc-testcases/` once fetched. */
  file: string;
  /** The consortium's ZIP archive with the file. */
  archive: string;
}

export const TEST_CASES: readonly TestCase[] = [
  {
    id: 'testcase1',
    name: 'Test case 1',
    description: 'Large assembly: 36k features, 1,656 components',
    file: 'testcase1-RevC-Assembly.xml',
    archive: 'https://www.ipc2581.com/wp-content/uploads/2021/03/Testcase1-RevC-March2021.zip',
  },
  {
    id: 'testcase10',
    name: 'Test case 10',
    description: 'Dense assembly board',
    file: 'testcase10-RevC-Assembly.xml',
    archive: 'https://www.ipc2581.com/wp-content/uploads/2021/08/CDNS_testcase10-Rev-C-data.zip',
  },
  {
    id: 'testcase3',
    name: 'Test case 3',
    description: 'No stack-up or soldermask: default thicknesses, profile cut-outs',
    file: 'testcase3-RevC-Assembly.xml',
    archive: 'https://www.ipc2581.com/wp-content/uploads/2021/03/Testcase3_RevC-March2021.zip',
  },
];

/** A test case's path relative to `spec/samples/`. */
export const testCasePath = (t: TestCase): string => `ipc-testcases/${t.file}`;

/** Where a test case is downloaded from: the consortium's archive with the file. */
export const testCaseUrl = (t: TestCase): string => t.archive;

/** A sample's label in the picker: name and size. */
export function sampleLabel(sample: Sample, sizes: Readonly<Record<string, number>>): string {
  return `${sample.name} (${formatBytes(sizes[sample.xml] ?? 0)})`;
}

/** The picker's groups, in order. */
export const SAMPLE_GROUPS = ['KiCad', 'Hand-written'] as const;
