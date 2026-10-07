# ipc-testcases

Test data published by the IPC-2581 Consortium on <https://www.ipc2581.com>: the [RevC test cases](https://www.ipc2581.com/ipc-2581-revc-test-cases/) and the [RevB test cases](https://www.ipc2581.com/b-test-cases/). The consortium publishes no licence for them, so this repository doesn't host them: it only links to them, and they are test data only (`../README.md`, "Rules").

## Fetching them

```sh
python3 spec/samples/ipc-testcases/fetch.py
```

[`fetch.py`](fetch.py) (Python 3, standard library only) reads the manifest [`sources.json`](sources.json). For each file it downloads the consortium's archive to a temporary file, extracts the file, normalizes its line ends where the manifest says so, checks its size and SHA-256 and writes it to this directory, where git ignores it. Files that are already here with the right hash are skipped. A mismatch is an error: if the consortium changes an archive, the expected outputs (`../expected/`) must be checked before the manifest is updated. `--force` replaces local files that don't match.

Without the files, the tests that read them are skipped with a message naming this command: the Rust samples and conformance tests (`cargo test`) and the demo's e2e suite. With `BOARDUI_REQUIRE_IPC_TESTCASES=1` they fail instead; CI sets it, and fetches the files once per manifest version into its cache (`.github/actions/ipc-testcases`).

## Files

| File | Consortium archive (member) | Line ends | Exporter (`HistoryRecord`/`SoftwarePackage`) | Board |
|---|---|---|---|---|
| `testcase1-RevC-Assembly.xml` | RevC test case 1, [`Testcase1-RevC-March2021.zip`](https://www.ipc2581.com/wp-content/uploads/2021/03/Testcase1-RevC-March2021.zip) (`Testcase1-RevC/`) | CRLF → LF | Cadence Allegro 17.4 S015 | network card, ASSEMBLY mode |
| `testcase3-RevC-Assembly.xml` | RevC test case 3, [`Testcase3_RevC-March2021.zip`](https://www.ipc2581.com/wp-content/uploads/2021/03/Testcase3_RevC-March2021.zip) (`testcase3_2581REVC/`) | CRLF → LF | Cadence Allegro 17.4 | round test card, ASSEMBLY mode |
| `testcase10-RevC-Assembly.xml` | RevC test case 10, [`CDNS_testcase10-Rev-C-data.zip`](https://www.ipc2581.com/wp-content/uploads/2021/08/CDNS_testcase10-Rev-C-data.zip) (`testcase10-Rev C data/`) | CRLF → LF | Cadence Allegro 17.4 S019 | demo board, ASSEMBLY mode |
| `testcase11-rdgflx-RevC-full.xml` | RevC test case 11, [`CDNS_testcase11-RevC.zip`](https://www.ipc2581.com/wp-content/uploads/2021/08/CDNS_testcase11-RevC.zip) (`testcase11-RevC/`) | unchanged | Cadence Allegro 17.4 S019 | rigid-flex display card, full file (USERDEF mode) |
| `IPC-2581-8-Layer-Design.xml` | RevB "Polar Speedstack Layer Stackup (Design View)", [`IPC-2581_Stack-ups_Sample.zip`](https://www.ipc2581.com/wp-content/uploads/2017/12/IPC-2581_Stack-ups_Sample.zip) (`stack-ups/`) | unchanged (CRLF) | Polar Instruments Speedstack 14.2.21123 | 8-layer stack-up only, revision B, USERDEF mode |

Apart from the line ends of the three Allegro ASSEMBLY files, which were converted to LF when the files were first added to the corpus, the files are the archives' files unmodified.

`testcase11-rdgflx-RevC-full.xml` exercises rigid-flex data: six stack-ups (`PRIMARY`, `FLEX-1` to `FLEX-3`, `FLEX-STIFFENER`, `RIGID-2`), `StackupZone`s and `BendArea`s, coverlay, adhesive, stiffener and epoxy layers outside the primary stack-up, a buried drill span (`DRILL_2-5`, `INT_1`–`INT_4`), per-layer colours, and `Xform`s inside standard primitives (`RectCenter`, `Oval`).

`IPC-2581-8-Layer-Design.xml` has a stack-up and no geometry: no profile, components or features. Speedstack writes `Stackup` without `name`, a UTF-8 byte order mark and CRLF line ends.
