# 0008 Hybrid metadata: component nodes, merged layer meshes with feature IDs

**Status:** Accepted, 2026-10-06

## Context

Every element must be hoverable and highlightable, and must accept widgets. A dense board has 50–200k pads, trace segments and vias.

One glTF node per element would mean as many draw calls. Browser graphics APIs manage a few thousand per frame at 60 fps, in any engine and language. Hover needs each element to be **identifiable**, not a separate object.

## Decision

- **Components** (hundreds) are real nodes with transforms and `extras.boardui`. They are the main widget targets and need to move in an exploded view.
- **Copper, mask, silkscreen, dielectric and barrels** are merged per layer. Every element is identified by a feature ID (`EXT_mesh_features`) and described in property tables (`EXT_structural_metadata`): nets, components, pins, and one feature table per layer.
- **Board-level data** (stack-up, layer list, source hash, profile version) lives in the `BOARDUI_board` extension.
- **IDs** are readable and stable: `cmp/C12`, `pin/C12/3`, `net/GND`, `layer/TOP`, `feat/TOP/1234` (spec §5).
- **Feature layout.** Within a layer, features never overlap (spec §6.2). Their vertices and triangles are contiguous and in ascending ID order (spec §8.1).

## Consequences

- Each layer renders in a few draw calls. Highlighting is a texture write in the viewer ([ADR 0009](0009-viewer-three-js-web-component.md)).
- Generic glTF viewers render the board correctly and ignore the metadata.
- The converter needs overlap resolution and careful buffer layout. `boardui validate` checks both.

## Alternatives considered

- **One node per element with `extras`:** most interoperable, but too slow on dense boards and slow to load.
- **Everything merged, including components:** components lose their transforms; exploded view and per-component widgets get harder.
