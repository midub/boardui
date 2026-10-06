# Samples

Each sample is an IPC-2581 input plus the expected boardui asset. Together they are the conformance and regression suite: CI converts every input, runs the Khronos validator and `boardui validate`, and compares the result with the expected output.

Expected outputs are added together with the converter. Until then this file lists the planned corpus.

## Planned corpus

| Sample | Source | Exercises |
|---|---|---|
| `minimal-2layer` | hand-written | one resistor, two pads, one trace, one via; the smallest conformant asset |
| `overlap-priority` | hand-written | pad over trace over plane; §6.2 priority and tie-breaking |
| `negative-polarity` | hand-written | plane with negative cut-outs; §6.2 |
| `slots` | hand-written | plated and non-plated slots; §6.3 |
| `bottom-placement` | hand-written + KiCad | rotated and mirrored bottom-side parts; §6.8 |
| `units-*` | hand-written | the same board in `INCH`, `MILLIMETER`, `MICRON`; §3 |
| `no-stackup` | IPC consortium test case 3 (already in the repo) | ASSEMBLY mode, no stack-up, no soldermask: default thicknesses and synthesized layers |
| `testcase1`, `testcase10` | IPC consortium test cases (already in the repo) | large ASSEMBLY-mode boards; performance baseline |
| `kicad-*` | KiCad 8+ boards exported with `kicad-cli pcb export ipc2581` | FABRICATION-mode data with stack-up, soldermask and inner layers. `kicad-cli pcb export glb` of the same board is the visual reference |

## Rules

- Only add boards whose licence allows redistribution, and record the source and licence next to each sample.
- The IPC consortium test cases are test data only. Don't ship them in published packages.
- Keep hand-written samples minimal: one spec rule per file.
