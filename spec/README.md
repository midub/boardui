# boardui glTF profile

**Version 0.6 — draft**

This document specifies how boardui represents a printed circuit board as a glTF 2.0 asset. The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## 1. Scope

A *boardui asset* is a valid glTF 2.0 asset (`.glb` recommended) that:

- renders as a plausible 3D board in any glTF viewer, and
- carries enough metadata for a viewer to identify, describe and highlight every board element and to attach widgets to it.

The asset is an **export**. The IPC-2581 source file stays the source of truth; this profile does not aim to convert back to IPC-2581 ([ADR 0002](../docs/adr/0002-gltf-is-an-export-with-metadata.md)). Analyses that need full design data (DRC, impedance, BOM checks) read the source.

Out of scope: embedded components, cavities, rigid-flex. Paste, courtyard, assembly and documentation layers and package drawings are in scope since 0.4 (§6.11–§6.13), panels since 0.6 (§6.14).

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
   ├─ board-2/C12             a component of an instance (§6.14)
   └─ …
```

- The root node MUST be named `board`, with child group nodes `layers`, `drills` and `components`. Group nodes MAY be empty.
- Layer and drill nodes MUST be named by their layer ID (§5), have identity transforms and hold geometry in board coordinates.
- Each layer and drill node with geometry has one mesh. A layer without geometry has no mesh (glTF meshes can't be empty).
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
| instance | `inst/<instance>` | panel layout unchanged |

- Each `<…>` segment is percent-encoded. `%`, `/`, `#`, `@`, whitespace (Unicode `White_Space`) and control characters MUST be written as `%XX`: one `%XX` per UTF-8 byte, with upper-case hex digits. Other characters MUST NOT be encoded, so every ID has exactly one spelling.
- Layers that the converter synthesizes (§6.4, §6.5, §6.13) get names starting with an unencoded `@`, for example `layer/@soldermask-top`. Because `@` in source names is always encoded, the two never collide.
- `<n>` is the 0-based index of the feature among the layer's source features in document order. The step's `LayerFeature` elements for that layer are walked in document order (a step may split one layer over several of them), counting every `Pad`, `Features`, fiducial (`GlobalFiducial`, `LocalFiducial`, `BadBoardMark`, `GoodPanelMark`), `Hole` and `SlotCavity` element of their `Set`s.
- Features drawn from package drawings (§6.13) follow the layer's source features: they are numbered on from the last one, in the order of §6.13 (from 0 on a synthesized layer).
- Soldermask and dielectric layers have a single feature, their sheet (§6.5, §6.7), with `n = 0`. The source features of a soldermask layer are its openings; they shape the sheet but get no rows of their own.
- Feature IDs are stable only for identical input. Viewers and widgets SHOULD bind to components, pins and nets where possible.
- **Instances.** Components, pins, nets and features of an instance (§6.14) have the instance name as an extra segment after the kind: `cmp/<instance>/<refDes>`, `pin/<instance>/<refDes>/<pin>`, `net/<instance>/<net name>`, `feat/<instance>/<layer name>/<n>`. `<n>` counts the features of the instance's own step, so these IDs are those of the step converted alone, with the instance segment. The converted step's own elements have no instance segment: a file without `StepRepeat` gets the IDs above.

## 6. Geometry

### 6.1 Prisms

- Every layer occupies a Z range `[zMin, zMax]` (§6.4). Every element on a layer is a prism: a 2D region extruded over that range.
- Prisms MUST be closed (watertight) with consistent outward-facing triangle winding (counter-clockwise, as glTF requires).
- Arcs and circles are tessellated with a maximum chord deviation of `tolerance`, with at least 8 segments per full circle. The default `tolerance` is 5 µm, and the value used is recorded in `BOARDUI_board.tolerance`.
- Strokes (lines, arcs, polylines on any layer) become regions using the width and `lineEnd` of their `LineDesc`:
  - `ROUND` ends are half circles, and corners between segments are round;
  - `SQUARE` ends extend half the width beyond the end point, `NONE` ends stop at it, and corners of both are mitered, with corners sharper than 30° clipped;
  - a polyline that ends at its start point is closed and has no ends;
  - a stroke whose `LineDesc` has zero width is a hairline, drawn 0.1 mm wide whatever the `Xform` scale. The IPC consortium test case 10 draws its silkscreen this way.
- An IPC-2581 `Outline` encloses an area: it is filled, and its line (if wider than zero) is drawn on top. KiCad writes silkscreen text and slots this way, with zero-width lines. A `Polygon` is filled unless its `FillDesc` says `HOLLOW` (stroked only, so a zero-width line is a hairline) or `VOID` (nothing).
- A `HATCH` fill is parallel lines of the `FillDesc`'s `lineWidth` (a hairline if absent or 0) at `angle1` (default 45°) and `pitch1` (default 4 line widths) apart, clipped to the area; `MESH` adds a second set at `angle2` (default 135°) and `pitch2`. Angles are measured from the shape's local X axis, and one line of each set passes through the shape's origin. The shape's line is drawn on top, as for a solid fill. A fill whose pitch isn't positive, or that would need more than 4,096 lines in one direction, is drawn solid with a warning.
- `LineDesc@lineProperty` patterns strokes (lines, arcs, polylines and outlines) with the lengths of IPC-2581C §3.5.5.1, in line widths `w`: `DOTTED` dots `w` and gaps `2w`, `DASHED` dashes and gaps `3w`, `CENTER` a dash `6w`, gap `2w`, dot `w`, gap `2w`, and `PHANTOM` the same with two dots. These are visible lengths, ends included: a round or square end reaches `w/2` past a dash's centre line, so a round dot is a disc of diameter `w`. The pattern starts with a dash at the start of the path, runs on around corners and arcs, and the last dash may be cut short. A stroke that would have more than 100,000 dashes is drawn solid with a warning.
- An `ERASE` line is solid and erases instead of drawing. A `Features` element drawn only with `ERASE` lines (strokes, or hollow shapes) has negative polarity (§6.2). Inside a `UserSpecial`, an `ERASE` stroke cuts the parts before it, and the `ERASE` line of a filled shape cuts its own fill.
- A `Hexagon` is regular, with a corner pointing up (+Y); its `length` is the distance across the corners (IPC-2581C §3.5.9.7). A `Moire` is `ringNumber` rings of width `ringWidth`, centred on diameters `diameter`, `diameter − 2·ringGap`, …, as long as they fit, and a crosshair of two lines (`lineWidth` wide, flat ends, `lineLength` long or else spanning the outer ring, turned by `lineAngle`) when `lineWidth` is above 0.
- `Text` is drawn as strokes, like a group of lines:
  - Glyphs come from the `FontDefEmbedded` of its `FontRef`: the `Glyph` whose `charCode` (`xsd:hexBinary`, read as a big-endian Unicode code point, so `41` and `0041` are both `A`) matches the character. Their strokes use their own `LineDesc`, scaled with the text.
  - Characters the embedded font lacks, and all text with a `FontDefExternal`, an undefined `FontRef` or none, use the converter's bundled single-stroke font (KiCad's Newstroke, ASCII and Latin-1). Its strokes use the `Text`'s `LineDesc` (an extension: rev C has none), else the embedded font's `LineDesc` scaled with the text, else they are round and 15 % of the cap height wide. Characters no font has are drawn as a box the size of a capital, with one warning listing them.
  - The font's cell, from the lowest `lowerLeftY` to the highest `upperRightY` of its glyphs (for the bundled font, from the descenders to the top of the capitals), is scaled to the height of the `BoundingBox`. The string starts at the box's left edge, and each glyph advances by the width of its cell. Text that would be wider than the box is scaled down to its width, centred vertically, with a warning.
  - The `Text`'s `Xform` places the box in the coordinates of the shape. `fontSize` and colours are not used.
- Shapes are placed with their `Location` and `Xform`: scaled, rotated and mirrored (in the file's mirror order, §6.8), then offset by `xOffset`/`yOffset` and moved to the location.
  - A standard primitive may carry its own `Xform` (revision B allows it on all of them but `Contour` and `Moire`; revision C dropped it, but Allegro 17.4 still writes it). It is part of the primitive's definition and turns the shape in the primitive's own frame first; the referencing element's `Xform` and `Location` (and its pad's or component's placement) then place the result.
- Normals SHOULD be omitted. glTF clients then compute flat normals, which suit prisms and save roughly 45 % of vertex data.

### 6.2 Copper layers: features never overlap

Within one copper layer, feature regions MUST NOT overlap. Where input features overlap, the feature with higher priority keeps the overlapping area:

1. pads: `Pad` elements, except in a `Set` with `padUsage="VIA"`, area features (not strokes) in a `Set` with `padUsage="TERMINATION"`, and fiducials
2. via lands: `Pad` elements and area features in a `Set` with `padUsage="VIA"`
3. traces: strokes (`Line`, `Arc`, `Polyline`, or a `UserSpecial` made only of them), whatever the `Set`'s `padUsage`; KiCad, for one, puts a net's traces into its via `Set`s
4. fills: `Contour`s and `Polygon`s (planes, pours, teardrops)
5. everything else

The class is also the feature's `kind` (§8.2): `PAD`, `VIA`, `TRACE`, `FILL` or `OTHER`, except that fiducials are `FIDUCIAL`. Silkscreen and drawing features (§6.12, §6.13) are `MARKING`. Paste features are classified like copper features (§6.11).

On equal priority, the earlier feature in document order wins.

A negative-polarity feature (in a `Set` with `polarity="NEGATIVE"`, or drawn only with `ERASE` lines, §6.1) removes copper from every feature that precedes it in document order and produces no geometry of its own.

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
- Layers with `layerFunction` `DRILL` or `ROUT` are drill layers. The drill layer's `Span` defines a hole's span. Without a `Span`, the hole runs through all layers.
- A hole is cut from the copper and dielectric layers of its span. It is cut from a side's soldermask, paste and silkscreen when its span reaches that side's outer copper layer. Drawings (§6.12) are not cut.
- Barrels are features of their drill layer (kind `BARREL`) and carry the net of their `Set`. Non-plated holes keep their row in the drill layer's table (kind `OTHER`) but have no geometry.
- Slots follow the same rules, using the slot outline instead of a circle. Where a circle's radius grows by `platingThickness`, the outline is offset outward by it, with rounded corners.

### 6.4 Stack-up

- Layer order and thicknesses come from the IPC-2581 `Stackup` when present: its `StackupLayer`s in `sequence` order, top first. A thickness of 0 counts as absent (KiCad writes 0 for silkscreen and paste); the default applies.
- Otherwise the converter uses defaults:

| Parameter | Default |
|---|---|
| Copper-to-copper thickness | 1.6 mm |
| Copper | 35 µm |
| Soldermask | 20 µm |
| Silkscreen | 10 µm |
| Paste (§6.11) | 100 µm |
| Drawing sheet (§6.12) | 10 µm, always |

  Dielectric layers without a thickness share what the copper leaves of the 1.6 mm evenly.
- Where two adjacent copper layers have no dielectric between them, the converter synthesizes one. With `g` gaps counted from the top (0-based), the middle gap `⌊(g − 1) / 2⌋` is `@core` and gap `k` otherwise is `@prepreg-<k+1>`; a 2-layer board gets `@core`, a 4-layer board `@prepreg-1`, `@core`, `@prepreg-3`. A board with a single copper layer sits on a synthesized `@core`.
- Each entry in `BOARDUI_board.layers` records its actual `zMin` and `zMax`, and whether the thickness came from the file or from defaults.
- Layer Z ranges are ordered top to bottom and MUST NOT overlap, with two exceptions: a soldermask layer starts at the top of the dielectric beneath the outer copper layer (§6.5), and a paste layer overlaps the soldermask and silkscreen of its side (§6.11).
- Outside the copper layers, the layers of a side are ordered by their outer face: the top side's by `zMax`, highest first, and the bottom side's by `zMin`, highest first. A paste layer thicker than the mask and silkscreen therefore comes before them.

### 6.5 Soldermask

- Each side has one soldermask sheet: the board outline minus mask openings minus holes.
- Its Z range starts at the top surface of the dielectric under the outer copper layer and ends `soldermask` above the copper surface. The copper sits inside the mask volume, so a translucent mask shows the traces under it, and there is no gap at the board edge.
- If the source has no soldermask layer for a side, the converter SHOULD synthesize `@soldermask-top` / `@soldermask-bottom`. Its openings equal that side's pad and fiducial features (kinds `PAD` and `FIDUCIAL`; via lands stay tented), and it is flagged `synthesized: true`.
- The sheet is the layer's only feature (kind `SHEET`).

### 6.6 Silkscreen

- Strokes become polygons, using the line width and end style of their `LineDesc`, and `Text` is drawn as strokes (§6.1).
- Silkscreen sits on top of the soldermask. It SHOULD be clipped by mask openings, as manufacturers do.
- Silkscreen features SHOULD reference their component when the source links them.
- Package silkscreens add features where the silkscreen layer has nothing for a component, and a side without a silkscreen layer may get a synthesized one (§6.13).

### 6.7 Dielectric and outline

Each dielectric layer is one sheet feature (kind `SHEET`): the step profile, including its cutouts, minus holes.

**Cut-outs on a board outline layer.** KiCad writes the `Profile` as its outer polygon alone and draws the board's inner contours (holes, slots, the gaps of a panel) only on its `BOARD_OUTLINE` layer, `Edge.Cuts`, as separate `Line`s and `Arc`s. When a step's profile has no `Cutout`, the converter takes them from the step's `BOARD_OUTLINE` layers:

- lines, arcs and open `Polyline`s are chained into closed contours in any order and direction, joining ends up to 20 µm apart (KiCad joins ends up to 10 µm apart, and its export rounds coordinates); closed shapes (`Polygon`, `Outline`, a closed `Polyline`, a standard primitive) are contours as they are;
- a contour that lies at least 20 µm inside the profile is cut out of it. The contour that traces the profile itself, contours across or touching its edge and open chains are not;
- the converter warns once per step with the number of cut-outs taken from each layer.

A profile with `Cutout`s is used as written. In a panel (§6.14), each step's contours cut its own profile, before the profiles are joined. This is converter behaviour; the asset only carries the resulting outline.

### 6.8 Components

- Each placed component gets one node under `components`. The node is named by refDes (`<instance>/<refDes>` in an instance, §6.14), with `extras` per §8.4.
- **Mounting plane.** The node's translation is the component location on the mounting plane: the outer surface of that side's outer copper layer.
- **Package frame.** A package point `(x, y)` at height `h` above the seating plane maps to `(x, h, −y)` in the node's frame, like board points in §3.
- **Mirror order.** IPC-2581 exporters disagree on how a mirrored `Xform` combines mirroring (about the Y axis) and the counter-clockwise rotation θ:
  - KiCad mirrors, then rotates: `p' = R(θ) · M · p`;
  - the IPC consortium test cases rotate, then mirror: `p' = M · R(θ) · p`, so the rotation reads clockwise in the top view.

  The two differ unless θ is a multiple of 180°. Pads are absolute and reference their package pins through `PinRef`, so they decide: converters MUST place components (and every other `Xform`) so that each package pin lands on its pads. boardui counts, for the mirrored components of a file, the pins each order puts on their pads and takes the order with more; without evidence it uses KiCad's.
- **Rotation.** The node's rotation (and scale) is the 3D extension of the component's in-plane placement `L` (rotation and mirroring), with node +Y pointing away from the board on the mounting side:
  - top side, not mirrored: a rotation by θ about +Y;
  - bottom side, mirrored: `R_y(θ) · R_z(180°)` for KiCad's order and `R_y(−θ) · R_z(180°)` for the consortium order, where `R_z(180°)` flips the package about its own y axis;
  - a placement that is a reflection in 3D (mirrored on the top side, or not mirrored on the bottom side) is written as a rotation with scale `(1, −1, 1)`.

  The result MUST match the placement shown by the source ECAD tool; the `bottom-placement` and `kicad-royalblue54l-feather` samples verify it.
- **Placeholder body.** Without a user model, the body is the package outline (`Package/Outline`, filled) extruded from `standoff` to `height` (material `boardui/body`), on the component node itself.
  - `height` is `Component@height`, else `Package@height`. Without either (KiCad writes none), `SMT` and `THMT` components with pads get half the outline's smaller side, clamped to 0.2–2 mm. Other components get no body: those mounted otherwise (test points, fiducials, logos), and those without pads, whose package has no pins, or none that a pad references while the step's pads do reference pins (logos, placeholders, mounting holes, mouse bites).
  - A body with a guessed height (no `Component@height` or `Package@height`) whose outline, placed, covers more than half of its board (the outline of the component's step, §6.7, §6.14) is left out: such a package is the board itself, as for a carrier made to drop in for a module, or would hide it. A height from the file keeps the body (a shield, a display).
  - `standoff` is `Component@standoff`, else 0.
  - A pin-1 marker (material `boardui/pin1`) is placed on the top face over pin 1 when the package defines it: a 20 µm disc whose radius is 12 % of the outline's smaller side (0.1–0.5 mm), moved from pin 1 towards the outline's centre until it lies inside the outline.
- **User models.** With a matching user model (§6.9), the model is added on a child node of the component node, whose transform is the mapping's correction, and the placeholder body is omitted.
- **Shared meshes.** Components with the same package and the same body dimensions (`height`, `standoff`), or the same user model, MUST share one glTF mesh.

### 6.9 User models

Models are supplied as glTF/GLB files with a mapping file ([`schema/models.schema.json`](schema/models.schema.json)). The model conventions are:

- Y-up, in metres;
- origin at the package origin;
- oriented as placed on the top side at 0° rotation;
- seating plane at `y = 0`.

Per-model `offsetMm`, `rotationDeg` and `scale` correct models that deviate. They form the child node's transform: scale, then rotation about the model's X, then Y, then Z axis (fixed axes), then translation. Matching tries `part` first, then `package`; the first match wins.

A model's default scene is flattened into one mesh (node transforms baked into the vertices), so that every component using it shares the mesh. Positions, normals, the first texture coordinate and colour sets, indices and materials with their textures are kept; skins, morph targets, animations, cameras and lights are dropped.

### 6.10 Colours

Soldermask and silkscreen layers take their colour from the source when it states one; the other roles keep their defaults (§7). A layer's colour comes from the `Spec`s (in `CadHeader`) it refers to: its `Layer/SpecRef`s, then the `SpecRef`s of its `StackupLayer`s in the first stack-up, in document order. Of each spec, only `General` is read. The first rule that gives a colour wins:

1. An explicit colour: `General/Color`, or `General/ColorRef` into `DictionaryColor`. It is used as written (sRGB).
2. A colour name: `General/ColorTerm@name` (its `comment` when the name is `OTHER`), or a `General/Property@text` of the form `Color : <name>` as KiCad writes it. Names are matched case-insensitively, ignoring finish words (`Matte`, `Glossy`, `Satin`) and reading `Grey` as `Gray`, and stand for a realistic board colour:

   | Name | Soldermask | Silkscreen |
   |---|---|---|
   | Green | `#1E6B2E` | `#2F8F43` |
   | Red | `#A01C1C` | `#C62B23` |
   | Blue | `#1F4E9C` | `#2E5BB8` |
   | Purple | `#4F2373` | `#6B3E94` |
   | Black | `#151515` | `#1C1C1C` |
   | White | `#E9E9E6` | `#F2F2F2` |
   | Yellow | `#D4B417` | `#EED33A` |
   | Orange | `#C9601C` | `#E2782A` |
   | Brown | `#5C3A1F` | `#7A5030` |
   | Pink | `#C85A8A` | `#E68AAE` |
   | Gray | `#5B6066` | `#8C8C8C` |

   `#RRGGBB` and `#RRGGBBAA` (KiCad's user-defined colours) are used as written. `Not specified`, `User defined`, `OTHER` without a comment, `BOARD`, `BOARDPANEL` and empty names state no colour. Any other name gives the default and a warning.
3. Otherwise the default.

Notes:

- Names stand for realistic colours rather than an exporter's swatch. KiCad also writes RGB entries in `DictionaryColor` (its swatches: `0,0,128` for blue, `200,200,200` for white), but nothing refers to them, so they are not used.
- `ColorRef` in a `Set` is not a board colour: the consortium test cases use it for the CAD tool's display colours (red and blue copper, pink silkscreen). It is ignored.
- KiCad 9 writes `StackupLayer/SpecRef id="SPEC_<layer>"` but names the spec `<layer>_<n>`. A dangling reference `SPEC_<layer>` resolves to the spec named `<layer>_<digits>` if there is exactly one; such references are not reported.

### 6.11 Paste

- Layers with `layerFunction` `SOLDERPASTE` or `PASTEMASK` are paste layers (role `PASTE`). A paste layer with `side="BOTTOM"` is on the bottom side, any other on the top side. A side has at most one paste layer, the first in document order; the converter skips any other with a warning.
- Paste is material on the pads. Its features are prisms that stand on the outer copper surface of their side: from the top of the top copper up, or from the bottom of the bottom copper down. Their height is the layer's thickness in the stack-up if given (and not 0), else 100 µm, a common stencil thickness. Paste lies in the mask openings, so its Z range overlaps those of its side's soldermask and silkscreen (§6.4) without any geometry overlapping.
- Features are classified and linked like copper features (§6.2, §8.2); KiCad's paste pads, for one, reference their pins, including paste-only aperture pads, which it writes as package pins `PAD0`, `PAD1`, …. Holes are cut from paste like from the soldermask (§6.3). Paste is not clipped by mask openings.
- Paste layers are hidden by default (§8.3).

### 6.12 Drawings

- Layers with `layerFunction` `COURTYARD`, `ASSEMBLY` or `DOCUMENT` are drawings, with roles `COURTYARD`, `ASSEMBLY` and `DOCUMENTATION`. A drawing layer with `side="BOTTOM"` is on the bottom side, any other (`TOP`, `NONE`, `ALL`, …) on the top side.
- Each drawing layer is a sheet 10 µm thick, whatever the stack-up says. A side's drawing layers are stacked outward from the side's outer face (the outermost face of its other layers, paste included): first the assembly layers, then courtyard, then documentation, each group in document order. No drawing shares a Z range with another layer, so none z-fights with silkscreen, mask, paste or another drawing.
- Features are drawn as on silkscreen (§6.1), have kind `MARKING` and reference the component and net of their `Set` (§8.2). Drawings are not material: they are neither cut by holes nor clipped by mask openings.
- Paste and drawing layers without features in the converted step are omitted. Layers with other functions that are not part of the board's appearance (`GLUE`, `PROBE`, `VCUT`, `SCORE`, `BOARD_OUTLINE`, coatings, …) are not converted, and the converter reports them.
- Drawing layers are hidden by default (§8.3).

### 6.13 Package drawings

A `Package` may carry a `SilkScreen` and an `AssemblyDrawing`: `Outline`s and `Marking`s in the package frame. They are placed with each component like its pins: a `Marking`'s own `Location` and `Xform` first, then the component's (§6.8), so bottom-side parts are mirrored. They become `MARKING` features on a layer of the component's side, and reference the component (§8.2), so that selecting a component can show its outline.

- An `Outline` in a package drawing is the part's drawn outline: its line is drawn (a zero-width line as a hairline, §6.1), and its area is filled only if its polygon's `FillDesc` says `FILL`. `Marking`s are drawn as shapes are (§6.1), `Text` included, and a marking's feature has the strings of its `Text`s as `text` (§8.2).
- **Assembly drawings.** A side without an assembly layer with features gets `@assembly-top` or `@assembly-bottom`, if one of its components' packages has an assembly drawing. The layer holds the assembly drawings of the side's components: components in document order, each with its `Outline`s, then its `Marking`s. A side whose file has an assembly layer with features (KiCad's `F.Fab`) gets nothing from the packages, because that layer already shows them.
- **Silkscreen.** A component's package silkscreen is added to the silkscreen layer of its side only where that layer has nothing for the component: none of the layer's features references the component, and the layer's features cover less than 10 % of the package silkscreen's area. KiCad, which links silkscreen to components, and the IPC consortium test cases, which mostly copy package silkscreens into the layer without links, are drawn once. A side without a silkscreen layer gets `@silkscreen-top` or `@silkscreen-bottom` (default thickness, outside the soldermask), if one of its components' packages has a silkscreen, with all of them on it.
- The new features follow the layer's source features (§5), in component document order.

### 6.14 Panels

A panel is a step that places other steps with `StepRepeat` (IPC-2581C §8.2.3.5): boards, coupons or sub-panels, which may place steps in turn.

- **Converted step.** Unless the user names one, the converter converts the *root step*: the first step in `Content/StepRef` order (then in document order) that no `StepRepeat` references. Without `StepRepeat`s, that is the first `StepRef`, or the first step.
- **Copies.** A `StepRepeat` places `nx · ny` copies. Copy `(i, j)` (from 0) maps a point `p` of the referenced step to `(x + i·dx, y + j·dy) + R(angle) · F · (p − datum)` in the step that holds the `StepRepeat`. `datum` is the referenced step's `Datum` (the origin without one), `R(angle)` rotates counter-clockwise, and `F` mirrors about the Y axis when `mirror` is true. Copies of nested steps compose their maps.
- **Instances.** Every copy, at any depth, is an *instance* of its step, named `<step>-<k>`: `k` counts the copies of that step from 1, in the order the converter places them (the `StepRepeat`s of a step in document order, the copies of each with `i` varying fastest, and each copy's own copies right after it). A `StepRepeat` that would make a step contain itself is skipped with a warning.
- **Flipped copies.** A mirrored copy is turned over (the "flipped" pairing of IPC-2581C, which needs a symmetrical stack-up). Its features go to the counterpart of their layer: copper layer `k` of `n` (top first) to copper layer `n − 1 − k`, and a layer with side `TOP` or `BOTTOM` to the layer with the same role on the other side (the first with the first, in document order). Layers without a side keep their features. Features whose layer has no counterpart are skipped with a warning. Holes go to the drill layer with the mirrored span, or stay on their own if there is none. Components change side.
- **Content.** Each instance adds its step's features, holes and components, placed with its map, as the converted step's are: they are features of the same layers (§5, §6.2) and nodes under `components`. Nets are per instance: each board's `GND` is its own net. The board outline (§6.5, §6.7) is the union of the profiles of the converted step and of all instances.
- **Layers.** All instances use the converted file's stack-up. Paste and drawing layers (§6.11, §6.12) and synthesized package drawing layers (§6.13) exist if the converted step or any instance needs them; package drawings follow the side each component is placed on.

## 7. Materials

| Name | Used for | Default |
|---|---|---|
| `boardui/copper` | copper features, barrels | base `#C9A15A`, metallic 1.0, roughness 0.35 |
| `boardui/soldermask` | soldermask sheets | base `#1E6B2E`, alpha 0.85, `alphaMode: BLEND`, roughness 0.4 |
| `boardui/silkscreen` | silkscreen | base `#F2F2F2`, roughness 0.8 |
| `boardui/dielectric` | dielectric sheets | base `#C7B98A`, roughness 0.9 |
| `boardui/body` | placeholder bodies | base `#2B2B2B`, roughness 0.6 |
| `boardui/pin1` | pin-1 markers | base `#E0E0E0`, roughness 0.6 |
| `boardui/paste` | paste | base `#A4A7AB`, roughness 0.6 |
| `boardui/courtyard` | courtyard drawings | base `#C07AAE`, roughness 0.8 |
| `boardui/assembly` | assembly drawings | base `#7DB2C4`, roughness 0.8 |
| `boardui/documentation` | documentation drawings | base `#9FBF73`, roughness 0.8 |

- Materials MUST be shared: each name appears once.
- A colour from the source (§6.10) gives the layer the material `<name>/<rrggbb>`, for example `boardui/soldermask/1f4e9c`: the role's material with that base colour (lower-case sRGB hex in the name), keeping the role's alpha, metallic and roughness. Layers with the same colour share it; a colour equal to the default uses the default material.
- Viewers MAY restyle by material name. They SHOULD treat `boardui/<kind>/<rrggbb>` as `boardui/<kind>`.

## 8. Metadata

### 8.1 `EXT_mesh_features`

Every primitive of a layer or drill mesh MUST carry exactly one `featureIds` entry with:

- `attribute: 0` (vertex attribute `_FEATURE_ID_0`);
- `propertyTable`: that layer's feature table;
- `featureCount`: the number of distinct feature IDs in the primitive.

Feature IDs are row indices into the layer's feature table:

- The component type is `UNSIGNED_SHORT` when the table has fewer than 65,536 rows. Otherwise it is `FLOAT`, which is exact up to 2²⁴.
- glTF requires every vertex attribute element to start on a 4-byte boundary, so an `UNSIGNED_SHORT` feature ID attribute MUST NOT be tightly packed: its buffer view has a `byteStride` of 4 (or the attribute is interleaved with others). The Khronos validator reports a tightly packed one as `MESH_PRIMITIVE_ACCESSOR_UNALIGNED`.
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
| `instances` | `instance` | instance of a step in a panel (§6.14) |
| `<layer ID>` | `feature` | source feature of that layer (or drill layer) |

- Feature tables are named by their layer ID.
- **Empty tables.** `EXT_structural_metadata` property tables need at least one row, and glTF buffer views at least one byte. A table without rows is therefore omitted (and so is its index in `BOARDUI_board`), and so is an optional `STRING` property whose values are all empty (its `noData` is `""`; for example `pin.name` on a board without pin names).
- **References.** References between tables are row indices (`UINT32`); `4294967295` means none. For example, `feature.net` is a row in `nets`, and `pin.component` is a row in `components`.
- **Feature ID strings** are not stored. They derive from the layer name and `feature.source` (§5).
- **Linking features to pins and components.** A feature gets `pin` from the `PinRef` of its `Pad`, `component` from that `PinRef@componentRef` or else from its `Set@componentRef`, and `net` from its `Set@net`. A feature from a package drawing gets the component it was placed for (§6.13).
- **Pins.** A pin's `name` is the package `Pin@name`, else the `PinRef@title`. Its `net` is the net of the first feature that references it.
- **Fiducials.** A `FIDUCIAL` feature's `fiducial` is its IPC-2581 element: `GLOBAL`, `LOCAL`, `BAD_BOARD` or `GOOD_PANEL`. Other features have `NONE`, and a table without fiducials omits the property.
- **Text.** A feature's `text` is the `textString` of the `Text` elements its shape draws (directly, inside a `UserSpecial` or through a `UserPrimitiveRef`), in document order, joined by line feeds (U+000A). Other features have the empty string, and a table without text omits the property.
- **Instances.** Nets, components and features of an instance reference it with `instance`; the converted step's own have none, and a table without instance references omits the property. An instance row has the instance `id`, its `step`, the `parent` instance whose step placed it (none for copies placed by the converted step), and its placement: it maps a point `(u, v)` of its step to the board point `(x, y) + R(angle) · F · (u, v)` (IPC-2581 axes, metres, degrees counter-clockwise; `F` mirrors `u` when `side` is `BOTTOM`, a flipped copy).

### 8.3 `BOARDUI_board`

This is a root-level extension ([`schema/BOARDUI_board.schema.json`](schema/BOARDUI_board.schema.json)):

```json
"BOARDUI_board": {
  "profileVersion": "0.6",
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

- `layers` is ordered top to bottom. `thickness` is the copper-to-copper thickness.
- `tables.*` and `featureTable` are absent for tables without rows (§8.2). `tables.instances` is present only for panels (§6.14).
- `role` is one of `COPPER`, `DIELECTRIC`, `SOLDERMASK`, `SILKSCREEN`, `PASTE`, `COURTYARD`, `ASSEMBLY`, `DOCUMENTATION`. `ipcFunction` keeps the source `layerFunction`, and is absent for synthesized layers.
- `visible` is the suggested default visibility. Inner copper layers and the optional layers (paste and drawings, §6.11, §6.12) default to `false`, all other layers to `true`. Dielectric layers stay visible so that the board is opaque like a real one: with them hidden, the translucent soldermask (§7) would show the other side's copper and components through the board.

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
- `instance` is the ID of the component's instance (§6.14), absent for the converted step's own components.
- The other fields duplicate it so that generic tools (Blender custom properties, three.js `userData`) can show them. They MUST match the table.

## 9. Widget anchoring (informative)

A viewer resolves an ID to geometry as follows:

- **Feature:** layer table and row, then its vertex range (§8.1), then its bounding box.
- **Pin:** the union of its features.
- **Net:** the union of the bounding boxes of the features and barrels that reference it.
- **Instance:** the union of the bounding boxes of its features and components (§6.14).
- **Component:** the world bounding box of its node.

Anchors (for example top-centre of the bounding box) are computed from these.

## 10. Validation

`boardui validate <file.glb>` checks the rules of this profile:

- the extensions are declared as in §2;
- the scene structure follows §4, and IDs are unique and well-formed;
- feature IDs are contiguous and ascending within primitives;
- metadata references are in range, and component `extras` match the `components` table;
- `FIDUCIAL` features, and only they, have a fiducial type;
- instances are well-formed, and IDs and component node names carry their instance (§5, §6.14);
- per copper layer, the sum of feature areas equals the area of their union, within tolerance (§6.2). Feature areas are the areas of their top faces. Features may overlap by grid-rounding slivers where their boundaries cross, and float32 positions add rounding, so the sum may exceed the union by at most `δ · P`: `P` is the sum of the feature perimeters and `δ` is 20 nm (twice the converter's 10 nm grid) plus twice the float32 spacing at the board's largest coordinate;
- prisms are closed;
- layer Z ranges are ordered (§6.4).

It runs the Khronos validator too, when the `gltf_validator` binary is on `PATH`; CI always runs it. The validator (2.0.0-dev.3.10) doesn't know `EXT_mesh_features` and `EXT_structural_metadata`: it reports them as `UNSUPPORTED_EXTENSION` and their buffer views as `UNUSED_OBJECT` (both infos), so the rules of §8 are checked by `boardui validate` alone.

## 11. Versioning

`profileVersion` is `major.minor`. Minor versions only add optional data. Readers MUST reject an unknown major version and SHOULD accept an unknown minor version.

## 12. Open questions

- Geometry compression: `EXT_meshopt_compression` and `KHR_mesh_quantization` for stored files (native CLI only; see [architecture](../docs/architecture.md)).
- Whether pins need their own geometry anchor when a pad is split across layers (THT pads).
