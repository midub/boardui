# 0005 2.5D geometry with pure-Rust dependencies

**Status:** Accepted, 2026-10-06

## Context

Robust 3D booleans (Manifold, OpenCascade) and the reference Clipper2 are C++. Building C++ into `wasm32-unknown-unknown` from Rust is fragile.

## Decision

All board geometry is 2.5D:

- each element is a 2D region extruded over its layer's Z range;
- holes are cut in 2D before extrusion;
- barrels are tubes.

There are no 3D booleans. Dependencies are pure Rust: `quick-xml`, `i_overlay`, `i_triangle`, `rstar`, `glam`.

## Consequences

- The WASM build needs no C/C++ toolchain.
- Conformal soldermask can't be modelled exactly. The mask sheet overlaps the copper volume instead (spec §6.5).
- C++-backed extras are native-only feature flags. Geometry compression via `meshopt` is the only one planned.
- STEP import (OpenCascade) stays out of the converter ([ADR 0007](0007-component-bodies.md)).

## Alternatives considered

- **Manifold/OCCT via C++ in WASM:** heavier, fragile builds, and nothing on a PCB needs true 3D booleans.
