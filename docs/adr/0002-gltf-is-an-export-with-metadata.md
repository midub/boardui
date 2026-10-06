# 0002 glTF is an export with metadata

**Status:** Accepted, 2026-10-06

## Context

glTF describes triangles, materials and a node tree. A PCB carries meaning: stack-up, nets, pins, polarity, exact arcs. The question is how much of that the glTF should hold.

## Decision

- The glTF asset is an **export**. The IPC-2581 file stays the source of truth.
- The asset must still carry enough metadata to identify and describe every board element. That lets a viewer highlight elements and attach widgets to them without the source file.

## Consequences

- The profile only needs identity, description and geometry ranges. It doesn't need to round-trip to IPC-2581.
- Tools that need full design data (DRC, impedance, BOM checks) read IPC-2581, not the glTF.
- Exact 2D outlines can be added later as an optional extension if a use case appears.

## Alternatives considered

- **Visual-only export, like `kicad-cli pcb export glb`:** rejected; no widgets or highlighting possible.
- **Self-contained board package that all tooling reads:** more than the use cases need.
- **Full ECAD fidelity in glTF (arcs, polarity, round-trip):** would make the extension a second IPC-2581.
