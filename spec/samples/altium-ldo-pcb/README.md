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

The `PadStack` pads, via lands and holes are converted like a revision C file's (spec §6.3): 17 pads with their pins, all on their pads, and 5 vias. The 5 via holes are also on the `Drill Guide` layer; they are drilled once, from that layer, with the padstacks' net. The dielectric is a dielectric (spec §6.4), so the board is 0.39 mm from copper to copper (0.41 mm over the soldermask, as the stack-up says).

The via holes are as wide as the via lands (0.7112 mm, 28 mil), in the `PadStack`s and on the `Drill Guide` layer alike, so the lands are drilled away and only the barrels show. The file says so; the converter doesn't second-guess it.
