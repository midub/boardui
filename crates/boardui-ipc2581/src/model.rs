//! The document model. All lengths are in metres, all angles in degrees.

use std::collections::HashSet;

use crate::{
    Color, Contour, Diagnostic, FillDesc, FillStyle, Font, LineDesc, LineStyle, Outline, Point,
    Shape, StandardPrimitive, Table, Xform,
};

/// A parsed IPC-2581 document.
#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    /// `IPC-2581@revision`, for example `C`.
    pub revision: String,
    /// `Content`: function mode, references and dictionaries.
    pub content: Content,
    /// `Ecad`: layers, stack-ups and steps.
    pub ecad: Ecad,
    /// Warnings about skipped or unresolved input.
    pub diagnostics: Vec<Diagnostic>,
}

/// `Content`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Content {
    /// `FunctionMode@mode`, for example `ASSEMBLY`.
    pub function_mode: Option<String>,
    /// `StepRef@name` values in document order.
    pub step_refs: Vec<String>,
    /// `LayerRef@name` values in document order.
    pub layer_refs: Vec<String>,
    /// `DictionaryStandard`, by entry id.
    pub standard_primitives: Table<StandardPrimitive>,
    /// `DictionaryUser`, by entry id. Each entry is the entry's user primitive, usually a
    /// [`Shape::UserSpecial`].
    pub user_primitives: Table<Shape>,
    /// `DictionaryLineDesc`, by entry id.
    pub line_descs: Table<LineDesc>,
    /// `DictionaryFillDesc`, by entry id.
    pub fill_descs: Table<FillDesc>,
    /// `DictionaryColor`, by entry id.
    pub colors: Table<Color>,
    /// `DictionaryFont`, by entry id.
    pub fonts: Table<Font>,
}

impl Content {
    /// Resolves a stroke to its descriptor: inline, or looked up in
    /// [`line_descs`](Self::line_descs).
    pub fn line_desc<'a>(&'a self, style: &'a LineStyle) -> Option<&'a LineDesc> {
        match style {
            LineStyle::Desc(desc) => Some(desc),
            LineStyle::Ref(id) => self.line_descs.get(id),
        }
    }

    /// Resolves a fill to its descriptor: inline, or looked up in
    /// [`fill_descs`](Self::fill_descs).
    pub fn fill_desc<'a>(&'a self, style: &'a FillStyle) -> Option<&'a FillDesc> {
        match style {
            FillStyle::Desc(desc) => Some(&**desc),
            FillStyle::Ref(id) => self.fill_descs.get(id),
        }
    }
}

/// `Ecad` with its `CadHeader` and `CadData`.
#[derive(Debug, Clone, PartialEq)]
pub struct Ecad {
    /// `Ecad@name`.
    pub name: String,
    /// `CadHeader@units`: the units of the source file. The model is always in metres.
    pub units: Units,
    /// `CadHeader/Spec`s, by name, in document order.
    pub specs: Table<Spec>,
    /// `Layer`s, by name, in document order.
    pub layers: Table<Layer>,
    /// `Stackup`s in document order.
    pub stackups: Vec<Stackup>,
    /// `Step`s, by name, in document order.
    pub steps: Table<Step>,
}

/// Length units of the source file (`CadHeader@units`, dictionary `units`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Units {
    /// `INCH`.
    Inch,
    /// `MILLIMETER`.
    Millimeter,
    /// `MICRON`.
    Micron,
}

impl Units {
    /// The length of one unit in metres.
    pub fn metres(self) -> f64 {
        match self {
            Self::Inch => 0.0254,
            Self::Millimeter => 1e-3,
            Self::Micron => 1e-6,
        }
    }
}

/// `Layer`.
#[derive(Debug, Clone, PartialEq)]
pub struct Layer {
    /// `name`.
    pub name: String,
    /// `layerFunction` as written, for example `CONDUCTOR`, `DRILL` or `SILKSCREEN`. The list
    /// of values differs between revisions, so it is kept verbatim.
    pub function: String,
    /// `side`, if given.
    pub side: Option<Side>,
    /// `polarity`. Absent: [`Polarity::Positive`].
    pub polarity: Polarity,
    /// `Span`: the layers a drill or rout layer spans.
    pub span: Option<Span>,
    /// `SpecRef@id` values in document order.
    pub spec_refs: Vec<String>,
}

/// `side` of a layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    /// `TOP`.
    Top,
    /// `BOTTOM`.
    Bottom,
    /// `BOTH`.
    Both,
    /// `INTERNAL`.
    Internal,
    /// `ALL`.
    All,
    /// `NONE`.
    None,
}

/// `polarity` of a layer or set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Polarity {
    /// `POSITIVE`: adds material.
    #[default]
    Positive,
    /// `NEGATIVE`: removes material.
    Negative,
}

/// `Span` of a layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Span {
    /// `fromLayer`.
    pub from_layer: String,
    /// `toLayer`.
    pub to_layer: String,
}

/// `Stackup`.
#[derive(Debug, Clone, PartialEq)]
pub struct Stackup {
    /// `name`.
    pub name: String,
    /// `overallThickness`, if given.
    pub overall_thickness: Option<f64>,
    /// `tolPlus`, if given.
    pub tol_plus: Option<f64>,
    /// `tolMinus`, if given.
    pub tol_minus: Option<f64>,
    /// `whereMeasured`, if given.
    pub where_measured: Option<WhereMeasured>,
    /// `StackupGroup`s in document order.
    pub groups: Vec<StackupGroup>,
}

/// `whereMeasured` of a [`Stackup`]: what the overall thickness includes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhereMeasured {
    /// `METAL`: outer copper to outer copper.
    Metal,
    /// `MASK`: over the soldermask.
    Mask,
    /// `LAMINATE`: the laminate only.
    Laminate,
    /// `OTHER`.
    Other,
}

/// `StackupGroup`.
#[derive(Debug, Clone, PartialEq)]
pub struct StackupGroup {
    /// `name`.
    pub name: String,
    /// `thickness`, if given.
    pub thickness: Option<f64>,
    /// `tolPlus`, if given.
    pub tol_plus: Option<f64>,
    /// `tolMinus`, if given.
    pub tol_minus: Option<f64>,
    /// `StackupLayer`s in document order.
    pub layers: Vec<StackupLayer>,
}

/// `StackupLayer`.
#[derive(Debug, Clone, PartialEq)]
pub struct StackupLayer {
    /// `layerOrGroupRef`: a layer name or a stack-up group name.
    pub layer_or_group_ref: String,
    /// `thickness`, if given.
    pub thickness: Option<f64>,
    /// `tolPlus`, if given.
    pub tol_plus: Option<f64>,
    /// `tolMinus`, if given.
    pub tol_minus: Option<f64>,
    /// `sequence`: position in the stack, top first, if given.
    pub sequence: Option<u32>,
    /// `materialType` (revision A), for example `Copper` or `FR-4`, if given.
    pub material_type: Option<String>,
    /// `SpecRef@id` values in document order.
    pub spec_refs: Vec<String>,
}

/// `Spec` in `CadHeader`: a named specification that layers refer to with `SpecRef`.
#[derive(Debug, Clone, PartialEq)]
pub struct Spec {
    /// `name`.
    pub name: String,
    /// `General` specifications in document order. Other specifications (`Conductor`,
    /// `Dielectric`, `SurfaceFinish`, …) are skipped.
    pub general: Vec<SpecGeneral>,
}

/// `General` in a [`Spec`].
#[derive(Debug, Clone, PartialEq)]
pub struct SpecGeneral {
    /// `type` as written, for example `MATERIAL`.
    pub general_type: String,
    /// `Property` elements in document order.
    pub properties: Vec<SpecProperty>,
    /// The colour (`Color`, `ColorRef` or `ColorTerm`), if given.
    pub color: Option<SpecColor>,
}

/// `Property` of a [`SpecGeneral`], with its attributes as written.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SpecProperty {
    /// `text`, if given. KiCad writes colours as `Color : <name>`.
    pub text: Option<String>,
    /// `value`, if given.
    pub value: Option<String>,
    /// `unit`, if given.
    pub unit: Option<String>,
}

/// A colour (`ColorGroup`) of a [`SpecGeneral`] or a [`Text`](crate::Text).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpecColor {
    /// An inline `Color`.
    Rgb(Color),
    /// `ColorRef@id`: an entry of [`Content::colors`].
    Ref(String),
    /// `ColorTerm`: a colour by name.
    Term {
        /// `name` as written, for example `BLUE`.
        name: String,
        /// `comment`, if given.
        comment: Option<String>,
    },
}

/// `Step`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Step {
    /// `name`.
    pub name: String,
    /// `Datum`, if given.
    pub datum: Option<Point>,
    /// `Profile`: board outline with cutouts, if given.
    pub profile: Option<Contour>,
    /// `StepRepeat`s in document order: copies of other steps placed in this one, for a panel
    /// or array.
    pub step_repeats: Vec<StepRepeat>,
    /// `PadStack`s in document order (revisions A and B; revision C has none).
    pub pad_stacks: Vec<PadStack>,
    /// `PadStackDef`s, by name.
    pub padstack_defs: Table<PadstackDef>,
    /// `Package`s, by name.
    pub packages: Table<Package>,
    /// `Component`s, by refDes.
    pub components: Table<Component>,
    /// `LayerFeature`s, by layer name. Several `LayerFeature` elements for the same layer are
    /// merged into one entry, in document order.
    pub layer_features: Table<LayerFeature>,
}

/// `StepRepeat`: an array of copies of another step (IPC-2581C §8.2.3.5).
///
/// Copy `(i, j)`, for `i` in `0..nx` and `j` in `0..ny`, places the referenced step's
/// `Datum` at `location + (i·dx, j·dy)`, mirrored about its Y axis if `mirror`, then
/// rotated counter-clockwise by `angle`.
#[derive(Debug, Clone, PartialEq)]
pub struct StepRepeat {
    /// `stepRef`: the name of the repeated step.
    pub step_ref: String,
    /// `x`, `y`: where the first copy's datum lands.
    pub location: Point,
    /// `nx`: copies along X, including the first. Absent: 1.
    pub nx: u32,
    /// `ny`: copies along Y, including the first. Absent: 1.
    pub ny: u32,
    /// `dx`: distance between copies along X. Absent: 0.
    pub dx: f64,
    /// `dy`: distance between copies along Y. Absent: 0.
    pub dy: f64,
    /// `angle`: counter-clockwise rotation, in degrees. Absent: 0.
    pub angle: f64,
    /// `mirror`: the copies are mirrored (flipped over). Absent: false.
    pub mirror: bool,
}

impl Step {
    /// Distinct `Set@net` names over all layer features, in order of first appearance.
    pub fn nets(&self) -> Vec<&str> {
        let mut seen = HashSet::new();
        self.layer_features
            .values()
            .flat_map(|lf| &lf.sets)
            .filter_map(|set| set.net.as_deref())
            .filter(|net| seen.insert(*net))
            .collect()
    }
}

/// `PadStack` (revisions A and B): a placed padstack, with its hole and its pad on each layer.
/// Revision C has no such element; its pads and holes are `LayerFeature` features.
#[derive(Debug, Clone, PartialEq)]
pub struct PadStack {
    /// `net`, if given.
    pub net: Option<String>,
    /// `LayerHole`, if the padstack is drilled.
    pub hole: Option<LayerHole>,
    /// `LayerPad`s in document order.
    pub pads: Vec<LayerPad>,
}

/// `LayerHole`: the hole of a [`PadStack`].
#[derive(Debug, Clone, PartialEq)]
pub struct LayerHole {
    /// The hole: `name`, `diameter`, `platingStatus`, tolerances and centre.
    pub hole: Hole,
    /// `Span`: the copper layers the hole runs between, if given.
    pub span: Option<Span>,
}

/// `LayerPad`: the pad of a [`PadStack`] on one layer.
#[derive(Debug, Clone, PartialEq)]
pub struct LayerPad {
    /// `layerRef`.
    pub layer_ref: String,
    /// `Location`. Absent: the origin.
    pub location: Point,
    /// `Xform`. Absent: identity.
    pub xform: Xform,
    /// The pad shape.
    pub shape: Shape,
    /// `PinRef`, if the pad belongs to a component pin.
    pub pin_ref: Option<PinRef>,
}

/// `PadStackDef`: a padstack definition.
#[derive(Debug, Clone, PartialEq)]
pub struct PadstackDef {
    /// `name`.
    pub name: String,
    /// `PadstackHoleDef`, if the padstack is drilled.
    pub hole: Option<Hole>,
    /// `PadstackPadDef`s in document order.
    pub pads: Vec<PadstackPad>,
}

/// `PadstackPadDef`: the pad of a padstack on one layer.
#[derive(Debug, Clone, PartialEq)]
pub struct PadstackPad {
    /// `layerRef`.
    pub layer_ref: String,
    /// `padUse`.
    pub pad_use: PadUse,
    /// `Location`. Absent: the origin.
    pub location: Point,
    /// `Xform`. Absent: identity.
    pub xform: Xform,
    /// The pad shape, if given.
    pub shape: Option<Shape>,
}

/// `padUse` of a [`PadstackPad`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PadUse {
    /// `REGULAR`.
    Regular,
    /// `ANTIPAD`: clearance in a plane.
    Antipad,
    /// `THERMAL`: thermal relief in a plane.
    Thermal,
    /// `OTHER`.
    Other,
}

/// `Package`: a footprint.
#[derive(Debug, Clone, PartialEq)]
pub struct Package {
    /// `name`.
    pub name: String,
    /// `type` as written, for example `SOIC`, if given.
    pub package_type: Option<String>,
    /// `height`, if given.
    pub height: Option<f64>,
    /// `pinOne`: number of pin 1, if given. A package without pins may name any; it is not
    /// checked.
    pub pin_one: Option<String>,
    /// `Outline`: the body outline, if given.
    pub outline: Option<Outline>,
    /// `Pin`s, by number.
    pub pins: Table<Pin>,
    /// `SilkScreen`, if given.
    pub silkscreen: Option<PackageDrawing>,
    /// `AssemblyDrawing`, if given.
    pub assembly_drawing: Option<PackageDrawing>,
}

/// A package `Pin`.
#[derive(Debug, Clone, PartialEq)]
pub struct Pin {
    /// `number`.
    pub number: String,
    /// `name`, if given.
    pub name: Option<String>,
    /// `Location` relative to the package origin. Absent: the origin.
    pub location: Point,
    /// `Xform`. Absent: identity.
    pub xform: Xform,
    /// The pin shape, if given.
    pub shape: Option<Shape>,
}

/// `SilkScreen` or `AssemblyDrawing` of a package.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PackageDrawing {
    /// `Outline`s in document order.
    pub outlines: Vec<Outline>,
    /// `Marking`s in document order.
    pub markings: Vec<Marking>,
}

/// `Marking`: a graphic in a package drawing.
#[derive(Debug, Clone, PartialEq)]
pub struct Marking {
    /// `markingUsage` as written, for example `REFDES`, if given.
    pub usage: Option<String>,
    /// `Location`. Absent: the origin.
    pub location: Point,
    /// `Xform`. Absent: identity.
    pub xform: Xform,
    /// The graphic.
    pub shape: Shape,
}

/// A placed `Component`.
#[derive(Debug, Clone, PartialEq)]
pub struct Component {
    /// `refDes`.
    pub ref_des: String,
    /// `packageRef`.
    pub package_ref: String,
    /// `layerRef`: the layer it is mounted on.
    pub layer_ref: String,
    /// `part`, if given.
    pub part: Option<String>,
    /// `mountType`, if given.
    pub mount_type: Option<MountType>,
    /// `standoff`: body clearance above the board, if given.
    pub standoff: Option<f64>,
    /// `height`, if given.
    pub height: Option<f64>,
    /// `Location`. Absent: the origin.
    pub location: Point,
    /// `Xform`. Absent: identity.
    pub xform: Xform,
}

/// `mountType` of a component.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MountType {
    /// `SMT`: surface mount.
    Smt,
    /// `THMT`: through-hole.
    Thmt,
    /// `OTHER`.
    Other,
}

/// All `LayerFeature` content of a step for one layer.
#[derive(Debug, Clone, PartialEq)]
pub struct LayerFeature {
    /// `layerRef`.
    pub layer_ref: String,
    /// `Set`s in document order.
    pub sets: Vec<Set>,
}

impl LayerFeature {
    /// Iterates over the layer's source features in document order, with their set.
    pub fn features(&self) -> impl Iterator<Item = (&Set, &Feature)> {
        self.sets
            .iter()
            .flat_map(|set| set.features.iter().map(move |f| (set, f)))
    }

    /// Number of source features on the layer.
    pub fn feature_count(&self) -> usize {
        self.sets.iter().map(|s| s.features.len()).sum()
    }
}

/// `Set`: features sharing net, polarity and usage.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Set {
    /// `net`, if given.
    pub net: Option<String>,
    /// `polarity`. Absent: [`Polarity::Positive`].
    pub polarity: Polarity,
    /// `padUsage`, if given.
    pub pad_usage: Option<PadUsage>,
    /// `testPoint`. Absent: `false`.
    pub test_point: bool,
    /// `geometry`: name of the originating geometry, if given.
    pub geometry: Option<String>,
    /// `geometryUsage` as written, for example `TEXT`, if given.
    pub geometry_usage: Option<String>,
    /// `plate`. Absent: `false`.
    pub plate: bool,
    /// `componentRef`, if given.
    pub component_ref: Option<String>,
    /// `ColorRef@id`, if given.
    pub color_ref: Option<String>,
    /// `Pad`, `Features`, fiducial, `Hole` and `SlotCavity` children in document order.
    pub features: Vec<Feature>,
}

/// `padUsage` of a [`Set`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PadUsage {
    /// `TERMINATION`: component pads.
    Termination,
    /// `VIA`: via lands.
    Via,
    /// Any other value, as written.
    Other(String),
}

/// A source feature of a layer (spec §5).
#[derive(Debug, Clone, PartialEq)]
pub struct Feature {
    /// 0-based index among the layer's `Pad`, `Features`, fiducial, `Hole` and `SlotCavity`
    /// elements in document order, counted over all `LayerFeature` elements of the layer in the
    /// step.
    pub source: usize,
    /// The element.
    pub element: FeatureElement,
}

/// The element of a [`Feature`].
#[derive(Debug, Clone, PartialEq)]
pub enum FeatureElement {
    /// `Pad`.
    Pad(Pad),
    /// `Features`.
    Features(Features),
    /// A `Fiducial`: `GlobalFiducial`, `LocalFiducial`, `BadBoardMark` or `GoodPanelMark`.
    Fiducial(Fiducial),
    /// `Hole`.
    Hole(Hole),
    /// `SlotCavity`.
    SlotCavity(SlotCavity),
}

/// `Pad`.
#[derive(Debug, Clone, PartialEq)]
pub struct Pad {
    /// `padstackDefRef`, if given.
    pub padstack_def_ref: Option<String>,
    /// `Location`. Absent: the origin.
    pub location: Point,
    /// `Xform`. Absent: identity.
    pub xform: Xform,
    /// The pad shape, if given.
    pub shape: Option<Shape>,
    /// `PinRef`s in document order.
    pub pin_refs: Vec<PinRef>,
}

/// `PinRef`: the component pin a pad belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinRef {
    /// `componentRef`, if given.
    pub component_ref: Option<String>,
    /// `pin`: the pin number.
    pub pin: String,
    /// `title`, if given.
    pub title: Option<String>,
}

/// `Features`: one shape at a location.
#[derive(Debug, Clone, PartialEq)]
pub struct Features {
    /// `Location`. Absent: the origin.
    pub location: Point,
    /// `Xform`. Absent: identity.
    pub xform: Xform,
    /// The shape.
    pub shape: Shape,
}

/// A fiducial (`Fiducial` substitution group): a standard shape at a location.
#[derive(Debug, Clone, PartialEq)]
pub struct Fiducial {
    /// Which element of the substitution group.
    pub kind: FiducialKind,
    /// `Location`. Absent: the origin.
    pub location: Point,
    /// `Xform`. Absent: identity.
    pub xform: Xform,
    /// The shape: a `StandardPrimitive` or `StandardPrimitiveRef`.
    pub shape: Shape,
}

/// The element of a [`Fiducial`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FiducialKind {
    /// `GlobalFiducial`: positions the features of a board, assembly or panel.
    Global,
    /// `LocalFiducial`: positions one component.
    Local,
    /// `BadBoardMark`: covered to flag a defective board in a panel.
    BadBoard,
    /// `GoodPanelMark`: flags a panel whose boards are all good.
    GoodPanel,
}

/// `Hole` (in a `Set`) or `PadstackHoleDef` (in a `PadStackDef`).
#[derive(Debug, Clone, PartialEq)]
pub struct Hole {
    /// `name`.
    pub name: String,
    /// `diameter`.
    pub diameter: f64,
    /// `platingStatus`.
    pub plating: PlatingStatus,
    /// `plusTol`.
    pub plus_tol: f64,
    /// `minusTol`.
    pub minus_tol: f64,
    /// `x`, `y`: the centre.
    pub position: Point,
}

/// `platingStatus` of a hole or slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlatingStatus {
    /// `PLATED`.
    Plated,
    /// `NONPLATED`.
    NonPlated,
    /// `VIA`: plated via.
    Via,
}

/// `SlotCavity`: a slot or cavity given by a shape.
#[derive(Debug, Clone, PartialEq)]
pub struct SlotCavity {
    /// `name`.
    pub name: String,
    /// `platingStatus`.
    pub plating: PlatingStatus,
    /// `plusTol`.
    pub plus_tol: f64,
    /// `minusTol`.
    pub minus_tol: f64,
    /// `Location`. Absent: the origin.
    pub location: Point,
    /// `Xform`. Absent: identity.
    pub xform: Xform,
    /// The slot outline.
    pub shape: Shape,
}
