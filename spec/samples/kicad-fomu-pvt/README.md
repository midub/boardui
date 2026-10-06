# kicad-fomu-pvt

Fomu PVT, an FPGA board that fits inside a USB port, from the Tomu project, exported to IPC-2581 by KiCad 9.

| | |
|---|---|
| Design | Fomu PVT by the Tomu project (Sean "xobs" Cross, Tim "mithro" Ansell and contributors), `archive/pvt/pcb/tomu-fpga.kicad_pcb` in <https://github.com/im-tomu/fomu-hardware> at commit `7b57a14f73b40986b103707ceec03d3795a4f6ba` |
| Licence | dual-licensed by the authors under CC BY-SA 4.0 or the TAPR Open Hardware License; this sample uses CC BY-SA 4.0, see [`LICENSE`](LICENSE) |
| Export | `kicad-cli pcb export ipc2581 -o fomu-pvt.xml fomu-pvt.kicad_pcb` (defaults: `--version C --units mm --precision 6`) with KiCad 9.0.9 (Docker image `kicad/kicad:9.0`) |
| Modifications | none; the file is the unmodified export (the board file was only renamed) |

What it exercises:

- A KiCad 5 board (file format `20171130`) read by KiCad 9: 4 copper layers, 0.58 mm thick, with only blind and buried vias (`F.Cu`–`In1.Cu`, `In1.Cu`–`In2.Cu`, `In2.Cu`–`B.Cu`) and micro-vias, and no through drills.
- Components on both sides, an internal board cut-out (the keyhole), and footprints without pads (`nothing`, `soldermask-removal`).
- Visual reference: `kicad-cli pcb render --side top fomu-pvt.kicad_pcb`.

Known quirks of the export, recorded as findings in the pull request that added it:

- The 29 bottom-side footprints at 0° or 180° (of 50) get a rotation that is 180° off. For the 17 that aren't symmetric, the pins land on other pads under KiCad's mirror order: 74 of 144 checked pins. The pads themselves are correct. The conformance test expects these 74 pins.
- KiCad writes the keyhole cut-out only as lines and arcs on `Edge.Cuts`, not as a `Cutout` of the `Profile`.
- The pad-less footprints have `pinOne="UNKNOWN"`, which the reader reports as a reference to an unknown pin; `XX2` sits outside the board.
