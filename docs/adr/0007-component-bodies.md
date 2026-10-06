# 0007 Placeholder bodies plus user-supplied GLB models

**Status:** Accepted, 2026-10-06

## Context

IPC-2581 gives each package an outline and a height, but no 3D model; `modelRef` only names an external file.

## Decision

- **Fallback:** the package outline is extruded from standoff to height, with a pin-1 marker.
- **User models:** GLB/glTF models are matched by part or package through a mapping file ([`models.schema.json`](../../spec/schema/models.schema.json)) passed with `--models`.
- STEP is not supported in the converter. Convert STEP to GLB beforehand with existing tools.

## Consequences

- Every board renders, and nothing is invented.
- Components with the same package or model share one mesh, so the viewer can batch them.
- Model coordinate conventions are fixed in the spec (§6.9), with per-model offset, rotation and scale corrections.

## Alternatives considered

- **Parametric bodies from package names (SOIC-8, 0603…):** IPC-2581 package names are free text, so matching is a rabbit hole. v2 backlog.
- **STEP import via OpenCascade:** C++ in WASM, contrary to [ADR 0005](0005-2-5d-geometry-in-pure-rust.md).
