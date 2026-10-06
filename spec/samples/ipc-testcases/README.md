# ipc-testcases

Test data published by the IPC-2581 Consortium on <https://www.ipc2581.com> ("IPC-2581 Test Cases"). The consortium publishes no licence for them, so they are test data only: don't ship them in published packages, release archives or the demo (`../README.md`, "Rules").

| File | Consortium download | Exporter (`HistoryRecord`/`SoftwarePackage`) | Board |
|---|---|---|---|
| `testcase1-RevC-Assembly.xml` | RevC test case 1 | Cadence Allegro 17.4 S015 | network card, ASSEMBLY mode |
| `testcase3-RevC-Assembly.xml` | RevC test case 3 | Cadence Allegro 17.4 | round test card, ASSEMBLY mode |
| `testcase10-RevC-Assembly.xml` | RevC test case 10 | Cadence Allegro 17.4 S019 | demo board, ASSEMBLY mode |
| `testcase11-rdgflx-RevC-full.xml` | RevC test case 11, [`CDNS_testcase11-RevC.zip`](http://www.ipc2581.com/wp-content/uploads/2021/08/CDNS_testcase11-RevC.zip) | Cadence Allegro 17.4 S019 | rigid-flex display card, full file (USERDEF mode) |
| `IPC-2581-8-Layer-Design.xml` | RevB "Polar Speedstack Layer Stackup (Design View)", [`IPC-2581_Stack-ups_Sample.zip`](http://www.ipc2581.com/wp-content/uploads/2017/12/IPC-2581_Stack-ups_Sample.zip) | Polar Instruments Speedstack 14.2.21123 | 8-layer stack-up only, revision B, USERDEF mode |

The files are unmodified.

`testcase11-rdgflx-RevC-full.xml` exercises rigid-flex data: six stack-ups (`PRIMARY`, `FLEX-1` to `FLEX-3`, `FLEX-STIFFENER`, `RIGID-2`), `StackupZone`s and `BendArea`s, coverlay, adhesive, stiffener and epoxy layers outside the primary stack-up, a buried drill span (`DRILL_2-5`, `INT_1`–`INT_4`), per-layer colours, and `Xform`s inside standard primitives (`RectCenter`, `Oval`).

`IPC-2581-8-Layer-Design.xml` has a stack-up and no geometry: no profile, components or features. Speedstack writes `Stackup` without `name`, a UTF-8 byte order mark and CRLF line ends.
