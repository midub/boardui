# kicad-royalblue54l-feather

The RoyalBlue54L Feather, an nRF54L15 board by Lord's Boards, exported to IPC-2581 by KiCad.

| | |
|---|---|
| Design | RoyalBlue54L Feather by Lord's Boards (<https://www.crowdsupply.com/lords-boards/royalblue54l-feather>), as shipped with KiCad 9 in `demos/royalblue54L_feather` (<https://gitlab.com/kicad/code/kicad/-/tree/9.0/demos/royalblue54L_feather>) |
| Licence | CERN-OHL-P v2 (permissive), see [`LICENSE`](LICENSE) |
| Export | `kicad-cli pcb export ipc2581 -o royalblue54l-feather.xml --version C --units mm RoyalBlue54L-Feather.kicad_pcb` with KiCad 9.0.9 (Docker image `kicad/kicad:9.0`) |
| Modifications | none; the file is the unmodified export |

What it exercises:

- FABRICATION-style data from KiCad: an 8-layer stack-up with dielectric thicknesses, `F.Mask`/`B.Mask`, silkscreen text as filled outlines, padstacks, `UserSpecial` shapes and plated slots on a `ROUT` layer.
- Bottom-side components with `mirror="true"`. KiCad mirrors before rotating counter-clockwise, unlike the consortium test cases (spec §6.8).
- Visual reference: `kicad-cli pcb export glb --include-tracks --include-pads --include-zones --include-silkscreen --include-soldermask RoyalBlue54L-Feather.kicad_pcb`.

Known quirks of the source: 183 blind vias have a 10 nm drill (`drill 0.00001` in the board file), and KiCad lists one package `Pin` per pin number even where a footprint has several pads with that number.
