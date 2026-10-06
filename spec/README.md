# boardui glTF profile

**Version 0.1 — draft**

This document specifies how boardui represents a printed circuit board as a glTF 2.0 asset. The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## 1. Scope

A *boardui asset* is a valid glTF 2.0 asset (`.glb` recommended) that:

- renders as a plausible 3D board in any glTF viewer, and
- carries enough metadata for a viewer to identify, describe and highlight every board element and to attach widgets to it.

The asset is an **export**. The IPC-2581 source file stays the source of truth; this profile does not aim to convert back to IPC-2581 ([ADR 0002](../docs/adr/0002-gltf-is-an-export-with-metadata.md)). Analyses that need full design data (DRC, impedance, BOM checks) read the source.

Out of scope for 0.1: paste and documentation layers, assembly drawings, embedded components, cavities, rigid-flex.

## 2. Conformance

A conformant asset:

1. passes the [Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator) with zero errors;
2. lists `BOARDUI_board`, `EXT_mesh_features` and `EXT_structural_metadata` in `extensionsUsed`, and does **not** list them in `extensionsRequired` (the board must render without them);
3. satisfies every MUST in this document. `boardui validate` checks them (§10).

## 3. Units and coordinate system

- Lengths are in metres, as in glTF. Converters scale from IPC-2581 `CadHeader@units` (`INCH`, `MILLIMETER`, `MICRON`).
- glTF is right-handed with +Y up. The board lies in the XZ plane with its top side facing +Y.
- An IPC-2581 point `(x, y)` maps to glTF `(x, ·, −y)`. Seen from +Y with −Z pointing up the screen, the board looks like the ECAD top view, not mirrored.
- The IPC-2581 origin is kept. `Y = 0` is the board's mid-plane: halfway between the outer copper surfaces.
- Positions are float32. In metres that gives sub-micron precision for boards up to about 1 m across.

## 4. Scene structure

The asset has one scene with one root node:

```
board                         root node
├─ layers
│  ├─ layer/silkscreen_top    one node per layer, ordered top to bottom
│  ├─ layer/@soldermask-top
│  ├─ layer/TOP
│  ├─ layer/@core
│  ├─ layer/BOTTOM
│  └─ …
├─ drills
│  └─ layer/DRILL_1-12        plated barrels of one drill span
└─ components
   ├─ C12                     one node per placed component
   └─ …
```

- The root node MUST be named `board`, with child group nodes `layers`, `drills` and `components`. Group nodes MAY be empty.
- Layer and drill nodes MUST be named by their layer ID (§5), have identity transforms and hold geometry in board coordinates.
- Each layer and drill node has one mesh.
- A mesh MAY have several primitives, for example chunks of the same material. Converters SHOULD keep each primitive at or below 65,535 vertices so indices fit `UNSIGNED_SHORT`. A feature MUST NOT span two primitives.

## 5. Element identifiers

Every element has a string ID. IDs are stable across re-exports for as long as the attribute they are built from doesn't change.

| Element | ID | Stable while |
|---|---|---|
| board | `board` | always |
| layer | `layer/<layer name>` | layer name unchanged |
| component | `cmp/<refDes>` | refDes unchanged |
| pin | `pin/<refDes>/<pin>` | refDes and pin number unchanged |
| net | `net/<net name>` | net name unchanged |
| feature | `feat/<layer name>/<n>` | input file unchanged |

- Each `<…>` segment is percent-encoded. `%`, `/`, `#`, `@`, whitespace and control characters MUST be written as `%XX`.
- Layers that the converter synthesizes (§6.4, §6.5) get names starting with an unencoded `@`, for example `layer/@soldermask-top`. Because `@` in source names is always encoded, the two never collide.
- `<n>` is the 0-based index of the feature among the layer's source features in document order. The step's `LayerFeature` for that layer is walked, counting every `Pad`, `Features`, `Hole` and `SlotCavity` element. Sheet features of synthesized or dielectric layers use `n = 0`.
- Feature IDs are stable only for identical input. Viewers and widgets SHOULD bind to components, pins and nets where possible.

## 6. Geometry

### 6.1 Prisms

- Every layer occupies a Z range `[zMin, zMax]` (§6.4). Every element on a layer is a prism: a 2D region extruded over that range.
- Prisms MUST be closed (watertight) with consistent outward-facing triangle winding (counter-clockwise, as glTF requires).
- Arcs and circles are tessellated with a maximum chord deviation of `tolerance`, with at least 8 segments per full circle. The default `tolerance` is 5 µm, and the value used is recorded in `BOARDUI_board.tolerance`.
- Normals SHOULD be omitted. glTF clients then compute flat normals, which suit prisms and save roughly 45 % of vertex data.

### 6.2 Copper layers: features never overlap

Within one copper layer, feature regions MUST NOT overlap. Where input features overlap, the feature with higher priority keeps the overlapping area:

1. pads (`Pad`, or features in a `Set` with `padUsage="TERMINATION"`)
2. via lands (`padUsage="VIA"`)
3. traces (lines, arcs, polylines)
4. fills (contours, planes)
5. everything else

On equal priority, the earlier feature in document order wins.

A negative-polarity feature removes copper from every feature that precedes it in document order and produces no geometry of its own.

The union of a layer's features equals that layer's copper exactly. Two consequences:

- highlighting one element never z-fights with a neighbour;
- per-net copper is exact.

A feature whose region becomes empty keeps its metadata row (§8.2) and has no vertices.

### 6.3 Holes and barrels

- Every hole (`Hole`, `SlotCavity`) is cut out of the 2D regions of every layer it passes through, before extrusion.
- Plated holes (`platingStatus` `PLATED` or `VIA`) get a **barrel**:
  - It is a tube with inner radius `diameter / 2` and wall thickness `platingThickness` (default 25 µm, recorded in `BOARDUI_board`).
  - It runs from the top of the span's upper copper layer to the bottom of its lower copper layer.
  - Layers along the span are cut at `diameter / 2 + platingThickness`.
- Non-plated holes are cut at `diameter / 2` and have no barrel.
- The drill layer's `Span` defines a hole's span. Without a `Span`, the hole runs through all layers.
- Barrels are features of their drill layer (kind `BARREL`) and carry the net of their `Set`.
- Slots follow the same rules, using the slot outline instead of a circle.

### 6.4 Stack-up

- Layer order and thicknesses come from the IPC-2581 `Stackup` when present.
- Otherwise the converter uses defaults:

| Parameter | Default |
|---|---|
| Copper-to-copper thickness | 1.6 mm |
| Copper | 35 µm |
| Soldermask | 20 µm |
| Silkscreen | 10 µm |

  Dielectric fills the space between copper layers evenly. If the source has no dielectric layers, the converter synthesizes `@core` (and `@prepreg-<k>` between inner layers).
- Each entry in `BOARDUI_board.layers` records its actual `zMin` and `zMax`, and whether the thickness came from the file or from defaults.
- Layer Z ranges are ordered top to bottom and MUST NOT overlap, with one exception: a soldermask layer starts at the top of the dielectric beneath the outer copper layer (§6.5).

### 6.5 Soldermask

- Each side has one soldermask sheet: the board outline minus mask openings minus holes.
- Its Z range starts at the top surface of the dielectric under the outer copper layer and ends `soldermask` above the copper surface. The copper sits inside the mask volume, so a translucent mask shows the traces under it, and there is no gap at the board edge.
- If the source has no soldermask layer for a side, the converter SHOULD synthesize `@soldermask-top` / `@soldermask-bottom`. Its openings equal that side's pad features, and it is flagged `synthesized: true`.

### 6.6 Silkscreen

- Strokes become polygons, using the line width and end style of their `LineDesc`.
- Silkscreen sits on top of the soldermask. It SHOULD be clipped by mask openings, as manufacturers do.
- Silkscreen features SHOULD reference their component when the source links them.

### 6.7 Dielectric and outline

Each dielectric layer is one sheet feature (kind `SHEET`): the step profile, including its cutouts, minus holes.

### 6.8 Components

- Each placed component gets one node under `components`. The node is named by refDes, with `extras` per §8.4.
- **Mounting plane.** The node's translation is the component location on the mounting plane: the outer surface of that side's outer copper layer.
- **Rotation.** The IPC-2581 `Xform` rotation (degrees, counter-clockwise in the top view) becomes a rotation about +Y.
- **Bottom side.** Bottom-side components are also rotated 180° about their local X axis, so their local +Y points away from the board. This absorbs the source mirror flag. The result MUST match the placement shown by the source ECAD tool; the samples verify it.
- **Placeholder body.** Without a user model, the body is the package outline (`Package/Outline`) extruded from `standoff` to `height` (material `boardui/body`). A pin-1 marker (material `boardui/pin1`) is placed on the top face over pin 1 when the package defines it.
- **User models.** With a matching user model (§6.9), the model's scene is added as a child of the component node, and the placeholder body is omitted.
- **Shared meshes.** Components with the same package (or the same user model) MUST share one glTF mesh.

### 6.9 User models

Models are supplied as glTF/GLB files with a mapping file ([`schema/models.schema.json`](schema/models.schema.json)). The model conventions are:

- Y-up, in metres;
- origin at the package origin;
- oriented as placed on the top side at 0° rotation;
- seating plane at `y = 0`.

Per-model `offsetMm`, `rotationDeg` and `scale` correct models that deviate. Matching tries `part` first, then `package`; the first match wins.

## 7. Materials

| Name | Used for | Default |
|---|---|---|
| `boardui/copper` | copper features, barrels | base `#C9A15A`, metallic 1.0, roughness 0.35 |
| `boardui/soldermask` | soldermask sheets | base `#1E6B2E`, alpha 0.85, `alphaMode: BLEND`, roughness 0.4 |
| `boardui/silkscreen` | silkscreen | base `#F2F2F2`, roughness 0.8 |
| `boardui/dielectric` | dielectric sheets | base `#C7B98A`, roughness 0.9 |
| `boardui/body` | placeholder bodies | base `#2B2B2B`, roughness 0.6 |
| `boardui/pin1` | pin-1 markers | base `#E0E0E0`, roughness 0.6 |

- Materials MUST be shared: each name appears once.
- Colours from the source (IPC-2581 colour dictionaries, specs) MAY override defaults.
- Viewers MAY restyle by material name.

## 8. Metadata

### 8.1 `EXT_mesh_features`

Every primitive of a layer or drill mesh MUST carry exactly one `featureIds` entry with:

- `attribute: 0` (vertex attribute `_FEATURE_ID_0`);
- `propertyTable`: that layer's feature table;
- `featureCount`: the number of distinct feature IDs in the primitive.

Feature IDs are row indices into the layer's feature table:

- The component type is `UNSIGNED_SHORT` when the table has fewer than 65,536 rows. Otherwise it is `FLOAT`, which is exact up to 2²⁴.
- `nullFeatureId` is not used: every vertex belongs to a feature.
- Within a primitive, a feature's vertices MUST be contiguous, and so MUST its triangles, with features in ascending ID order. A viewer can then derive every feature's vertex and index ranges in one pass, which it needs for bounding boxes, widget anchors and isolating a feature.

### 8.2 `EXT_structural_metadata`

- The root extension MUST embed the schema in [`schema/structural-metadata.json`](schema/structural-metadata.json), whose `version` equals the profile version.
- Property tables:

| Table name | Class | One row per |
|---|---|---|
| `nets` | `net` | net |
| `components` | `component` | placed component |
| `pins` | `pin` | component pin referenced by any feature |
| `<layer ID>` | `feature` | source feature of that layer (or drill layer) |

- **References.** References between tables are row indices (`UINT32`); `4294967295` means none. For example, `feature.net` is a row in `nets`, and `pin.component` is a row in `components`.
- **Feature ID strings** are not stored. They derive from the layer name and `feature.source` (§5).
- **Linking features to pins and components.** A feature gets `pin` and `component` from the `PinRef` of its `Pad` or `Set`, and `net` from its `Set@net`.

### 8.3 `BOARDUI_board`

This is a root-level extension ([`schema/BOARDUI_board.schema.json`](schema/BOARDUI_board.schema.json)):

```json
"BOARDUI_board": {
  "profileVersion": "0.1",
  "source": {
    "format": "IPC-2581",
    "revision": "C",
    "step": "testcase1-v174-RevC",
    "functionMode": "ASSEMBLY",
    "sha256": "<hex>"
  },
  "tolerance": 5e-6,
  "platingThickness": 2.5e-5,
  "thickness": 0.0016,
  "layers": [
    {
      "id": "layer/TOP", "name": "TOP",
      "role": "COPPER", "ipcFunction": "CONDUCTOR", "side": "TOP",
      "zMin": 0.000765, "zMax": 0.0008,
      "thicknessSource": "DEFAULT", "synthesized": false,
      "visible": true, "node": 5, "featureTable": 3
    }
  ],
  "drills": [
    {
      "id": "layer/DRILL_1-12", "name": "DRILL_1-12",
      "from": "layer/TOP", "to": "layer/BOTTOM",
      "node": 9, "featureTable": 6
    }
  ],
  "tables": { "nets": 0, "components": 1, "pins": 2 }
}
```

- `layers` is ordered top to bottom.
- `role` is one of `COPPER`, `DIELECTRIC`, `SOLDERMASK`, `SILKSCREEN`. `ipcFunction` keeps the source `layerFunction`, and is absent for synthesized layers.
- `visible` is the suggested default visibility. Inner copper and dielectric layers default to `false`.

### 8.4 Component node `extras`

Component nodes carry `extras.boardui` ([`schema/component-extras.schema.json`](schema/component-extras.schema.json)):

```json
"extras": {
  "boardui": {
    "id": "cmp/C12", "row": 11,
    "refDes": "C12", "part": "GRM155R71C104KA88",
    "package": "C0402", "side": "TOP", "mount": "SMT"
  }
}
```

- `row` is the component's row in the `components` table, which is authoritative.
- The other fields duplicate it so that generic tools (Blender custom properties, three.js `userData`) can show them. They MUST match the table.

## 9. Widget anchoring (informative)

A viewer resolves an ID to geometry as follows:

- **Feature:** layer table and row, then its vertex range (§8.1), then its bounding box.
- **Pin:** the union of its features.
- **Net:** the union of the bounding boxes of the features and barrels that reference it.
- **Component:** the world bounding box of its node.

Anchors (for example top-centre of the bounding box) are computed from these.

## 10. Validation

`boardui validate <file.glb>` checks the rules of this profile:

- the extensions are declared as in §2;
- the scene structure follows §4, and IDs are unique and well-formed;
- feature IDs are contiguous and ascending within primitives;
- metadata references are in range, and component `extras` match the `components` table;
- per copper layer, the sum of feature areas equals the area of their union, within tolerance (§6.2);
- prisms are closed;
- layer Z ranges are ordered (§6.4).

It runs the Khronos validator too, when the `gltf_validator` binary is on `PATH`; CI always runs it.

## 11. Versioning

`profileVersion` is `major.minor`. Minor versions only add optional data. Readers MUST reject an unknown major version and SHOULD accept an unknown minor version.

## 12. Open questions

- Verify the bottom-side placement rule (§6.8) against KiCad IPC-2581 exports.
- Register the `BOARDUI` vendor prefix with Khronos.
- Geometry compression: `EXT_meshopt_compression` and `KHR_mesh_quantization` for stored files (native CLI only; see [architecture](../docs/architecture.md)).
- Whether pins need their own geometry anchor when a pad is split across layers (THT pads).
