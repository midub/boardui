# Samples

Each sample is an IPC-2581 input plus the expected boardui asset. Together they are the conformance and regression suite: CI converts every input, runs the Khronos validator and `boardui validate`, and compares the result with the expected output.

## Corpus

The IPC consortium test cases (`ipc-testcases/`) aren't in the repository: the consortium publishes no licence for them, so the repository links to them, and `python3 spec/samples/ipc-testcases/fetch.py` fetches them from the consortium ([`ipc-testcases/README.md`](ipc-testcases/README.md)). Without them, their tests are skipped.

| Sample | Source | Exercises |
|---|---|---|
| [`minimal-2layer`](hand-written/minimal-2layer/) | hand-written | one resistor, two pads, one trace, one via; the smallest conformant asset |
| [`overlap-priority`](hand-written/overlap-priority/) | hand-written | pad over trace over plane, and ties in document order; §6.2 |
| [`negative-polarity`](hand-written/negative-polarity/) | hand-written | plane with negative cut-outs, and a later trace they don't cut; §6.2 |
| [`zero-width-lines`](hand-written/zero-width-lines/) | hand-written | a silkscreen polyline and line with zero-width `LineDesc`s, drawn as hairlines; §6.1 |
| [`fiducials`](hand-written/fiducials/) | hand-written | `GlobalFiducial`, `LocalFiducial`, `BadBoardMark` and `GoodPanelMark` as `FIDUCIAL` copper features with their type, opening the synthesized soldermask; §6.2, §6.5, §8.2 |
| [`hexagon-moire`](hand-written/hexagon-moire/) | hand-written | `Hexagon` (corner up, plain, rotated and hollow) and a `Moire` with a crosshair; §6.1 |
| [`primitive-xform`](hand-written/primitive-xform/) | hand-written | standard primitives with their own `Xform` (rev B, written by Allegro 17.4 into rev C files): rectangles and ovals turned upright in pads that carry their part's rotation (0°, 90°, 30°), a mirrored chamfered rectangle and an offset oval, each in a pad at 0° and 90°; §6.1 |
| [`polygon-xform`](hand-written/polygon-xform/) | hand-written | polygons and cutouts with their own `Xform` (rev B and C): an arrow contour turned 90°, mirrored or moved by its polygon's `Xform`, each in a pad at 0° and 90°; a fill turned upright by its polygon's `Xform`, with a mirrored and moved cutout; a profile moved onto the board by its polygon's `Xform`, with a slot turned upright by its cutout's; §6.1 |
| [`hatch-fill`](hand-written/hatch-fill/) | hand-written | a `HATCH` polygon with its outline, and a `MESH` circle; §6.1 |
| [`line-styles`](hand-written/line-styles/) | hand-written | `SOLID`, `DOTTED`, `DASHED`, `CENTER` and `PHANTOM` lines, a dashed arc, a dotted outline, and an `ERASE` line cutting a plane; §6.1 |
| [`slots`](hand-written/slots/) | hand-written | a plated slot with pads and a non-plated slot; §6.3 |
| [`pad-stacks`](hand-written/pad-stacks/) | hand-written | `minimal-2layer` as revision B `PadStack`s, plus a mounting hole: pads with their pins, via lands, holes on a synthesized `@drill-TOP-BOTTOM`; §6.3 |
| [`pad-stacks-drill-layer`](hand-written/pad-stacks-drill-layer/) | hand-written | revision A `PadStack` holes and an Altium-style `Drill Guide` layer: a hole on both is drilled once and takes the padstack's net, a hole only in a `PadStack` is added to the drill layer; §6.3 |
| [`conductor-core`](hand-written/conductor-core/) | hand-written | Altium's core: a `CONDUCTOR` layer with `side="NONE"` and `materialType="FR-4"` (revision A) is a dielectric; §6.4 |
| [`bottom-placement`](hand-written/bottom-placement/) | hand-written | an asymmetric package on the bottom side at 0°, 30°, 90° and 270°, and one on top; §6.8 |
| [`paste-layer`](hand-written/paste-layer/) | hand-written | paste on both sides, one thickness from the stack-up and one by default, standing on the copper through mask and silkscreen; a pasted through-hole land cut by its hole; §6.11 |
| [`drawing-layers`](hand-written/drawing-layers/) | hand-written | courtyard, assembly and documentation layers stacked outside the board, an empty documentation layer and a glue layer left out, and a package assembly drawing not repeated because the assembly layer has content; §6.12, §6.13 |
| [`assembly-drawing`](hand-written/assembly-drawing/) | hand-written | `@assembly-top` and `@assembly-bottom` from package assembly drawings: an outline without `FillDesc` drawn as a hairline, a marking with its own `Location`, rotated and mirrored parts; §6.13 |
| [`package-silkscreen`](hand-written/package-silkscreen/) | hand-written | package silkscreens drawn only where the silkscreen layer has nothing for the part (by reference or by area), and `@silkscreen-bottom` for a bottom side without a silkscreen layer; §6.13 |
| [`colours`](hand-written/colours/) | hand-written | soldermask and silkscreen colours from a `ColorRef`, a `ColorTerm` and KiCad-style names, a KiCad 9 `SpecRef`, and colours that are ignored (copper, `Set/ColorRef`); §6.10 |
| [`panel`](hand-written/panel/) | hand-written | a panel: a strip of two boards repeated twice (nested `StepRepeat`s, `nx`/`ny` arrays), a board rotated by 90°, a flipped one (`mirror`), rails with fiducials and tooling holes, and a board listed first in `Content`; instance IDs, per-instance nets, layers swapped for the flipped board; §6.14 |
| [`text`](hand-written/text/) | hand-written | `Text` in an embedded font (lines, arcs, a four-digit `charCode`) with one character from the bundled font, in an external font, with Latin-1 and an unknown character (a box), rotated, mirrored and too wide for its box; copper text cut by a hole and knocked out of a plane; the `text` property; §6.1, §8.2 |
| [`outline-cutouts`](hand-written/outline-cutouts/) | hand-written | a profile without `Cutout` whose inner contours are only on `Edge.Cuts` (`BOARD_OUTLINE`), as KiCad writes them: a keyhole of lines and arcs out of order, reversed and with gaps, a full-circle arc and a closed `Polyline` are cut out; the profile itself, an open contour and a square across the edge are not; §6.7 |
| [`pinless-package`](hand-written/pinless-package/) | hand-written | no placeholder body without pads and a height: a logo package without pins (`pinOne="UNKNOWN"`, not reported) and a mounting hole whose pin has no pad; the same logo with a `height`, and a resistor, get bodies; §6.8 |
| [`board-sized-package`](hand-written/board-sized-package/) | hand-written | a module footprint covering the whole board gets no placeholder body; a smaller module and a resistor do; §6.8 |
| [`units-inch`](hand-written/units-inch/), [`units-micron`](hand-written/units-micron/) | hand-written | `minimal-2layer` in `INCH` and `MICRON`; the test checks that all three give the same geometry; §3 |
| [`user-models`](hand-written/user-models/) | hand-written | `minimal-2layer` with `models.json` mapping the resistor's package to a glTF box; §6.9 |
| [`testcase3-RevC-Assembly`](ipc-testcases/) | IPC consortium test case 3 | ASSEMBLY mode, no stack-up, no soldermask: default thicknesses and synthesized layers; profile cutouts |
| [`testcase1-RevC-Assembly`](ipc-testcases/), [`testcase10-RevC-Assembly`](ipc-testcases/) | IPC consortium test cases 1 and 10 | large ASSEMBLY-mode boards (testcase1: 36k features, 1,656 components); performance baseline |
| [`royalblue54l-feather`](kicad-royalblue54l-feather/) | KiCad 9 demo, exported with `kicad-cli pcb export ipc2581` (CERN-OHL-P, see its README) | 8-layer stack-up, soldermask and silkscreen layers, padstacks, plated slots, KiCad's mirror order on the bottom side |
| [`testcase11-rdgflx-RevC-full`](ipc-testcases/) | IPC consortium test case 11 | rigid-flex: six stack-ups, stack-up zones and bend areas, coverlay and stiffener layers, a buried drill span, `Xform`s inside standard primitives |
| [`IPC-2581-8-Layer-Design`](ipc-testcases/) | IPC consortium stack-up sample, Polar Speedstack | a stack-up and nothing else; revision B; `Stackup` without `name` |
| [`fomu-pvt`](kicad-fomu-pvt/) | Fomu PVT, a KiCad 5 board exported by KiCad 9 (CC BY-SA 4.0) | blind, buried and micro vias only; a KiCad 5 board's bottom-side rotations; an internal cut-out on `Edge.Cuts` |
| [`miao`](kicad-miao/) | MIAO, KiCad 9 export in inches (CERN-OHL-S) | `--units in --precision 4`; castellated pads; plated slots; a board-sized footprint |
| [`blind-buried-vias`](kicad-blind-buried-vias/) | `fcad_pcb` test board, KiCad 9 revision B export (MIT) | `--version B`; 24 copper layers; blind and buried drill spans |
| [`egg-ldo-panel`](kicad-kikit-panel/) | Egg LDO 250 panelized by KiKit, KiCad 9 export (BSD-3-Clause) | a 2 × 2 panel flattened into one step: rails, tabs, mouse bites, fiducials and tooling holes as components |
| [`antenna`](kicad10-antenna/) | Diode `pcb` test fixture, KiCad 10 export (MIT) | KiCad 10's output |
| [`LDO-PCB`](altium-ldo-pcb/) | capstone project, Altium Designer revision A export (MIT) | revision A, `.cvg`; Altium's `Step/PadStack` pads and holes next to a `Drill Guide` layer, and its dielectric written as `CONDUCTOR`; §6.3, §6.4 |

### Coverage of exporters and features

| Exporter | Samples | Revision, mode, units | Board types and features |
|---|---|---|---|
| Cadence Allegro 17.4 | `testcase1`, `testcase3`, `testcase10`, `testcase11` | C; ASSEMBLY and full (USERDEF); inch | 12-layer network card, round card, demo board, rigid-flex with buried vias |
| Polar Speedstack 14.2 | `IPC-2581-8-Layer-Design` | B; USERDEF; inch | stack-up only |
| Altium Designer (inferred) | `LDO-PCB` | A; FULL; mm | 2 layers, `PadStack` instances, `.cvg` |
| KiCad 9 | `royalblue54l-feather`, `fomu-pvt`, `miao`, `blind-buried-vias`, `egg-ldo-panel` | C and B; ASSEMBLY; mm and inch | 2 to 24 layers, blind, buried and micro vias, castellations, slots, a KiKit panel, a KiCad 5 board |
| KiCad 10 | `antenna` | C; ASSEMBLY; mm | 2 layers, one component |

Revision A files from Zuken CR5000 (IPC consortium test cases 4, 7 and 8) wrap layers and steps in `LayerDesc` and `StepList`; the reader does not support them, so they are not in the corpus.

The hand-written samples are generated by [`hand-written/generate.py`](hand-written/generate.py) (standard library only); edit the script, not the XML.

## Expected outputs

- [`expected/<sample>.snap`](expected/): a readable summary of each converted sample: stack-up with Z ranges, feature counts and kinds per layer, vertex and triangle counts, top-face areas, components with their transforms, and the converter's warnings. The hand-written samples list every feature with its area.
- `hand-written/<sample>/<sample>.glb`: the expected asset of each hand-written sample. The test compares its glTF JSON with the converter's output.

The conformance test is `crates/boardui-convert/tests/conformance.rs`:

```sh
cargo test -p boardui-convert --test conformance                  # check
INSTA_UPDATE=always BOARDUI_BLESS=1 cargo test -p boardui-convert --test conformance   # rewrite the expected outputs
BOARDUI_CONFORMANCE_OUT=target/conformance cargo test -p boardui-convert --test conformance
node scripts/khronos-validate.mjs <dir with gltf-validator installed> target/conformance/*.glb
```

The Khronos step fails on any error or warning except `UNRESERVED_EXTENSION_PREFIX`: the `BOARDUI` prefix is not registered with Khronos.

## Rules

- Only add boards whose licence allows redistribution, and record the source and licence next to each sample.
- The IPC consortium test cases are test data only, and the repository doesn't host them: don't commit them (git ignores `ipc-testcases/*.xml`), and don't ship them in published packages, release archives or the demos. [`ipc-testcases/sources.json`](ipc-testcases/sources.json) lists where the consortium publishes each one and its SHA-256; the demos link to the consortium's archives, and their builds fail if the output contains a test case (`packages/demo-shared/src/build/check-dist.ts`).
- Keep hand-written samples minimal: one spec rule per file.
