# 0013 Panels (`StepRepeat`)

**Status:** Accepted, 2026-10-07

## Context

An IPC-2581 panel is a `Step` with its own `Profile`, rails, fiducials and tooling holes, plus `StepRepeat` elements that place other steps (boards, coupons, sub-panels) in it. Rev C (§8.2.3.5) gives each `StepRepeat` a `stepRef`, the position `x`, `y` of the first copy, the copy counts `nx`, `ny` and pitches `dx`, `dy` along the panel's axes, a counter-clockwise `angle`, and `mirror`. Steps nest: a sub-panel (array) can be repeated in a production panel. All steps share the file's layers, and the "flipped" pairing (`mirror="true"`) requires a symmetrical stack-up: the mirrored copy is a board turned over, not a mirror image on the same side.

Until v1.1 the converter read none of this. A panel file converted to the panel's own features only, and the default step was the first `StepRef`, which may be one of the boards.

No exporter we have samples from writes `StepRepeat`; KiKit flattens panels into one `Step`. The rules below are therefore tested on a hand-written sample.

## Decision

**Placement.** A copy at array position `(i, j)` maps a point `p` of the referenced step to `(x + i·dx, y + j·dy) + R(angle) · F · (p − datum)` in the parent step, where `datum` is the referenced step's `Datum` (else the origin) and `F` mirrors about the Y axis when `mirror` is true (mirror, then rotate, like KiCad's `Xform`). Nested copies compose. The datum interpretation fits the rev C example (bad-board marks centred on the boards). A step that repeats itself (directly or through others) is a cycle; the repeat that closes it is skipped with a warning.

**Mirror is a flip.** A mirrored copy is turned over: its features go to the counterpart layer on the other side (copper layer `k` of `n` to `n − 1 − k`, top soldermask, silkscreen, paste and drawing layers to the same role on the bottom, and back), its components change side, and a drill layer goes to the one with the mirrored span. Features without a counterpart layer are skipped with a warning.

**Default step.** The root step: the first step that no `StepRepeat` references, preferring the order of `Content/StepRef`. Without any `StepRepeat` this is the same as before (first `StepRef`, else the first step), so single-step files and KiKit's flattened panels convert exactly as before. `--step` still selects any step, which then converts with its own repeats.

**Instances.** Every placed copy of a step is an *instance*, at any depth, named `<step>-<k>` with `k` counting that step's copies from 1 in expansion order (the repeats of a step in document order, each copy row by row with `i` fastest, nested repeats right after their parent copy). A new `instances` table lists them with their step, parent instance and placement.

**Element IDs.** Content of an instance gets the instance name as an extra segment after the kind: `cmp/<instance>/<refDes>`, `pin/<instance>/<refDes>/<pin>`, `net/<instance>/<net>`, `feat/<instance>/<layer>/<n>`, and the instance itself is `inst/<instance>`. `<n>` numbers the features of the instance's own step, so `feat/board-2/TOP/12` is the feature that `feat/TOP/12` is when the board converts alone. The root step's own content has no instance segment: a single-board conversion keeps today's IDs, and a panel's rails keep theirs.

**Nets** are per instance: each board's `GND` is a separate net (`net/board-1/GND`, `net/board-2/GND`). Boards in a panel aren't connected, and highlighting a net in one board must not light up the others. A viewer that wants every copy can match the net `name`.

**Geometry is baked.** Each instance's features, holes and components are transformed into board coordinates and go through the same pipeline as the root step's: one mesh and one feature table per layer, features in ascending row order (spec §8.1), overlap resolution and hole cuts across the whole panel. The board outline is the union of the root profile and the instances' profiles. Components with the same body still share one mesh.

**Stack-up.** All instances use the root step's stack-up; optional and synthesized layers (paste, drawings, `@assembly-*`, `@silkscreen-*`) exist if any instance needs them.

## Consequences

- Per-feature state (spec §8.1) works unchanged: every copy has its own texels, so hovering a pad in one board highlights only that pad.
- File size and triangle count grow with the number of copies. A 2 × 3 panel of the 4,358-feature Feather has about 26,000 features, well inside the browser limit of about 250,000 features (README, "Limits").
- Instance segments make IDs longer but keep them unique and stable while the panel layout is unchanged; renumbering only happens when copies of a step are added or removed before others in expansion order.
- The profile gains optional data (`instances` table, `instance` references), so its minor version goes up.

## Alternatives considered

- **glTF instancing** (one mesh per step, placed several times, or `EXT_mesh_gpu_instancing`). Smaller files, but every copy would share feature IDs and so state texels: hover and selection would light up all copies unless the profile added an instance offset to feature lookups, which no generic glTF tool understands. Overlaps and hole cuts between rails and boards, and the shared dielectric sheet, would need special cases. Rejected for now; it can come back as an optimisation if real panels get too large.
- **Shared nets** across copies. Simpler tables, but net highlighting would light up every board, and the boards aren't connected.
- **Renumbering refDes** (as KiKit does, `R1` → `R1_2`) instead of an instance segment. It can collide with real refDes and loses the link to the board's own IDs.
- **Mirror as an image mirror on the same side** (ODB++ style). It would put copper on the wrong side for the flipped pairing that rev C describes.
