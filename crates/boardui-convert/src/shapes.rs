//! IPC-2581 shapes to `boardui-geom` shapes, with `Location` and `Xform` applied.

use boardui_geom::{ArcDirection, DVec2, LineCap, Path, Shape, Stroke, Tolerance};
use boardui_ipc2581 as ipc;
use glam::DAffine2;
use ipc::{FillProperty, LineEnd, PrimitiveKind, RingShape};
use std::f64::consts::{FRAC_PI_2, PI, TAU};

/// How deep `UserPrimitiveRef`s may nest before the shape is given up as cyclic.
const MAX_DEPTH: usize = 16;

/// The order in which an `Xform` mirrors and rotates.
///
/// IPC-2581 exporters disagree for mirrored elements (bottom-side components and their
/// pads), and the two orders differ unless the rotation is a multiple of 180°. The pads of
/// a file show which one it uses (see [`detect_mirror_order`](crate::components)).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MirrorOrder {
    /// Mirror about the Y axis, then rotate counter-clockwise (KiCad).
    MirrorThenRotate,
    /// Rotate counter-clockwise, then mirror about the Y axis; the rotation reads clockwise
    /// in the top view (the IPC consortium test cases).
    RotateThenMirror,
}

/// Builds the affine map of an `Xform` placed at `location`: scale, rotate and mirror in
/// `order`, then offset and translate.
pub fn placement(location: ipc::Point, xform: &ipc::Xform, order: MirrorOrder) -> DAffine2 {
    let mirror = if xform.mirror {
        DAffine2::from_scale(DVec2::new(-1.0, 1.0))
    } else {
        DAffine2::IDENTITY
    };
    let rotation = DAffine2::from_angle(xform.rotation.to_radians());
    let linear = match order {
        MirrorOrder::MirrorThenRotate => rotation * mirror,
        MirrorOrder::RotateThenMirror => mirror * rotation,
    };
    DAffine2::from_translation(point(location) + point(xform.offset))
        * linear
        * DAffine2::from_scale(DVec2::splat(xform.scale))
}

/// Converts an IPC-2581 point.
pub fn point(p: ipc::Point) -> DVec2 {
    DVec2::new(p.x, p.y)
}

/// Whether a shape draws lines (strokes) rather than areas. Used to classify traces.
pub fn is_stroke(shape: &ipc::Shape, content: &ipc::Content) -> bool {
    match shape {
        ipc::Shape::Line(_) | ipc::Shape::Arc(_) | ipc::Shape::Polyline(_) => true,
        ipc::Shape::UserSpecial(shapes) => {
            !shapes.is_empty() && shapes.iter().all(|s| is_stroke(s, content))
        }
        ipc::Shape::UserRef(id) => content
            .user_primitives
            .get(id)
            .is_some_and(|s| matches!(s, ipc::Shape::UserSpecial(_)) && is_stroke(s, content)),
        _ => false,
    }
}

/// Converts IPC-2581 shapes in the context of one document.
pub struct ShapeConverter<'a> {
    content: &'a ipc::Content,
    tolerance: Tolerance,
    /// How the file's `Xform`s mirror.
    pub order: MirrorOrder,
    /// Messages about shapes that were approximated or dropped.
    pub warnings: Vec<String>,
}

impl<'a> ShapeConverter<'a> {
    /// A converter for shapes of `content`'s document.
    pub fn new(content: &'a ipc::Content, tolerance: Tolerance, order: MirrorOrder) -> Self {
        Self {
            content,
            tolerance,
            order,
            warnings: Vec::new(),
        }
    }

    /// The placement of an element with this file's mirror order.
    pub fn placement(&self, location: ipc::Point, xform: &ipc::Xform) -> DAffine2 {
        placement(location, xform, self.order)
    }

    fn warn(&mut self, message: String) {
        if !self.warnings.contains(&message) {
            self.warnings.push(message);
        }
    }

    /// The area a shape covers, transformed by `at`. `None` if it covers nothing.
    pub fn area(&mut self, shape: &ipc::Shape, at: DAffine2) -> Option<Shape> {
        self.convert(shape, at, Mode::Area, 0)
    }

    /// The area enclosed by a shape, ignoring strokes and fills: outlines of slots, package
    /// bodies and the board profile become filled polygons.
    pub fn filled(&mut self, shape: &ipc::Shape, at: DAffine2) -> Option<Shape> {
        self.convert(shape, at, Mode::Filled, 0)
    }

    /// A polygon (and its cutouts) as a filled shape.
    pub fn contour(&mut self, contour: &ipc::Contour, at: DAffine2) -> Option<Shape> {
        Some(Shape::Polygon {
            outline: path(&contour.polygon.path, at),
            holes: contour.cutouts.iter().map(|c| path(c, at)).collect(),
        })
    }

    fn convert(
        &mut self,
        shape: &ipc::Shape,
        at: DAffine2,
        mode: Mode,
        depth: usize,
    ) -> Option<Shape> {
        if depth > MAX_DEPTH {
            self.warn("user primitives nested too deeply (cyclic?) were dropped".into());
            return None;
        }
        match shape {
            ipc::Shape::StandardRef(id) => {
                let Some(primitive) = self.content.standard_primitives.get(id) else {
                    self.warn(format!("standard primitive `{id}` is not defined"));
                    return None;
                };
                self.primitive(primitive, at, mode)
            }
            ipc::Shape::UserRef(id) => {
                let Some(shape) = self.content.user_primitives.get(id) else {
                    self.warn(format!("user primitive `{id}` is not defined"));
                    return None;
                };
                self.convert(shape, at, mode, depth + 1)
            }
            ipc::Shape::Standard(primitive) => self.primitive(primitive, at, mode),
            ipc::Shape::UserSpecial(shapes) => {
                let parts: Vec<Shape> = shapes
                    .iter()
                    .filter_map(|s| self.convert(s, at, mode, depth + 1))
                    .collect();
                union(parts)
            }
            ipc::Shape::Line(line) => {
                let p = Path::new(at.transform_point2(point(line.start)))
                    .line_to(at.transform_point2(point(line.end)));
                self.stroke(p, &line.line, at, mode)
            }
            ipc::Shape::Arc(arc) => {
                let p = Path::new(at.transform_point2(point(arc.start))).arc_to(
                    at.transform_point2(point(arc.end)),
                    at.transform_point2(point(arc.center)),
                    direction(arc.clockwise, at),
                );
                self.stroke(p, &arc.line, at, mode)
            }
            ipc::Shape::Polyline(polyline) => {
                let p = path(&polyline.path, at);
                if mode == Mode::Filled && closed(&polyline.path) {
                    return Some(polygon(p));
                }
                self.stroke(p, &polyline.line, at, mode)
            }
            ipc::Shape::Polygon(poly) => self.polygon(poly, at, mode),
            ipc::Shape::Outline(outline) => {
                // An outline encloses an area (KiCad writes text glyphs and slots this
                // way, with zero width), drawn with its line on top.
                let p = path(&outline.polygon.path, at);
                if mode == Mode::Filled {
                    return Some(polygon(p));
                }
                let line = self.content.line_desc(&outline.line).copied();
                self.filled_with_line(vec![p], Fill::Solid, line, at)
            }
            ipc::Shape::Unsupported { element } => {
                self.warn(format!("unsupported shape `{element}` has no geometry"));
                None
            }
        }
    }

    fn stroke(
        &mut self,
        path: Path,
        style: &ipc::LineStyle,
        at: DAffine2,
        mode: Mode,
    ) -> Option<Shape> {
        if mode == Mode::Filled {
            return None;
        }
        let Some(desc) = self.content.line_desc(style).copied() else {
            self.warn("a line descriptor is not defined; its strokes were dropped".into());
            return None;
        };
        stroke(path, desc, scale(at))
    }

    fn polygon(&mut self, poly: &ipc::Polygon, at: DAffine2, mode: Mode) -> Option<Shape> {
        let outline = path(&poly.path, at);
        if mode == Mode::Filled {
            return Some(polygon(outline));
        }
        let fill = match &poly.fill {
            Some(style) => self.fill(style),
            None => Fill::Solid,
        };
        let line = poly
            .line
            .as_ref()
            .and_then(|style| self.content.line_desc(style).copied());
        self.filled_with_line(vec![outline], fill, line, at)
    }

    fn fill(&mut self, style: &ipc::FillStyle) -> Fill {
        match self.content.fill_desc(style).map(|d| d.property) {
            Some(FillProperty::Fill) | None => Fill::Solid,
            Some(FillProperty::Hatch | FillProperty::Mesh) => {
                self.warn("hatched and meshed fills are drawn solid".into());
                Fill::Solid
            }
            Some(FillProperty::Hollow) => Fill::Hollow,
            Some(FillProperty::Void) => Fill::Void,
        }
    }

    /// A closed outline (first path) with holes (other paths), filled and/or stroked.
    fn filled_with_line(
        &mut self,
        paths: Vec<Path>,
        fill: Fill,
        line: Option<ipc::LineDesc>,
        at: DAffine2,
    ) -> Option<Shape> {
        let line = line.filter(|l| l.width > 0.0);
        let strokes = || {
            paths
                .iter()
                .filter_map(|p| stroke(close(p.clone()), line?, scale(at)))
                .collect::<Vec<_>>()
        };
        match fill {
            Fill::Void => None,
            Fill::Hollow => union(strokes()),
            Fill::Solid => {
                let mut parts = strokes();
                let mut paths = paths.clone();
                let outline = paths.remove(0);
                parts.insert(
                    0,
                    Shape::Polygon {
                        outline,
                        holes: paths,
                    },
                );
                union(parts)
            }
        }
    }

    fn primitive(
        &mut self,
        primitive: &ipc::StandardPrimitive,
        at: DAffine2,
        mode: Mode,
    ) -> Option<Shape> {
        let fill = match (&primitive.fill, mode) {
            (_, Mode::Filled) | (None, _) => Fill::Solid,
            (Some(style), Mode::Area) => self.fill(style),
        };
        let line = match mode {
            Mode::Filled => None,
            Mode::Area => primitive
                .line
                .as_ref()
                .and_then(|style| self.content.line_desc(style).copied()),
        };
        let s = scale(at);
        let t = |x: f64, y: f64| at.transform_point2(DVec2::new(x, y));
        match &primitive.kind {
            PrimitiveKind::Circle { diameter } if fill == Fill::Solid && line.is_none() => {
                Some(Shape::Circle {
                    center: t(0.0, 0.0),
                    radius: diameter / 2.0 * s,
                })
            }
            PrimitiveKind::Contour(contour) => {
                let mut paths = vec![path(&contour.polygon.path, at)];
                paths.extend(contour.cutouts.iter().map(|c| path(c, at)));
                self.filled_with_line(paths, fill, line, at)
            }
            PrimitiveKind::Donut {
                shape,
                outer_diameter,
                inner_diameter,
            } => {
                let outer = ring_path(*shape, outer_diameter / 2.0, at);
                let inner = ring_path(*shape, inner_diameter / 2.0, at);
                self.filled_with_line(vec![outer, inner], fill, line, at)
            }
            PrimitiveKind::Thermal {
                shape,
                outer_diameter,
                inner_diameter,
                spoke_count,
                gap,
                spoke_start_angle,
            } => {
                let ring = Shape::Polygon {
                    outline: ring_path(*shape, outer_diameter / 2.0, at),
                    holes: vec![ring_path(*shape, inner_diameter / 2.0, at)],
                };
                let count = spoke_count.unwrap_or(4).max(1);
                let gap = gap.unwrap_or(0.0);
                let start = spoke_start_angle.unwrap_or(0.0).to_radians();
                let reach = outer_diameter.max(*inner_diameter);
                let cut = (0..count)
                    .filter(|_| gap > 0.0)
                    .map(|k| {
                        let a = start + TAU * f64::from(k) / f64::from(count);
                        let rot = at * DAffine2::from_angle(a);
                        let p = |x: f64, y: f64| rot.transform_point2(DVec2::new(x, y));
                        polygon(
                            Path::new(p(0.0, -gap / 2.0))
                                .line_to(p(reach, -gap / 2.0))
                                .line_to(p(reach, gap / 2.0))
                                .line_to(p(0.0, gap / 2.0)),
                        )
                    })
                    .collect();
                if fill != Fill::Solid {
                    self.warn("hollow thermals are drawn solid".into());
                }
                Some(Shape::Difference {
                    base: Box::new(ring),
                    cut,
                })
            }
            PrimitiveKind::Unsupported { element } => {
                self.warn(format!(
                    "unsupported standard primitive `{element}` has no geometry"
                ));
                None
            }
            kind => {
                let outline = outline_path(kind, self.tolerance, at)?;
                self.filled_with_line(vec![outline], fill, line, at)
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// The drawn area: fills and strokes.
    Area,
    /// The enclosed area of closed outlines; open strokes are dropped.
    Filled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fill {
    Solid,
    Hollow,
    Void,
}

fn union(mut parts: Vec<Shape>) -> Option<Shape> {
    match parts.len() {
        0 => None,
        1 => parts.pop(),
        _ => Some(Shape::Union(parts)),
    }
}

fn polygon(outline: Path) -> Shape {
    Shape::Polygon {
        outline,
        holes: Vec::new(),
    }
}

/// The scale factor of a similarity transform.
fn scale(at: DAffine2) -> f64 {
    at.matrix2.determinant().abs().sqrt()
}

fn direction(clockwise: bool, at: DAffine2) -> ArcDirection {
    // A mirroring transform reverses the direction of arcs.
    if clockwise == (at.matrix2.determinant() > 0.0) {
        ArcDirection::Clockwise
    } else {
        ArcDirection::CounterClockwise
    }
}

fn stroke(path: Path, desc: ipc::LineDesc, scale: f64) -> Option<Shape> {
    if desc.width.is_nan() || desc.width <= 0.0 {
        return None;
    }
    Some(Shape::Stroke(Stroke {
        path,
        width: desc.width * scale,
        cap: match desc.end {
            LineEnd::Round => LineCap::Round,
            LineEnd::Square => LineCap::Square,
            LineEnd::None => LineCap::Flat,
        },
    }))
}

/// Converts an IPC-2581 path.
pub fn path(p: &ipc::Path, at: DAffine2) -> Path {
    let mut out = Path::new(at.transform_point2(point(p.start)));
    for step in &p.steps {
        out = match *step {
            ipc::PolyStep::Segment { to } => out.line_to(at.transform_point2(point(to))),
            ipc::PolyStep::Curve {
                to,
                center,
                clockwise,
            } => out.arc_to(
                at.transform_point2(point(to)),
                at.transform_point2(point(center)),
                direction(clockwise, at),
            ),
        };
    }
    out
}

fn closed(p: &ipc::Path) -> bool {
    let end = match p.steps.last() {
        Some(ipc::PolyStep::Segment { to } | ipc::PolyStep::Curve { to, .. }) => *to,
        None => return false,
    };
    point(end).distance(point(p.start)) < 1e-9
}

/// Makes a path end where it starts, so that it strokes as a closed loop.
fn close(p: Path) -> Path {
    let end = p.segments.last().map(|s| match *s {
        boardui_geom::Segment::Line { end } | boardui_geom::Segment::Arc { end, .. } => end,
    });
    match end {
        Some(end) if end.distance(p.start) > 1e-9 => {
            let start = p.start;
            p.line_to(start)
        }
        _ => p,
    }
}

/// A full circle as a path.
fn circle_path(center: DVec2, radius: f64) -> Path {
    let start = center + DVec2::new(radius, 0.0);
    Path::new(start).arc_to(start, center, ArcDirection::CounterClockwise)
}

/// A regular polygon with `n` corners and the given circumradius, starting at angle `phase`.
fn regular(n: u32, radius: f64, phase: f64) -> Vec<DVec2> {
    (0..n)
        .map(|k| radius * DVec2::from_angle(phase + TAU * f64::from(k) / f64::from(n)))
        .collect()
}

fn poly_path(points: &[DVec2], at: DAffine2) -> Path {
    let mut p = Path::new(at.transform_point2(points[0]));
    for &q in &points[1..] {
        p = p.line_to(at.transform_point2(q));
    }
    p
}

/// The outline of a `Donut` or `Thermal` ring of the given shape and outer radius.
fn ring_path(shape: RingShape, radius: f64, at: DAffine2) -> Path {
    match shape {
        RingShape::Round => circle_path(at.transform_point2(DVec2::ZERO), radius * scale(at)),
        RingShape::Square => poly_path(
            &[
                DVec2::new(-radius, -radius),
                DVec2::new(radius, -radius),
                DVec2::new(radius, radius),
                DVec2::new(-radius, radius),
            ],
            at,
        ),
        // Flat sides parallel to the X axis: radius is the inradius.
        RingShape::Hexagon => poly_path(&regular(6, radius / (PI / 6.0).cos(), 0.0), at),
        RingShape::Octagon => poly_path(&regular(8, radius / (PI / 8.0).cos(), PI / 8.0), at),
    }
}

/// The outline of a simple standard primitive, centred on the origin.
fn outline_path(kind: &PrimitiveKind, tolerance: Tolerance, at: DAffine2) -> Option<Path> {
    let rect = |w: f64, h: f64| {
        [
            DVec2::new(-w / 2.0, -h / 2.0),
            DVec2::new(w / 2.0, -h / 2.0),
            DVec2::new(w / 2.0, h / 2.0),
            DVec2::new(-w / 2.0, h / 2.0),
        ]
    };
    Some(match *kind {
        PrimitiveKind::Circle { diameter } => {
            circle_path(at.transform_point2(DVec2::ZERO), diameter / 2.0 * scale(at))
        }
        PrimitiveKind::RectCenter { width, height } => poly_path(&rect(width, height), at),
        PrimitiveKind::RectCorner {
            lower_left,
            upper_right,
        } => poly_path(
            &[
                DVec2::new(lower_left.x, lower_left.y),
                DVec2::new(upper_right.x, lower_left.y),
                DVec2::new(upper_right.x, upper_right.y),
                DVec2::new(lower_left.x, upper_right.y),
            ],
            at,
        ),
        PrimitiveKind::RectRound {
            width,
            height,
            radius,
            corners,
        } => {
            let r = radius.clamp(0.0, width.min(height) / 2.0);
            corner_path(width, height, r, corners, true, at)
        }
        PrimitiveKind::RectCham {
            width,
            height,
            chamfer,
            corners,
        } => {
            let c = chamfer.clamp(0.0, width.min(height) / 2.0);
            corner_path(width, height, c, corners, false, at)
        }
        PrimitiveKind::Oval { width, height } => {
            // A stadium: semicircles on the shorter sides.
            let (w, h) = (width / 2.0, height / 2.0);
            let r = w.min(h);
            let (a, b) = if width >= height {
                (DVec2::new(w - r, 0.0), DVec2::new(-(w - r), 0.0))
            } else {
                (DVec2::new(0.0, h - r), DVec2::new(0.0, -(h - r)))
            };
            let n = if width >= height {
                DVec2::new(0.0, r)
            } else {
                DVec2::new(-r, 0.0)
            };
            let t = |p: DVec2| at.transform_point2(p);
            let ccw = direction(false, at);
            Path::new(t(a - n))
                .arc_to(t(a + n), t(a), ccw)
                .line_to(t(b + n))
                .arc_to(t(b - n), t(b), ccw)
        }
        PrimitiveKind::Ellipse { width, height } => {
            let (a, b) = (width / 2.0, height / 2.0);
            let r = a.max(b).max(1e-9);
            // Chords of an ellipse deviate less than chords of its circumscribed circle.
            let step = 2.0 * (1.0 - (tolerance.metres() / r).min(1.0)).acos();
            let n = ((TAU / step.max(1e-3)).ceil() as u32).clamp(16, 4096);
            let points: Vec<DVec2> = (0..n)
                .map(|k| {
                    let t = TAU * f64::from(k) / f64::from(n);
                    DVec2::new(a * t.cos(), b * t.sin())
                })
                .collect();
            poly_path(&points, at)
        }
        PrimitiveKind::Diamond { width, height } => poly_path(
            &[
                DVec2::new(0.0, -height / 2.0),
                DVec2::new(width / 2.0, 0.0),
                DVec2::new(0.0, height / 2.0),
                DVec2::new(-width / 2.0, 0.0),
            ],
            at,
        ),
        PrimitiveKind::Octagon { length } => {
            // `length` is the distance across flats.
            poly_path(&regular(8, length / 2.0 / (PI / 8.0).cos(), PI / 8.0), at)
        }
        PrimitiveKind::Triangle { base, height } => poly_path(
            &[
                DVec2::new(-base / 2.0, -height / 2.0),
                DVec2::new(base / 2.0, -height / 2.0),
                DVec2::new(0.0, height / 2.0),
            ],
            at,
        ),
        PrimitiveKind::Butterfly { shape, size } => {
            // Quadrants I and III; drawn as one path through the centre.
            let r = size / 2.0;
            let t = |x: f64, y: f64| at.transform_point2(DVec2::new(x, y));
            match shape {
                ipc::ButterflyShape::Square => Path::new(t(0.0, 0.0))
                    .line_to(t(r, 0.0))
                    .line_to(t(r, r))
                    .line_to(t(0.0, r))
                    .line_to(t(0.0, 0.0))
                    .line_to(t(-r, 0.0))
                    .line_to(t(-r, -r))
                    .line_to(t(0.0, -r)),
                ipc::ButterflyShape::Round => {
                    let ccw = direction(false, at);
                    let o = t(0.0, 0.0);
                    Path::new(o)
                        .line_to(t(r, 0.0))
                        .arc_to(t(0.0, r), o, ccw)
                        .line_to(o)
                        .line_to(t(-r, 0.0))
                        .arc_to(t(0.0, -r), o, ccw)
                }
            }
        }
        PrimitiveKind::Contour(_)
        | PrimitiveKind::Donut { .. }
        | PrimitiveKind::Thermal { .. }
        | PrimitiveKind::Unsupported { .. } => return None,
    })
}

/// A centred rectangle with rounded (`round`) or chamfered corners of size `r`.
fn corner_path(
    width: f64,
    height: f64,
    r: f64,
    corners: ipc::Corners,
    round: bool,
    at: DAffine2,
) -> Path {
    let (w, h) = (width / 2.0, height / 2.0);
    // Counter-clockwise from the lower right corner.
    let list = [
        (DVec2::new(w, -h), corners.lower_right, 0.0),
        (DVec2::new(w, h), corners.upper_right, FRAC_PI_2),
        (DVec2::new(-w, h), corners.upper_left, PI),
        (DVec2::new(-w, -h), corners.lower_left, -FRAC_PI_2),
    ];
    let t = |p: DVec2| at.transform_point2(p);
    let ccw = direction(false, at);
    let mut out: Option<Path> = None;
    for (corner, cut, angle) in list {
        // Edge directions arriving at and leaving the corner.
        let arrive = DVec2::from_angle(angle);
        let depart = DVec2::from_angle(angle + FRAC_PI_2);
        let (enter, leave) = if cut && r > 0.0 {
            (corner - arrive * r, corner + depart * r)
        } else {
            (corner, corner)
        };
        let p = match out {
            None => Path::new(t(enter)),
            Some(p) => p.line_to(t(enter)),
        };
        out = Some(if enter == leave {
            p
        } else if round {
            p.arc_to(t(leave), t(corner - arrive * r + depart * r), ccw)
        } else {
            p.line_to(t(leave))
        });
    }
    out.expect("four corners")
}

#[cfg(test)]
mod tests {
    use super::*;
    use boardui_geom::Region;

    const T: Tolerance = Tolerance::DEFAULT;

    fn area(shape: &Shape) -> f64 {
        shape.to_region(T).unwrap().area()
    }

    fn bounds(shape: &Shape) -> (DVec2, DVec2) {
        let b = shape.to_region(T).unwrap().bounds().unwrap();
        (b.min, b.max)
    }

    fn content() -> ipc::Content {
        ipc::Content::default()
    }

    fn std(kind: PrimitiveKind) -> ipc::Shape {
        ipc::Shape::Standard(ipc::StandardPrimitive {
            kind,
            line: None,
            fill: None,
        })
    }

    fn close_to(a: f64, b: f64, eps: f64) {
        assert!((a - b).abs() <= eps, "{a} vs {b}");
    }

    #[test]
    fn rectangles_rotate_and_translate() {
        let c = content();
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        let xform = ipc::Xform {
            rotation: 90.0,
            ..ipc::Xform::default()
        };
        let at = placement(
            ipc::Point { x: 1e-3, y: 2e-3 },
            &xform,
            MirrorOrder::MirrorThenRotate,
        );
        let s = conv
            .area(
                &std(PrimitiveKind::RectCenter {
                    width: 2e-3,
                    height: 1e-3,
                }),
                at,
            )
            .unwrap();
        close_to(area(&s), 2e-6, 1e-15);
        let (min, max) = bounds(&s);
        close_to(min.x, 0.5e-3, 1e-9);
        close_to(max.y, 3e-3, 1e-9);
    }

    #[test]
    fn mirror_orders_differ_in_rotation_sense() {
        let xform = ipc::Xform {
            rotation: 30.0,
            mirror: true,
            ..ipc::Xform::default()
        };
        let (c, s) = (30f64.to_radians().cos(), 30f64.to_radians().sin());
        let p = placement(ipc::Point::default(), &xform, MirrorOrder::RotateThenMirror)
            .transform_point2(DVec2::X);
        close_to(p.x, -c, 1e-12);
        close_to(p.y, s, 1e-12);
        let p = placement(ipc::Point::default(), &xform, MirrorOrder::MirrorThenRotate)
            .transform_point2(DVec2::X);
        close_to(p.x, -c, 1e-12);
        close_to(p.y, -s, 1e-12);
    }

    #[test]
    fn rounded_and_chamfered_rectangles() {
        let c = content();
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        let all = ipc::Corners {
            upper_right: true,
            upper_left: true,
            lower_right: true,
            lower_left: true,
        };
        let round = conv
            .area(
                &std(PrimitiveKind::RectRound {
                    width: 2e-3,
                    height: 1e-3,
                    radius: 0.25e-3,
                    corners: all,
                }),
                DAffine2::IDENTITY,
            )
            .unwrap();
        let expected = 2e-6 - (4.0 - PI) * 0.25e-3 * 0.25e-3;
        // Arcs are inscribed: allow the perimeter times the tolerance.
        close_to(area(&round), expected, 6e-3 * T.metres());
        let (min, max) = bounds(&round);
        close_to(min.x, -1e-3, 1e-9);
        close_to(max.y, 0.5e-3, 1e-9);
        let cham = conv
            .area(
                &std(PrimitiveKind::RectCham {
                    width: 2e-3,
                    height: 1e-3,
                    chamfer: 0.2e-3,
                    corners: ipc::Corners {
                        upper_left: false,
                        ..all
                    },
                }),
                DAffine2::IDENTITY,
            )
            .unwrap();
        close_to(area(&cham), 2e-6 - 3.0 * 0.02e-6, 1e-15);
    }

    #[test]
    fn ovals_donuts_and_thermals() {
        let c = content();
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        let oval = conv
            .area(
                &std(PrimitiveKind::Oval {
                    width: 3e-3,
                    height: 1e-3,
                }),
                DAffine2::IDENTITY,
            )
            .unwrap();
        close_to(area(&oval), 2e-3 * 1e-3 + PI * 0.25e-6, 8e-3 * T.metres());
        let tall = conv
            .area(
                &std(PrimitiveKind::Oval {
                    width: 1e-3,
                    height: 3e-3,
                }),
                DAffine2::IDENTITY,
            )
            .unwrap();
        close_to(bounds(&tall).1.y, 1.5e-3, 1e-8);
        let donut = conv
            .area(
                &std(PrimitiveKind::Donut {
                    shape: RingShape::Round,
                    outer_diameter: 2e-3,
                    inner_diameter: 1e-3,
                }),
                DAffine2::IDENTITY,
            )
            .unwrap();
        close_to(area(&donut), PI * (1e-6 - 0.25e-6), 1e-2 * T.metres());
        let thermal = conv
            .area(
                &std(PrimitiveKind::Thermal {
                    shape: RingShape::Square,
                    outer_diameter: 2e-3,
                    inner_diameter: 1e-3,
                    spoke_count: Some(4),
                    gap: Some(0.2e-3),
                    spoke_start_angle: Some(0.0),
                }),
                DAffine2::IDENTITY,
            )
            .unwrap();
        close_to(area(&thermal), 3e-6 - 4.0 * 0.5e-3 * 0.2e-3, 1e-12);
    }

    #[test]
    fn hollow_polygons_are_strokes() {
        let mut c = content();
        c.line_descs = ipc::Table::default();
        let poly = ipc::Polygon {
            path: ipc::Path {
                start: ipc::Point { x: 0.0, y: 0.0 },
                steps: [(1e-3, 0.0), (1e-3, 1e-3), (0.0, 1e-3), (0.0, 0.0)]
                    .map(|(x, y)| ipc::PolyStep::Segment {
                        to: ipc::Point { x, y },
                    })
                    .to_vec(),
            },
            line: Some(ipc::LineStyle::Desc(ipc::LineDesc {
                width: 0.1e-3,
                end: LineEnd::Round,
            })),
            fill: Some(ipc::FillStyle::Desc(Box::new(ipc::FillDesc {
                property: FillProperty::Hollow,
                line_width: None,
                pitch1: None,
                pitch2: None,
                angle1: None,
                angle2: None,
            }))),
        };
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        let s = conv
            .area(&ipc::Shape::Polygon(poly.clone()), DAffine2::IDENTITY)
            .unwrap();
        // Round joins round the outer corners.
        let ring = 1.1e-3 * 1.1e-3 - 0.9e-3 * 0.9e-3 - (4.0 - PI) * 0.05e-3 * 0.05e-3;
        close_to(area(&s), ring, 8e-3 * T.metres());
        let filled = conv
            .filled(&ipc::Shape::Polygon(poly), DAffine2::IDENTITY)
            .unwrap();
        close_to(area(&filled), 1e-6, 1e-15);
    }

    #[test]
    fn mirrored_arcs_keep_their_shape() {
        let c = content();
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        let half_disc = ipc::Shape::Polygon(ipc::Polygon {
            path: ipc::Path {
                start: ipc::Point { x: 1e-3, y: 0.0 },
                steps: vec![ipc::PolyStep::Curve {
                    to: ipc::Point { x: -1e-3, y: 0.0 },
                    center: ipc::Point::default(),
                    clockwise: false,
                }],
            },
            line: None,
            fill: None,
        });
        let xform = ipc::Xform {
            mirror: true,
            ..ipc::Xform::default()
        };
        let s = conv
            .area(&half_disc, conv.placement(ipc::Point::default(), &xform))
            .unwrap();
        close_to(area(&s), PI * 1e-6 / 2.0, 6e-3 * T.metres());
        assert!(
            bounds(&s).1.y > 0.9e-3,
            "the upper half stays the upper half"
        );
        let r: Region = s.to_region(T).unwrap();
        assert!(!r.is_empty());
    }
}
