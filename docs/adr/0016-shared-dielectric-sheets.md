# 0016 Shared dielectric sheets

**Status:** Accepted, 2026-10-07. Amends [ADR 0008](0008-hybrid-metadata.md) (profile 0.10).

## Context

A dielectric layer is one sheet: the board outline minus the holes that cross it (spec §6.7).
On a board whose holes all go through, every dielectric has the same sheet at a different
height. IPC consortium test case 1 (full) has 11 of them: 7.0 MB each, 77 MB of a 277 MB GLB,
4.2 M of 17.25 M triangles. Spec §4 required identity transforms on layer nodes and each layer's
primitives to name that layer's feature table, so every sheet was stored again.

## Decision

- **A repeated sheet shares the mesh of the first dielectric with that sheet.** Its node uses
  the same mesh with a transform that scales and moves it along Y only (`translation [0, t, 0]`,
  `scale [1, s, 1]`), mapping the first layer's Z range onto its own. The first layer keeps an
  identity transform and the mesh stays in board coordinates at its height, so the asset still
  reads as before for everything but the repeats, and the rule is easy to check.
  - Rejected: a mesh in a unit Z range with a transform on every user. No node would hold board
    coordinates, and the shared case would differ from every other layer.
- **The repeat shares the first layer's feature table too.** A primitive names exactly one
  `propertyTable`, and a shared primitive can't name each user's own. Sharing the table keeps
  `EXT_mesh_features` consistent: every primitive's table is the `featureTable` of every layer
  that shows it. The tables would be identical anyway (one `SHEET` row), and feature IDs derive
  from the layer, not from the table (spec §5).
  - Rejected: keeping a table per layer and letting `BOARDUI_board.layers[].featureTable`
    override the primitive's. Generic `EXT_mesh_features` readers would see the other layer's
    table.
- **Only dielectric sheets.** They are the only layers that repeat in practice, and the converter
  knows they repeat without comparing geometry: the same drills cross them. Soldermask sheets
  differ by their openings, copper, paste and drawing layers never match. Widening the rule later
  is a compatible change; narrowing it would not be.
- Layers share only with the same colour (the material is the mesh's), and a sheet without
  geometry shares nothing.

## Consequences

- testcase1-RevC-full: 277 MB → 203 MB; conversion skips extruding and writing 10 sheets.
- Readers that merge layer meshes must apply node transforms. The boardui viewer always did
  (`mergeLayer` uses `matrixWorld`); generic glTF viewers do anyway. A reader that assumed
  identity transforms on layer nodes draws a repeat at the first layer's height.
- The profile is still a draft, so the relaxed rule goes into a minor version, 0.10 (spec §11).
