# 0012 Spec format

**Status:** Accepted, 2026-10-06

## Decision

- `spec/README.md`: the boardui glTF profile, written like a Khronos extension spec with RFC 2119 keywords.
- `spec/schema/`: JSON Schemas for `BOARDUI_board`, component `extras` and the model mapping file, plus the embedded `EXT_structural_metadata` schema.
- `spec/samples/`: IPC-2581 inputs with expected outputs. They double as the conformance and regression suite.
- `docs/adr/`: one record per decision. `docs/architecture.md` and `docs/roadmap.md` cover the implementation.

## Consequences

- Spec changes and implementation changes go through the same pull requests. The samples keep them honest.
- The profile version (`major.minor`) changes with the spec; the embedded metadata schema version follows it.
