# 0003 IPC-2581 is the only input format

**Status:** Accepted, 2026-10-06

## Context

Candidate inputs were IPC-2581, KiCad `.kicad_pcb`, ODB++ and Gerber X2 with Excellon.

## Decision

v1 reads IPC-2581 only.

## Consequences

- One parser to build and harden, and the old TS parser's mapping knowledge carries over.
- KiCad 8+ exports IPC-2581 (`kicad-cli pcb export ipc2581`), so openly licensed KiCad boards still become test data. `kicad-cli pcb export glb` of the same board gives a visual reference.
- The three IPC consortium test cases in the repo are ASSEMBLY mode, with no stack-up or soldermask. That makes defaults and synthesized layers mandatory (spec §6.4, §6.5).

## Alternatives considered

- **IPC-2581 + KiCad native:** a second parser for a format that can already export IPC-2581.
- **ODB++ / Gerber:** ODB++ is large; Gerber lacks component and stack-up data. Later, if ever.
