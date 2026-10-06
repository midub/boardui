# kicad-kikit-panel

A 2 × 2 panel of the Egg LDO 250, a USB-C module with a 250 mA LDO, made with KiKit and exported to IPC-2581 by KiCad 9.

| | |
|---|---|
| Design | Egg LDO 250 by Simon Lukas (Plaenkler), `Egg_LDO_250.kicad_pcb` in <https://github.com/Plaenkler/Egg_LDO_250> at commit `5992328e00855d067723cf9575d79c5b338c23b1` |
| Licence | BSD 3-Clause, see [`LICENSE`](LICENSE) |
| Panel | KiKit 1.8.1: `kikit panelize --layout "grid; rows: 2; cols: 2; space: 2mm" --tabs "fixed; width: 3mm" --cuts "mousebites; drill: 0.5mm; spacing: 1mm; offset: 0.2mm" --framing "railstb; width: 5mm; space: 3mm" --fiducials "3fid; hoffset: 5mm; voffset: 2.5mm" --tooling "3hole; hoffset: 2.5mm; voffset: 2.5mm" --text "simple; text: boardui panel; anchor: mt; voffset: 2.5mm" egg250.kicad_pcb egg250-panel.kicad_pcb` |
| Export | `kicad-cli pcb export ipc2581 -o egg-ldo-panel.xml egg250-panel.kicad_pcb` with KiCad 9.0.9 (Docker image `kicad/kicad:9.0`) |
| Modifications | none; the file is the unmodified export |

What it exercises:

- A panel as KiCad sees it: one `Step` (`type="BOARD"`) holding four copies of the board with renumbered references, rails, tabs and mouse bites. There is no `StepRepeat`.
- Fiducials and tooling holes as ordinary components (six `KiKit_FID_*` with package `Fiducial`, three `KiKit_TO_*`), and the mouse-bite holes as 48 non-plated footprints (`KiKit_MB_*`).
- Castellated pads on the module edges and panel text drawn as silkscreen outlines.
- Visual reference: `kicad-cli pcb render --side top egg250-panel.kicad_pcb`.
