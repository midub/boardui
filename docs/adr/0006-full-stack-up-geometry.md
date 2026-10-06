# 0006 Full stack-up at real heights, realistic materials

**Status:** Accepted, 2026-10-06

## Context

Showing only the outer layers is half the work, but it gives up what 3D is good for on a PCB: inner layers, x-ray, cross-sections.

## Decision

- Every layer is modelled at its real Z range from the IPC-2581 stack-up. Defaults apply when the stack-up is missing: 1.6 mm board, 35 µm copper, 20 µm mask, 10 µm silkscreen.
- Plated holes get barrels.
- Inner copper and dielectric layers are hidden by default.
- Materials look realistic by default (green mask, gold copper, FR4). The viewer can restyle per layer at runtime.

## Consequences

- The Rust parser must read `Stackup`; the old parser never did.
- Missing soldermask and dielectric layers are synthesized and flagged (spec §6.4, §6.5).
- Coplanar faces between adjacent layers exist; the viewer handles them with per-layer polygon offset.

## Alternatives considered

- **Outer layers only:** simpler, but rules out x-ray and cross-section in v2.
