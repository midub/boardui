//! Shapes, descriptors and transforms. All lengths are in metres, all angles in degrees.

/// A point in board coordinates, in metres.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Point {
    /// X coordinate.
    pub x: f64,
    /// Y coordinate.
    pub y: f64,
}

/// An `Xform`: transform applied to a shape before it is placed at its location.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Xform {
    /// `xOffset`, `yOffset`. Absent attributes are 0.
    pub offset: Point,
    /// `rotation` in degrees, counter-clockwise. Absent: 0.
    pub rotation: f64,
    /// `mirror`: mirrored about the Y axis. Absent: `false`.
    pub mirror: bool,
    /// `scale` factor. Absent: 1.
    pub scale: f64,
}

impl Default for Xform {
    /// The identity transform, used where an element has no `Xform`.
    fn default() -> Self {
        Self {
            offset: Point::default(),
            rotation: 0.0,
            mirror: false,
            scale: 1.0,
        }
    }
}

/// A shape, as found in `Features`, pads, pins, markings, slots and user primitives.
#[derive(Debug, Clone, PartialEq)]
pub enum Shape {
    /// `StandardPrimitiveRef`: id of an entry in
    /// [`Content::standard_primitives`](crate::Content::standard_primitives).
    StandardRef(String),
    /// `UserPrimitiveRef`: id of an entry in
    /// [`Content::user_primitives`](crate::Content::user_primitives).
    UserRef(String),
    /// An inline standard primitive.
    Standard(StandardPrimitive),
    /// An inline `UserSpecial`: a group of shapes.
    UserSpecial(Vec<Shape>),
    /// `Line`.
    Line(Line),
    /// `Arc`.
    Arc(Arc),
    /// `Polyline`.
    Polyline(Polyline),
    /// `Polygon`.
    Polygon(Polygon),
    /// `Outline`: a stroked polygon outline.
    Outline(Outline),
    /// A shape element the reader cannot describe, for example `Text`. A
    /// [`UnsupportedShape`](crate::DiagnosticKind::UnsupportedShape) warning was recorded.
    Unsupported {
        /// Local name of the element.
        element: String,
    },
}

/// A standard primitive, inline or as a `DictionaryStandard` entry.
#[derive(Debug, Clone, PartialEq)]
pub struct StandardPrimitive {
    /// Shape and dimensions.
    pub kind: PrimitiveKind,
    /// Stroke, if the primitive has a `LineDesc` or `LineDescRef`.
    pub line: Option<LineStyle>,
    /// Fill, if the primitive has a `FillDesc` or `FillDescRef`.
    pub fill: Option<FillStyle>,
}

/// The shape of a [`StandardPrimitive`]. Shapes are centred on the origin unless noted.
#[derive(Debug, Clone, PartialEq)]
pub enum PrimitiveKind {
    /// `Circle`.
    Circle {
        /// `diameter`.
        diameter: f64,
    },
    /// `RectCenter`: rectangle centred on the origin.
    RectCenter {
        /// `width` (X).
        width: f64,
        /// `height` (Y).
        height: f64,
    },
    /// `RectCorner`: rectangle given by two corners.
    RectCorner {
        /// `lowerLeftX`, `lowerLeftY`.
        lower_left: Point,
        /// `upperRightX`, `upperRightY`.
        upper_right: Point,
    },
    /// `RectRound`: rectangle with rounded corners.
    RectRound {
        /// `width` (X).
        width: f64,
        /// `height` (Y).
        height: f64,
        /// `radius` of the rounded corners.
        radius: f64,
        /// Which corners are rounded.
        corners: Corners,
    },
    /// `RectCham`: rectangle with chamfered corners.
    RectCham {
        /// `width` (X).
        width: f64,
        /// `height` (Y).
        height: f64,
        /// `chamfer`: leg length of the chamfer.
        chamfer: f64,
        /// Which corners are chamfered.
        corners: Corners,
    },
    /// `Oval`: stadium (rectangle with semicircular ends on the shorter sides).
    Oval {
        /// `width` (X).
        width: f64,
        /// `height` (Y).
        height: f64,
    },
    /// `Ellipse`.
    Ellipse {
        /// `width` (X).
        width: f64,
        /// `height` (Y).
        height: f64,
    },
    /// `Diamond`: rhombus with vertices on the axes.
    Diamond {
        /// `width` (X).
        width: f64,
        /// `height` (Y).
        height: f64,
    },
    /// `Octagon`: regular octagon.
    Octagon {
        /// `length`.
        length: f64,
    },
    /// `Hexagon`: regular hexagon with a corner pointing up (+Y).
    Hexagon {
        /// `length`: distance between opposite corners.
        length: f64,
    },
    /// `Triangle`: isosceles triangle.
    Triangle {
        /// `base` (X).
        base: f64,
        /// `height` (Y).
        height: f64,
    },
    /// `Donut`: ring.
    Donut {
        /// `shape` of the ring.
        shape: RingShape,
        /// `outerDiameter`.
        outer_diameter: f64,
        /// `innerDiameter`.
        inner_diameter: f64,
    },
    /// `Thermal`: ring broken by spokes.
    Thermal {
        /// `shape` of the ring.
        shape: RingShape,
        /// `outerDiameter`.
        outer_diameter: f64,
        /// `innerDiameter`.
        inner_diameter: f64,
        /// `spokeCount`, if given.
        spoke_count: Option<u32>,
        /// `gap`: width of the spokes' gaps, if given.
        gap: Option<f64>,
        /// `spokeStartAngle` in degrees, if given.
        spoke_start_angle: Option<f64>,
    },
    /// `Butterfly`: two opposite quadrants of a circle or square.
    Butterfly {
        /// `shape`.
        shape: ButterflyShape,
        /// `diameter` for [`ButterflyShape::Round`], `side` for [`ButterflyShape::Square`].
        size: f64,
    },
    /// `Moire`: concentric rings, optionally with a crosshair.
    Moire(Moire),
    /// `Contour`: polygon with cutouts.
    Contour(Box<Contour>),
    /// A standard primitive the reader cannot describe, for example an element from a newer
    /// revision. A [`UnsupportedShape`](crate::DiagnosticKind::UnsupportedShape) warning was
    /// recorded.
    Unsupported {
        /// Local name of the element.
        element: String,
    },
}

/// [`PrimitiveKind::Moire`]: a registration target.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Moire {
    /// `diameter`: diameter of the centre line of the outermost ring.
    pub diameter: f64,
    /// `ringWidth`: line width of each ring.
    pub ring_width: f64,
    /// `ringGap`: distance between the centre lines of neighbouring rings.
    pub ring_gap: f64,
    /// `ringNumber`: number of rings.
    pub ring_number: u32,
    /// `lineWidth` of the crosshair. Absent: 0, no crosshair.
    pub line_width: f64,
    /// `lineLength` of both crosshair lines, if given.
    pub line_length: Option<f64>,
    /// `lineAngle`: counter-clockwise rotation of the crosshair in degrees. Absent: 0.
    pub line_angle: f64,
}

/// Corner flags of [`PrimitiveKind::RectRound`] and [`PrimitiveKind::RectCham`].
///
/// An absent flag reads as `true`, so a primitive without flags is rounded or chamfered at
/// every corner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Corners {
    /// `upperRight`.
    pub upper_right: bool,
    /// `upperLeft`.
    pub upper_left: bool,
    /// `lowerRight`.
    pub lower_right: bool,
    /// `lowerLeft`.
    pub lower_left: bool,
}

/// `shape` of a `Donut` or `Thermal`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RingShape {
    /// `ROUND`.
    Round,
    /// `SQUARE`.
    Square,
    /// `HEXAGON`.
    Hexagon,
    /// `OCTAGON`.
    Octagon,
}

/// `shape` of a `Butterfly`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ButterflyShape {
    /// `ROUND`.
    Round,
    /// `SQUARE`.
    Square,
}

/// `Line`: a stroked straight segment.
#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    /// `startX`, `startY`.
    pub start: Point,
    /// `endX`, `endY`.
    pub end: Point,
    /// Stroke.
    pub line: LineStyle,
}

/// `Arc`: a stroked circular arc.
#[derive(Debug, Clone, PartialEq)]
pub struct Arc {
    /// `startX`, `startY`.
    pub start: Point,
    /// `endX`, `endY`.
    pub end: Point,
    /// `centerX`, `centerY`.
    pub center: Point,
    /// `clockwise`: direction from start to end.
    pub clockwise: bool,
    /// Stroke.
    pub line: LineStyle,
}

/// A path: `PolyBegin` followed by `PolyStepSegment` / `PolyStepCurve` steps.
#[derive(Debug, Clone, PartialEq)]
pub struct Path {
    /// `PolyBegin`.
    pub start: Point,
    /// Steps in document order.
    pub steps: Vec<PolyStep>,
}

/// One step of a [`Path`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PolyStep {
    /// `PolyStepSegment`: straight segment to `to`.
    Segment {
        /// `x`, `y`.
        to: Point,
    },
    /// `PolyStepCurve`: circular arc to `to` around `center`.
    Curve {
        /// `x`, `y`.
        to: Point,
        /// `centerX`, `centerY`.
        center: Point,
        /// `clockwise`.
        clockwise: bool,
    },
}

/// `Polyline`: a stroked open path.
#[derive(Debug, Clone, PartialEq)]
pub struct Polyline {
    /// The path.
    pub path: Path,
    /// Stroke.
    pub line: LineStyle,
}

/// `Polygon`: a closed path.
#[derive(Debug, Clone, PartialEq)]
pub struct Polygon {
    /// The path.
    pub path: Path,
    /// Stroke, if given.
    pub line: Option<LineStyle>,
    /// Fill, if given.
    pub fill: Option<FillStyle>,
}

/// `Outline`: a polygon drawn as a stroked outline.
#[derive(Debug, Clone, PartialEq)]
pub struct Outline {
    /// The polygon.
    pub polygon: Polygon,
    /// Stroke.
    pub line: LineStyle,
}

/// `Contour` (and a step `Profile`): a polygon with cutouts.
#[derive(Debug, Clone, PartialEq)]
pub struct Contour {
    /// The outer `Polygon`.
    pub polygon: Polygon,
    /// `Cutout` paths, in document order.
    pub cutouts: Vec<Path>,
}

/// A stroke: an inline `LineDesc` or a `LineDescRef`.
#[derive(Debug, Clone, PartialEq)]
pub enum LineStyle {
    /// Inline `LineDesc`.
    Desc(LineDesc),
    /// `LineDescRef`: id of an entry in [`Content::line_descs`](crate::Content::line_descs).
    Ref(String),
}

/// A fill: an inline `FillDesc` or a `FillDescRef`.
#[derive(Debug, Clone, PartialEq)]
pub enum FillStyle {
    /// Inline `FillDesc`.
    Desc(Box<FillDesc>),
    /// `FillDescRef`: id of an entry in [`Content::fill_descs`](crate::Content::fill_descs).
    Ref(String),
}

/// `LineDesc`: stroke width, end style and pattern.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LineDesc {
    /// `lineWidth`.
    pub width: f64,
    /// `lineEnd`.
    pub end: LineEnd,
    /// `lineProperty`. Absent: [`LineProperty::Solid`].
    pub property: LineProperty,
}

/// `lineEnd` of a [`LineDesc`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineEnd {
    /// `ROUND`.
    Round,
    /// `SQUARE`: extended by half the width.
    Square,
    /// `NONE`: flat, ending at the end point.
    None,
}

/// `lineProperty` of a [`LineDesc`]: the pattern along the line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LineProperty {
    /// `SOLID`.
    #[default]
    Solid,
    /// `DOTTED`.
    Dotted,
    /// `DASHED`.
    Dashed,
    /// `CENTER`: long dashes and dots.
    Center,
    /// `PHANTOM`: long dashes and pairs of dots.
    Phantom,
    /// `ERASE`: a solid line that erases what is drawn beneath it.
    Erase,
}

/// `FillDesc`: how a closed shape is filled.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FillDesc {
    /// `fillProperty`.
    pub property: FillProperty,
    /// `lineWidth` of hatch or mesh lines, if given.
    pub line_width: Option<f64>,
    /// `pitch1`, if given.
    pub pitch1: Option<f64>,
    /// `pitch2`, if given.
    pub pitch2: Option<f64>,
    /// `angle1` in degrees, if given.
    pub angle1: Option<f64>,
    /// `angle2` in degrees, if given.
    pub angle2: Option<f64>,
}

/// `fillProperty` of a [`FillDesc`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FillProperty {
    /// `FILL`: solid.
    Fill,
    /// `HOLLOW`: outline only.
    Hollow,
    /// `HATCH`: parallel lines.
    Hatch,
    /// `MESH`: crossed lines.
    Mesh,
    /// `VOID`: no fill.
    Void,
}

/// `Color` of an `EntryColor`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Color {
    /// `r`.
    pub r: u8,
    /// `g`.
    pub g: u8,
    /// `b`.
    pub b: u8,
}
