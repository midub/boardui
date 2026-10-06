# altium-ldo-pcb

A small LDO regulator board exported to IPC-2581 revision A, most likely by Altium Designer, from a Washington State University capstone project.

| | |
|---|---|
| Source | `warp_implementation/pcb_files/LDO-PCB.cvg` in <https://github.com/WSUCptSCapstone-S25-F25/-mda-unity3dapp-> at commit `b8d769ea8b1cec666667323adbcc417f7a9539d5` (Kyle Lim) |
| Licence | MIT ("Tin Whiskers Unity 3D App"), see [`LICENSE`](LICENSE) |
| Export | The file names no tool. Altium Designer, judging by the layer names (`Top Overlay`, `Top Solder`, `Top 3D Body`, `Drill Guide (Top Layer - Bottom Layer)`, `BoardShape_LDO-PCB`) and the `.cvg` extension |
| Modifications | none |

What it exercises:

- A revision A file in FULL mode. The reader reads it as revision C with a warning.
- Altium's layout: no `name` on `Stackup`, pads and holes as `PadStack` instances in the `Step` (revision A and B), the core dielectric as a `CONDUCTOR` layer with `materialType="FR-4"` in the stack-up, a `Drill Guide` drill layer and eleven `DOCUMENT` layers (assembly, courtyard, 3D body, component centre).
- The `.cvg` extension: the conformance test reads `.xml` and `.cvg` inputs.

Known gaps: the reader skips `PadStack`, so the board has no pads, and the dielectric is taken for a third copper layer, which makes the board 1.6 mm thick instead of 0.41 mm.
