# kicad-miao

MIAO, a CH552T microcontroller board that is a drop-in replacement for the Seeed XIAO, exported to IPC-2581 by KiCad 9 in inches.

| | |
|---|---|
| Design | MIAO by kilipan, `hw_pcba/kicad_miao.kicad_pcb` in <https://github.com/kilipan/miao> at commit `f160e39106dd3a76f6e3ed1026746e7a5c4a3436` |
| Licence | CERN-OHL-S v2 (strongly reciprocal), see [`LICENSE`](LICENSE). The source of the design is the repository above. |
| Export | `kicad-cli pcb export ipc2581 --units in --precision 4 -o miao.xml miao.kicad_pcb` with KiCad 9.0.9 (Docker image `kicad/kicad:9.0`) |
| Modifications | none; the file is the unmodified export (the board file was only renamed) |

What it exercises:

- KiCad's `--units in` and `--precision 4` options: `INCH` units with four decimals.
- Castellated edge pads (half holes on the board edge), plated slots (`SlotCavity` on a `ROUT` layer) and a USB-C receptacle with slotted pins.
- Board colours from the KiCad stack-up (`EntryColor`).
- Visual reference: `kicad-cli pcb render --side top miao.kicad_pcb`.

Known quirk: the castellated pads belong to a footprint (`U3`, `xiao_drop-in_gpio_plus_4_castellated`) whose outline is the whole board. It gets no placeholder body, because the body would cover more than half of the board (spec §6.8).
