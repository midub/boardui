# kicad-blind-buried-vias

A 24-layer test board with blind and buried vias from the FreeCAD PCB importer `fcad_pcb`, exported to IPC-2581 revision B by KiCad 9.

| | |
|---|---|
| Design | `tests/blind_buried_vias.kicad_pcb` by Zheng, Lei (realthunder) in <https://github.com/realthunder/fcad_pcb> at commit `8cac8e0e761508f37a443b4b1c2945166161dd45` |
| Licence | MIT, see [`LICENSE`](LICENSE) |
| Export | `kicad-cli pcb export ipc2581 --version B -o blind-buried-vias.xml rt-bbv.kicad_pcb` with KiCad 9.0.9 (Docker image `kicad/kicad:9.0`) |
| Modifications | none; the file is the unmodified export (the board file was only renamed) |

What it exercises:

- KiCad's revision B export (`--version B`).
- 24 copper layers (2.42 mm) and four drill spans: through, blind `F.Cu`–`In1.Cu`, buried `In1.Cu`–`In22.Cu` and blind `In22.Cu`–`B.Cu`.
- Visual reference: `kicad-cli pcb render --side top rt-bbv.kicad_pcb`.
