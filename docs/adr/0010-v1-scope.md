# 0010 v1 tool set

**Status:** Accepted, 2026-10-06

## Decision

**v1 includes:**

- **Converter:** `boardui convert in.xml -o board.glb [--models map.json]`, as a native CLI and the same in the browser via WASM.
- **Validation:** `boardui validate board.glb`, checking the profile rules and running the Khronos validator when available.
- **Viewer:** orbit/pan/zoom, top and bottom views, layer toggles, hover and select, net highlight, x-ray, widget API.
- **Demo:** drop an IPC-2581 file in, convert it in the browser (nothing uploaded), view it, download the GLB.

**v2 backlog:** exploded layers, cross-section, measuring, `boardui inspect`, `boardui diff`, multi-threaded WASM, parametric bodies, paste and documentation layers.

## Consequences

- Milestones and exit criteria are in the [roadmap](../roadmap.md).
- The spec already fixes what v2 needs: closed prisms (for cross-sections) and component nodes (for exploded views).
