/**
 * The sample boards of the picker: the repository's `spec/samples`. The Vite config copies the
 * files listed here into the build (`samples/…`, next to the app) and serves them in dev, so the
 * demo needs no other host and the samples match its version.
 */

/** A sample board. Paths are relative to `spec/samples/`. */
export interface Sample {
  /** Stable ID, used in `?sample=<id>`. */
  id: string;
  name: string;
  group: 'Hand-written' | 'KiCad' | 'IPC consortium';
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
  {
    id: 'testcase1',
    name: 'Test case 1',
    group: 'IPC consortium',
    description: 'Large assembly: 36k features, 1,656 components',
    xml: 'ipc-testcases/testcase1-RevC-Assembly.xml',
  },
  {
    id: 'testcase10',
    name: 'Test case 10',
    group: 'IPC consortium',
    description: 'Dense assembly board',
    xml: 'ipc-testcases/testcase10-RevC-Assembly.xml',
  },
  {
    id: 'testcase3',
    name: 'Test case 3',
    group: 'IPC consortium',
    description: 'No stack-up or soldermask: default thicknesses, profile cut-outs',
    xml: 'ipc-testcases/testcase3-RevC-Assembly.xml',
  },
  handWritten('minimal-2layer', 'One resistor, two pads, a trace and a via'),
  handWritten('bottom-placement', 'A package on the bottom side at 0°, 30°, 90° and 270°'),
  handWritten('slots', 'Plated and non-plated slots'),
  handWritten('overlap-priority', 'Pad over trace over plane'),
  handWritten('negative-polarity', 'A plane with negative cut-outs'),
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
