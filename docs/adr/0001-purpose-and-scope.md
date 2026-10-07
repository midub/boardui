# 0001 Purpose and scope

**Status:** Accepted, 2026-10-06. The licence point is superseded by [ADR 0015](0015-agpl-plus-commercial-licence.md).

## Context

boardui started as a bachelor thesis (2023): an IPC-2581 → SVG viewer for Angular. The rewrite moves it to 3D. Its purpose sets the quality bar, the licence and how wide the scope gets.

## Decision

- It's a hobby project, built to product standards: tests, CI, documentation, semantic versioning.
- Scope is viewing and tooling. **No editing.**
- The licence stays MIT.

## Consequences

- No hosted service and no commercial constraints. Conversion runs locally, in the CLI or the browser.
- Every feature needs tests and docs before release, so scope stays deliberately narrow.
- Editing would turn boardui into an ECAD tool; requests for it are out of scope.

## Alternatives considered

- **Product groundwork (dual licence, hosted conversion):** rejected; not the goal.
