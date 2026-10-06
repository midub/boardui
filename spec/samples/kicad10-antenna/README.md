# kicad10-antenna

A small antenna test board exported to IPC-2581 by KiCad 10, from the test fixtures of Diode's `pcb` tool.

| | |
|---|---|
| Source | `crates/pcb-ipc2581-tools/src/commands/dfm/fixtures/antenna.xml` in <https://github.com/diodeinc/pcb> at commit `bc66fd419a20c5c1f8759e567b055f0023f2f63c` |
| Licence | MIT (Diode Inc.), see [`LICENSE`](LICENSE) |
| Export | KiCad 10.0.6 (`SoftwarePackage` in the file); options unknown |
| Modifications | none |

What it exercises:

- The output of KiCad 10, the next major version after the KiCad 9 exporter of the other KiCad samples. Unlike those, it lists `BomRef` and `AvlRef` in `Content`; the reader skips both with a warning.
- A two-layer board with one component, one through drill and an `Edge.Cuts` outline.
