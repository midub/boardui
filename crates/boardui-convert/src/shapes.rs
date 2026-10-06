//! IPC-2581 shapes to `boardui-geom` shapes, with `Location` and `Xform` applied.

use boardui_geom::{ArcDirection, DVec2, LineCap, Path, Shape, Stroke, Tolerance};
use boardui_ipc2581 as ipc;
use glam::DAffine2;
use ipc::{FillProperty, LineEnd, LineProperty, PrimitiveKind, RingShape};
use std::collections::BTreeSet;
use std::f64::consts::{FRAC_PI_2, PI, TAU};

use crate::text::{CAP_HEIGHT, DESCENT, STROKE_WIDTH, StrokeFont, StrokeGlyph};

/// How deep `UserPrimitiveRef`s may nest before the shape is given up as cyclic.
const MAX_DEPTH: usize = 16;

/// The width, in metres, of a stroke whose `LineDesc` is zero wide: a hairline (spec §6.1).
const HAIRLINE: f64 = 0.1e-3;

/// Most lines a `HATCH` or `MESH` fill may have in one direction; denser fills are drawn solid.
const MAX_HATCH_LINES: f64 = 4096.0;

/// Most dashes a patterned stroke may have; longer patterned strokes are drawn solid.
const MAX_DASHES: f64 = 100_000.0;

/// Most rings a `Moire` may have.
const MAX_MOIRE_RINGS: u32 = 1024;

/// Most characters without a glyph listed in the warning about them.
const MAX_LISTED_CHARACTERS: usize = 10;

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
        ipc::Shape::Line(_)
        | ipc::Shape::Arc(_)
        | ipc::Shape::Polyline(_)
        | ipc::Shape::Text(_) => true,
        ipc::Shape::UserSpecial(shapes) => {
            !shapes.is_empty() && shapes.iter().all(|s| is_stroke(s, content))
        }
        ipc::Shape::UserRef(id) => content.user_primitives.get(id).is_some_and(|s| {
            matches!(s, ipc::Shape::UserSpecial(_) | ipc::Shape::Text(_)) && is_stroke(s, content)
        }),
        _ => false,
    }
}

/// The strings of the `Text`s a shape draws, in document order (spec §8.2).
pub fn texts<'a>(shape: &'a ipc::Shape, content: &'a ipc::Content) -> Vec<&'a str> {
    fn walk<'a>(
        shape: &'a ipc::Shape,
        content: &'a ipc::Content,
        depth: usize,
        out: &mut Vec<&'a str>,
    ) {
        match shape {
            _ if depth > MAX_DEPTH => {}
            ipc::Shape::Text(text) => out.push(&text.string),
            ipc::Shape::UserSpecial(shapes) => {
                for s in shapes {
                    walk(s, content, depth + 1, out);
                }
            }
            ipc::Shape::UserRef(id) => {
                if let Some(s) = content.user_primitives.get(id) {
                    walk(s, content, depth + 1, out);
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(shape, content, 0, &mut out);
    out
}

/// Whether a shape only erases: it is drawn with `ERASE` lines (spec §6.1). Such a feature
/// has negative polarity.
pub fn erases(shape: &ipc::Shape, content: &ipc::Content) -> bool {
    erases_at(shape, content, 0)
}

fn erases_at(shape: &ipc::Shape, content: &ipc::Content, depth: usize) -> bool {
    let erase = |style: &ipc::LineStyle| {
        content
            .line_desc(style)
            .is_some_and(|d| d.property == LineProperty::Erase)
    };
    let hollow = |style: Option<&ipc::FillStyle>| {
        style
            .and_then(|f| content.fill_desc(f))
            .is_some_and(|f| f.property == FillProperty::Hollow)
    };
    let primitive =
        |p: &ipc::StandardPrimitive| hollow(p.fill.as_ref()) && p.line.as_ref().is_some_and(erase);
    match shape {
        _ if depth > MAX_DEPTH => false,
        ipc::Shape::Line(ipc::Line { line, .. })
        | ipc::Shape::Arc(ipc::Arc { line, .. })
        | ipc::Shape::Polyline(ipc::Polyline { line, .. }) => erase(line),
        ipc::Shape::Polygon(poly) => {
            hollow(poly.fill.as_ref()) && poly.line.as_ref().is_some_and(erase)
        }
        ipc::Shape::Standard(p) => primitive(p),
        ipc::Shape::StandardRef(id) => content.standard_primitives.get(id).is_some_and(primitive),
        ipc::Shape::UserRef(id) => content
            .user_primitives
            .get(id)
            .is_some_and(|s| erases_at(s, content, depth + 1)),
        ipc::Shape::UserSpecial(shapes) => {
            !shapes.is_empty() && shapes.iter().all(|s| erases_at(s, content, depth + 1))
        }
        ipc::Shape::Outline(_) | ipc::Shape::Text(_) | ipc::Shape::Unsupported { .. } => false,
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
    /// Characters of `Text`s that no font has a glyph for.
    missing_glyphs: BTreeSet<char>,
    /// How many `Text`s were scaled down to fit their bounding box.
    text_overflows: usize,
}

impl<'a> ShapeConverter<'a> {
    /// A converter for shapes of `content`'s document.
    pub fn new(content: &'a ipc::Content, tolerance: Tolerance, order: MirrorOrder) -> Self {
        Self {
            content,
            tolerance,
            order,
            warnings: Vec::new(),
            missing_glyphs: BTreeSet::new(),
            text_overflows: 0,
        }
    }

    /// Takes the warnings, including the ones that summarize all `Text`s. A text too wide for
    /// its box gives one warning each, to be merged into one with a count.
    pub fn take_warnings(&mut self) -> Vec<String> {
        if !self.missing_glyphs.is_empty() {
            let mut listed: Vec<_> = self
                .missing_glyphs
                .iter()
                .take(MAX_LISTED_CHARACTERS)
                .map(|&c| format!("U+{:04X}", u32::from(c)))
                .collect();
            let more = self
                .missing_glyphs
                .len()
                .saturating_sub(MAX_LISTED_CHARACTERS);
            if more > 0 {
                listed.push(format!("and {more} more"));
            }
            self.warnings.push(format!(
                "text characters without a glyph are drawn as boxes: {}",
                listed.join(", ")
            ));
        }
        let overflow = "a text wider than its bounding box was scaled down to fit";
        self.warnings.extend(std::iter::repeat_n(
            overflow.to_owned(),
            self.text_overflows,
        ));
        self.missing_glyphs.clear();
        self.text_overflows = 0;
        std::mem::take(&mut self.warnings)
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

    /// The outline of a package drawing (spec §6.13): its line, a zero-width one as a
    /// hairline; filled only when its polygon's `FillDesc` says so.
    pub fn drawing_outline(&mut self, outline: &ipc::Outline, at: DAffine2) -> Option<Shape> {
        let fill = match &outline.polygon.fill {
            Some(style) => self.fill(style),
            None => Fill::Hollow,
        };
        let line = self.content.line_desc(&outline.line).copied();
        self.filled_with_line(vec![path(&outline.polygon.path, at)], fill, line, at)
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
                // A group of only erasing parts is drawn with negative polarity by the
                // caller; otherwise erasing parts cut the parts before them.
                let cuts = mode == Mode::Area && !erases(shape, self.content);
                let mut parts: Vec<Shape> = Vec::new();
                for s in shapes {
                    let Some(part) = self.convert(s, at, mode, depth + 1) else {
                        continue;
                    };
                    if cuts && erases(s, self.content) {
                        if let Some(base) = union(std::mem::take(&mut parts)) {
                            parts.push(Shape::Difference {
                                base: Box::new(base),
                                cut: vec![part],
                            });
                        }
                    } else {
                        parts.push(part);
                    }
                }
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
            ipc::Shape::Text(text) if mode == Mode::Area => self.text(text, at, depth),
            ipc::Shape::Text(_) => None,
            ipc::Shape::Unsupported { element } => {
                self.warn(format!("unsupported shape `{element}` has no geometry"));
                None
            }
        }
    }

    /// `Text` (spec §6.6): its string in its embedded font, or in the bundled stroke font,
    /// fitted into its bounding box.
    fn text(&mut self, text: &ipc::Text, at: DAffine2, depth: usize) -> Option<Shape> {
        let at = at * self.placement(ipc::Point::default(), &text.xform);
        let font = self.font(text);
        let bundled = StrokeFont::get();
        // The font's cell in font units: the bounding box's height is fitted to it.
        let (bottom, top) = match font {
            Some(f) => cell(f)?,
            None => (-DESCENT, CAP_HEIGHT),
        };
        // Bundled glyphs in text with an embedded font are scaled to its cell.
        let k = (top - bottom) / (CAP_HEIGHT + DESCENT);
        let mut glyphs = Vec::new();
        let mut pen = 0.0;
        for c in text.string.chars() {
            let glyph = match font.and_then(|f| f.glyph(c)) {
                Some(g) => Glyph::Embedded(g),
                None => {
                    if let Some(f) = font.filter(|_| !c.is_whitespace()) {
                        self.warn(format!(
                            "embedded font `{}` lacks some characters; they are drawn with the bundled font",
                            f.name
                        ));
                    }
                    Glyph::Bundled(bundled.glyph(c).unwrap_or_else(|| {
                        self.missing_glyphs.insert(c);
                        bundled.missing()
                    }))
                }
            };
            glyphs.push((pen, glyph));
            pen += match glyph {
                Glyph::Embedded(g) => (g.upper_right.x - g.lower_left.x).max(0.0),
                Glyph::Bundled(g) => g.advance * k,
            };
        }
        let min = point(text.lower_left).min(point(text.upper_right));
        let size = (point(text.lower_left) - point(text.upper_right)).abs();
        if size.x == 0.0 || size.y == 0.0 {
            self.warn("texts with an empty bounding box were dropped".into());
            return None;
        }
        // Height drives the size; text too wide for the box is scaled down and centred
        // vertically.
        let mut s = size.y / (top - bottom);
        let mut lift = 0.0;
        if pen * s > size.x * (1.0 + 1e-6) {
            self.text_overflows += 1;
            s = size.x / pen;
            lift = (size.y - (top - bottom) * s) / 2.0;
        }
        let fit = at
            * DAffine2::from_translation(DVec2::new(min.x, min.y + lift))
            * DAffine2::from_scale(DVec2::splat(s))
            * DAffine2::from_translation(DVec2::new(0.0, -bottom));
        let stroke = self.text_stroke(text, font, at, fit, k);
        let mut parts = Vec::new();
        for (x, glyph) in glyphs {
            match glyph {
                Glyph::Embedded(g) => {
                    let at = fit * DAffine2::from_translation(DVec2::new(x - g.lower_left.x, 0.0));
                    for shape in &g.shapes {
                        parts.extend(self.convert(shape, at, Mode::Area, depth + 1));
                    }
                }
                Glyph::Bundled(g) => {
                    let at = fit
                        * DAffine2::from_translation(DVec2::new(x, 0.0))
                        * DAffine2::from_scale(DVec2::splat(k));
                    for points in &g.strokes {
                        let mut points = points.iter().map(|&p| at.transform_point2(p));
                        let Some(start) = points.next() else {
                            continue;
                        };
                        let path = points.fold(Path::new(start), Path::line_to);
                        parts.extend(self.line(path, stroke, DAffine2::IDENTITY));
                    }
                }
            }
        }
        union(parts)
    }

    /// The embedded font of a `Text`; `None` for the bundled font.
    fn font(&mut self, text: &ipc::Text) -> Option<&'a ipc::EmbeddedFont> {
        let id = text.font_ref.as_ref()?;
        let content = self.content;
        match content.fonts.get(id) {
            Some(ipc::Font::Embedded(f)) if cell(f).is_some() => Some(f),
            Some(ipc::Font::Embedded(f)) => {
                self.warn(format!(
                    "embedded font `{}` has no glyphs; its text is drawn with the bundled font",
                    f.name
                ));
                None
            }
            Some(ipc::Font::External { name, .. }) => {
                self.warn(format!(
                    "external font `{name}` is not available; its text is drawn with the bundled font"
                ));
                None
            }
            None => {
                self.warn(format!(
                    "font `{id}` is not defined; its text is drawn with the bundled font"
                ));
                None
            }
        }
    }

    /// The stroke of bundled glyphs in board units: the `Text`'s own `LineDesc`, else its
    /// embedded font's, else [`STROKE_WIDTH`] of the cap height. `fit` maps font units and
    /// `k` bundled glyph units to font units.
    fn text_stroke(
        &mut self,
        text: &ipc::Text,
        font: Option<&ipc::EmbeddedFont>,
        at: DAffine2,
        fit: DAffine2,
        k: f64,
    ) -> ipc::LineDesc {
        let own = text.line.as_ref().map(|style| {
            let desc = self.content.line_desc(style).copied();
            if desc.is_none() {
                self.warn(
                    "a line descriptor is not defined; its text has the default width".into(),
                );
            }
            desc.map(|d| (d, scale(at)))
        });
        let font = font
            .and_then(|f| f.line.as_ref())
            .and_then(|style| self.content.line_desc(style).copied())
            .map(|d| (d, scale(fit)));
        match own.flatten().or(font) {
            Some((desc, scale)) => ipc::LineDesc {
                width: desc.width * scale,
                ..desc
            },
            None => ipc::LineDesc {
                width: STROKE_WIDTH * CAP_HEIGHT * k * scale(fit),
                end: LineEnd::Round,
                property: LineProperty::Solid,
            },
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
        self.line(path, desc, at)
    }

    /// A path stroked with a `LineDesc`: its width, ends and pattern (spec §6.1).
    fn line(&mut self, path: Path, desc: ipc::LineDesc, at: DAffine2) -> Option<Shape> {
        let width = self.line_width(desc, at);
        let Some(pattern) = pattern(desc.property, width, desc.end) else {
            return stroke(path, width, desc.end);
        };
        let period: f64 = pattern.iter().sum();
        if path.length() / period * pattern.len() as f64 / 2.0 > MAX_DASHES {
            self.warn(format!(
                "patterned lines with more than {MAX_DASHES} dashes are drawn solid"
            ));
            return stroke(path, width, desc.end);
        }
        union(
            path.dashes(&pattern)
                .into_iter()
                .filter_map(|dash| stroke(dash, width, desc.end))
                .collect(),
        )
    }

    /// The drawn width of a line under `at`: zero-width lines are hairlines.
    fn line_width(&mut self, desc: ipc::LineDesc, at: DAffine2) -> f64 {
        if desc.width == 0.0 {
            self.warn("zero-width lines are drawn as 0.1 mm hairlines".into());
            return HAIRLINE;
        }
        desc.width * scale(at)
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
        let Some(desc) = self.content.fill_desc(style) else {
            return Fill::Solid;
        };
        match desc.property {
            FillProperty::Fill => Fill::Solid,
            FillProperty::Hollow => Fill::Hollow,
            FillProperty::Void => Fill::Void,
            // Defaults from IPC-2581C §3.5.6.1: 45° and 135°, a pitch of 4 line widths.
            FillProperty::Hatch => Fill::Hatch(Hatch {
                width: desc.line_width.unwrap_or(0.0),
                first: (desc.angle1.unwrap_or(45.0), desc.pitch1),
                second: None,
            }),
            FillProperty::Mesh => Fill::Hatch(Hatch {
                width: desc.line_width.unwrap_or(0.0),
                first: (desc.angle1.unwrap_or(45.0), desc.pitch1),
                second: Some((desc.angle2.unwrap_or(135.0), desc.pitch2)),
            }),
        }
    }

    /// The lines of a hatched or meshed fill over the area enclosed by `paths`, in
    /// directions relative to the local X axis of `at` and through its origin. `None` if
    /// the fill can't be hatched; it is then drawn solid.
    fn hatch_lines(&mut self, paths: &[Path], hatch: Hatch, at: DAffine2) -> Option<Vec<Shape>> {
        let width = if hatch.width > 0.0 {
            hatch.width * scale(at)
        } else {
            self.warn("zero-width lines are drawn as 0.1 mm hairlines".into());
            HAIRLINE
        };
        let (min, max) = bounds(paths)?;
        let corners = [min, DVec2::new(max.x, min.y), max, DVec2::new(min.x, max.y)];
        let origin = at.translation;
        let mut lines = Vec::new();
        for (angle, pitch) in [Some(hatch.first), hatch.second].into_iter().flatten() {
            let pitch = pitch.map_or(4.0 * width, |p| p * scale(at));
            if !(pitch > 0.0 && pitch.is_finite()) {
                self.warn("hatched fills without a positive pitch are drawn solid".into());
                return None;
            }
            let along = (at.matrix2 * DVec2::from_angle(angle.to_radians())).normalize_or_zero();
            if along == DVec2::ZERO {
                return None;
            }
            let across = along.perp();
            let range = |axis: DVec2| {
                corners
                    .iter()
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), c| {
                        let d = (*c - origin).dot(axis);
                        (lo.min(d), hi.max(d))
                    })
            };
            let (lo, hi) = range(across);
            let (first, last) = (
                ((lo - width) / pitch).floor(),
                ((hi + width) / pitch).ceil(),
            );
            if last - first + 1.0 > MAX_HATCH_LINES {
                self.warn(format!(
                    "hatched fills with more than {MAX_HATCH_LINES} lines are drawn solid"
                ));
                return None;
            }
            let (start, end) = range(along);
            let (start, end) = (start - width, end + width);
            let mut k = first;
            while k <= last {
                let base = origin + across * (k * pitch);
                lines.extend(stroke(
                    Path::new(base + along * start).line_to(base + along * end),
                    width,
                    LineEnd::None,
                ));
                k += 1.0;
            }
        }
        Some(lines)
    }

    /// A closed outline (first path) with holes (other paths), filled and/or stroked.
    fn filled_with_line(
        &mut self,
        paths: Vec<Path>,
        fill: Fill,
        line: Option<ipc::LineDesc>,
        at: DAffine2,
    ) -> Option<Shape> {
        // The zero-width line of a filled area is not drawn; a hollow one's is a hairline.
        let line = line.filter(|l| matches!(fill, Fill::Hollow) || l.width > 0.0);
        let strokes = match line {
            Some(desc) => paths
                .iter()
                .filter_map(|p| self.line(close(p.clone()), desc, at))
                .collect(),
            None => Vec::new(),
        };
        let area = || Shape::Polygon {
            outline: paths[0].clone(),
            holes: paths[1..].to_vec(),
        };
        let inside = match fill {
            Fill::Void => return None,
            Fill::Hollow => return union(strokes),
            Fill::Solid => area(),
            Fill::Hatch(hatch) => match self.hatch_lines(&paths, hatch, at) {
                Some(lines) => Shape::Intersection {
                    base: Box::new(area()),
                    clip: lines,
                },
                None => area(),
            },
        };
        if line.is_some_and(|l| l.property == LineProperty::Erase) {
            // An erasing outline cuts the area it encloses.
            return Some(Shape::Difference {
                base: Box::new(inside),
                cut: strokes,
            });
        }
        let mut parts = strokes;
        parts.insert(0, inside);
        union(parts)
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
                match fill {
                    Fill::Solid => {}
                    Fill::Hatch(_) => self.warn("hatched thermals are drawn solid".into()),
                    _ => self.warn("hollow thermals are drawn solid".into()),
                }
                Some(Shape::Difference {
                    base: Box::new(ring),
                    cut,
                })
            }
            PrimitiveKind::Moire(moire) => self.moire(moire, at),
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

    /// A `Moire`: rings around the origin, the outermost centred on `diameter`, and an
    /// optional crosshair (IPC-2581C §3.5.9.8).
    fn moire(&mut self, moire: &ipc::Moire, at: DAffine2) -> Option<Shape> {
        let (s, center) = (scale(at), at.transform_point2(DVec2::ZERO));
        let half = moire.ring_width / 2.0;
        let mut rings = moire.ring_number;
        if moire.ring_gap <= 0.0 {
            rings = rings.min(1);
        }
        if rings > MAX_MOIRE_RINGS {
            self.warn(format!(
                "moires are drawn with at most {MAX_MOIRE_RINGS} rings"
            ));
            rings = MAX_MOIRE_RINGS;
        }
        let mut parts = Vec::new();
        for k in 0..rings {
            let radius = moire.diameter / 2.0 - f64::from(k) * moire.ring_gap;
            if radius + half <= 0.0 || half <= 0.0 {
                break;
            }
            let outer = circle_path(center, (radius + half) * s);
            parts.push(if radius - half > 0.0 {
                Shape::Polygon {
                    outline: outer,
                    holes: vec![circle_path(center, (radius - half) * s)],
                }
            } else {
                polygon(outer)
            });
        }
        if moire.line_width > 0.0 {
            let length = moire
                .line_length
                .unwrap_or(moire.diameter + moire.ring_width);
            for quarter in [0.0, 90.0] {
                let reach = DVec2::from_angle((moire.line_angle + quarter).to_radians()) * length;
                let p = Path::new(at.transform_point2(-reach / 2.0))
                    .line_to(at.transform_point2(reach / 2.0));
                parts.extend(stroke(p, moire.line_width * s, LineEnd::None));
            }
        }
        union(parts)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// The drawn area: fills and strokes.
    Area,
    /// The enclosed area of closed outlines; open strokes are dropped.
    Filled,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Fill {
    Solid,
    Hollow,
    Void,
    /// `HATCH` or `MESH`.
    Hatch(Hatch),
}

/// The lines of a hatched (one direction) or meshed (two directions) fill.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Hatch {
    /// `lineWidth`; 0 if absent.
    width: f64,
    /// `angle1` in degrees and `pitch1`.
    first: (f64, Option<f64>),
    /// `angle2` in degrees and `pitch2`, for a mesh.
    second: Option<(f64, Option<f64>)>,
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

/// A glyph of a `Text`.
#[derive(Clone, Copy)]
enum Glyph<'a> {
    Embedded(&'a ipc::Glyph),
    Bundled(&'a StrokeGlyph),
}

/// The vertical extent of an embedded font's cell: the lowest and highest edge of its glyph
/// cells. `None` if it has no glyphs.
fn cell(font: &ipc::EmbeddedFont) -> Option<(f64, f64)> {
    let bottom = font
        .glyphs
        .iter()
        .map(|g| g.lower_left.y.min(g.upper_right.y));
    let top = font
        .glyphs
        .iter()
        .map(|g| g.lower_left.y.max(g.upper_right.y));
    let (bottom, top) = (
        bottom.fold(f64::MAX, f64::min),
        top.fold(f64::MIN, f64::max),
    );
    (top > bottom).then_some((bottom, top))
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

fn stroke(path: Path, width: f64, end: LineEnd) -> Option<Shape> {
    if width.is_nan() || width <= 0.0 {
        return None;
    }
    Some(Shape::Stroke(Stroke {
        path,
        width,
        cap: match end {
            LineEnd::Round => LineCap::Round,
            LineEnd::Square => LineCap::Square,
            LineEnd::None => LineCap::Flat,
        },
    }))
}

/// The dash pattern of a `lineProperty` for a line of `width`, as centre-line lengths
/// alternating dash and gap (spec §6.1). `None` for solid lines.
///
/// IPC-2581C §3.5.5.1 gives the visible lengths in line widths: `DOTTED` dots 1 and gaps 2,
/// `DASHED` dashes and gaps 3, `CENTER` a dash 6, gap 2, dot 1, gap 2, and `PHANTOM` the same
/// with two dots. Round and square ends reach half a width past a dash's centre line.
fn pattern(property: LineProperty, width: f64, end: LineEnd) -> Option<Vec<f64>> {
    let visible: &[f64] = match property {
        LineProperty::Solid | LineProperty::Erase => return None,
        LineProperty::Dotted => &[1.0, 2.0],
        LineProperty::Dashed => &[3.0, 3.0],
        LineProperty::Center => &[6.0, 2.0, 1.0, 2.0],
        LineProperty::Phantom => &[6.0, 2.0, 1.0, 2.0, 1.0, 2.0],
    };
    let caps = match end {
        LineEnd::Round | LineEnd::Square => width,
        LineEnd::None => 0.0,
    };
    Some(
        visible
            .iter()
            .enumerate()
            .map(|(k, v)| {
                if k % 2 == 0 {
                    (v * width - caps).max(0.0)
                } else {
                    v * width + caps
                }
            })
            .collect(),
    )
}

/// A box around the paths: their points, and the full circles of their arcs.
fn bounds(paths: &[Path]) -> Option<(DVec2, DVec2)> {
    let mut min = DVec2::splat(f64::INFINITY);
    let mut max = DVec2::splat(f64::NEG_INFINITY);
    for p in paths {
        let mut current = p.start;
        min = min.min(current);
        max = max.max(current);
        for segment in &p.segments {
            match *segment {
                boardui_geom::Segment::Line { end } => current = end,
                boardui_geom::Segment::Arc { end, center, .. } => {
                    let r = center.distance(current).max(center.distance(end));
                    min = min.min(center - DVec2::splat(r));
                    max = max.max(center + DVec2::splat(r));
                    current = end;
                }
            }
            min = min.min(current);
            max = max.max(current);
        }
    }
    (min.is_finite() && max.is_finite()).then_some((min, max))
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
        PrimitiveKind::Hexagon { length } => {
            // `length` is across the corners, with a corner pointing up (IPC-2581C §3.5.9.7).
            poly_path(&regular(6, length / 2.0, FRAC_PI_2), at)
        }
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
        | PrimitiveKind::Moire(_)
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
                property: LineProperty::Solid,
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
    fn zero_width_lines_are_hairlines() {
        let c = content();
        let zero = ipc::LineStyle::Desc(ipc::LineDesc {
            width: 0.0,
            end: LineEnd::None,
            property: LineProperty::Solid,
        });
        let open = ipc::Path {
            start: ipc::Point { x: 0.0, y: 0.0 },
            steps: vec![ipc::PolyStep::Segment {
                to: ipc::Point { x: 2e-3, y: 0.0 },
            }],
        };
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        let at = DAffine2::from_scale(DVec2::splat(3.0));
        let polyline = ipc::Shape::Polyline(ipc::Polyline {
            path: open,
            line: zero.clone(),
        });
        // A hairline keeps its width under a scaling `Xform`.
        let s = conv.area(&polyline, at).unwrap();
        close_to(area(&s), 6e-3 * HAIRLINE, 1e-12);
        assert_eq!(conv.warnings.len(), 1);
        // The zero-width line of a filled outline is not drawn.
        let square = ipc::Polygon {
            path: ipc::Path {
                start: ipc::Point { x: 0.0, y: 0.0 },
                steps: [(1e-3, 0.0), (1e-3, 1e-3), (0.0, 1e-3), (0.0, 0.0)]
                    .map(|(x, y)| ipc::PolyStep::Segment {
                        to: ipc::Point { x, y },
                    })
                    .to_vec(),
            },
            line: None,
            fill: None,
        };
        let outline = ipc::Shape::Outline(ipc::Outline {
            polygon: square,
            line: zero,
        });
        let s = conv.area(&outline, DAffine2::IDENTITY).unwrap();
        close_to(area(&s), 1e-6, 1e-15);
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

    fn desc(width: f64, end: LineEnd, property: LineProperty) -> ipc::LineStyle {
        ipc::LineStyle::Desc(ipc::LineDesc {
            width,
            end,
            property,
        })
    }

    fn line(x0: f64, x1: f64, style: ipc::LineStyle) -> ipc::Shape {
        ipc::Shape::Line(ipc::Line {
            start: ipc::Point { x: x0, y: 0.0 },
            end: ipc::Point { x: x1, y: 0.0 },
            line: style,
        })
    }

    /// A square polygon from the origin to `(side, side)`.
    fn square(side: f64, line: Option<ipc::LineStyle>, fill: Option<ipc::FillDesc>) -> ipc::Shape {
        ipc::Shape::Polygon(ipc::Polygon {
            path: ipc::Path {
                start: ipc::Point { x: 0.0, y: 0.0 },
                steps: [(side, 0.0), (side, side), (0.0, side), (0.0, 0.0)]
                    .map(|(x, y)| ipc::PolyStep::Segment {
                        to: ipc::Point { x, y },
                    })
                    .to_vec(),
            },
            line,
            fill: fill.map(|f| ipc::FillStyle::Desc(Box::new(f))),
        })
    }

    fn hatch(property: FillProperty, width: f64, pitch: f64) -> ipc::FillDesc {
        ipc::FillDesc {
            property,
            line_width: Some(width),
            pitch1: Some(pitch),
            pitch2: Some(pitch),
            angle1: Some(0.0),
            angle2: Some(90.0),
        }
    }

    #[test]
    fn hexagons_point_up() {
        let c = content();
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        let s = conv
            .area(
                &std(PrimitiveKind::Hexagon { length: 2e-3 }),
                DAffine2::IDENTITY,
            )
            .unwrap();
        // Corners snap to the 10 nm grid.
        close_to(area(&s), 1.5 * 3f64.sqrt() * 1e-6, 6e-3 * 10e-9);
        let (min, max) = bounds(&s);
        close_to(max.y, 1e-3, 1e-9);
        close_to(min.y, -1e-3, 1e-9);
        close_to(max.x, 3f64.sqrt() / 2.0 * 1e-3, 1e-8);
    }

    #[test]
    fn moires_have_rings_and_a_crosshair() {
        let c = content();
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        let moire = ipc::Moire {
            diameter: 4e-3,
            ring_width: 0.2e-3,
            ring_gap: 0.5e-3,
            ring_number: 3,
            line_width: 0.0,
            line_length: None,
            line_angle: 0.0,
        };
        let rings = conv
            .area(&std(PrimitiveKind::Moire(moire)), DAffine2::IDENTITY)
            .unwrap();
        // Rings centred on radii 2, 1.5 and 1 mm.
        close_to(area(&rings), TAU * 0.2e-3 * 4.5e-3, 3e-2 * T.metres());
        close_to(bounds(&rings).1.x, 2.1e-3, 1e-8);
        // A crosshair of 5 mm, turned by 90°: the same.
        let crossed = conv
            .area(
                &std(PrimitiveKind::Moire(ipc::Moire {
                    line_width: 0.1e-3,
                    line_length: Some(5e-3),
                    line_angle: 90.0,
                    ..moire
                })),
                DAffine2::IDENTITY,
            )
            .unwrap();
        close_to(bounds(&crossed).1.x, 2.5e-3, 1e-8);
        close_to(bounds(&crossed).1.y, 2.5e-3, 1e-8);
        assert!(area(&crossed) > area(&rings) + 0.5e-6);
        // Rings that would pass the centre stop there.
        let many = conv
            .area(
                &std(PrimitiveKind::Moire(ipc::Moire {
                    ring_number: 100,
                    ..moire
                })),
                DAffine2::IDENTITY,
            )
            .unwrap();
        assert!(area(&many) < PI * 4.5e-6);
        assert!(conv.warnings.is_empty(), "{:?}", conv.warnings);
    }

    #[test]
    fn hatched_and_meshed_fills_are_lines() {
        let c = content();
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        // Lines at y = 0, 1, …, 10 mm: the outer two are half inside.
        let hatched = square(10e-3, None, Some(hatch(FillProperty::Hatch, 0.2e-3, 1e-3)));
        let s = conv.area(&hatched, DAffine2::IDENTITY).unwrap();
        close_to(area(&s), 20e-6, 1e-12);
        let meshed = square(10e-3, None, Some(hatch(FillProperty::Mesh, 0.2e-3, 1e-3)));
        let s = conv.area(&meshed, DAffine2::IDENTITY).unwrap();
        close_to(area(&s), 36e-6, 1e-12);
        // With its outline: a 0.4 mm wide ring along the edge, over the lines at 0 and 10 mm.
        let outlined = square(
            10e-3,
            Some(desc(0.4e-3, LineEnd::Square, LineProperty::Solid)),
            Some(hatch(FillProperty::Hatch, 0.2e-3, 1e-3)),
        );
        let s = conv.area(&outlined, DAffine2::IDENTITY).unwrap();
        let ring = 10.4e-3 * 10.4e-3 - 9.6e-3 * 9.6e-3;
        let inside = 9.0 * 9.6e-3 * 0.2e-3;
        close_to(area(&s), ring + inside, 1e-12);
        // The hatch follows a rotating `Xform`.
        let at = DAffine2::from_angle(FRAC_PI_2);
        let s = conv.area(&hatched, at).unwrap();
        close_to(area(&s), 20e-6, 1e-12);
        assert!(conv.warnings.is_empty(), "{:?}", conv.warnings);
    }

    #[test]
    fn pathological_hatches_are_solid() {
        let c = content();
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        for pitch in [0.0, 1e-9] {
            let s = conv
                .area(
                    &square(10e-3, None, Some(hatch(FillProperty::Hatch, 1e-9, pitch))),
                    DAffine2::IDENTITY,
                )
                .unwrap();
            close_to(area(&s), 100e-6, 1e-15);
        }
        assert_eq!(conv.warnings.len(), 2, "{:?}", conv.warnings);
    }

    #[test]
    fn dashed_and_dotted_lines() {
        let c = content();
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        let dash = 0.4e-3 * 0.2e-3 + PI * 0.1e-3 * 0.1e-3;
        // Dashes of 0.6 mm (caps included) every 1.2 mm: nine on 10.1 mm.
        let dashed = line(
            0.0,
            10.1e-3,
            desc(0.2e-3, LineEnd::Round, LineProperty::Dashed),
        );
        let s = conv.area(&dashed, DAffine2::IDENTITY).unwrap();
        close_to(area(&s), 9.0 * dash, 9.0 * 6e-4 * T.metres());
        // Flat ends: the dashes are 0.6 mm long themselves, and the last is cut short.
        let flat = line(
            0.0,
            10.1e-3,
            desc(0.2e-3, LineEnd::None, LineProperty::Dashed),
        );
        let s = conv.area(&flat, DAffine2::IDENTITY).unwrap();
        close_to(area(&s), (8.0 * 0.6e-3 + 0.5e-3) * 0.2e-3, 1e-12);
        // Dots of 0.2 mm every 0.6 mm: five on 2.9 mm.
        let dotted = line(
            0.0,
            2.9e-3,
            desc(0.2e-3, LineEnd::Round, LineProperty::Dotted),
        );
        let s = conv.area(&dotted, DAffine2::IDENTITY).unwrap();
        close_to(area(&s), 5.0 * PI * 0.01e-6, 5.0 * 6e-4 * T.metres());
        // Centre lines alternate long dashes and dots, phantom lines add a second dot.
        let center = line(
            0.0,
            10e-3,
            desc(0.1e-3, LineEnd::None, LineProperty::Center),
        );
        let phantom = line(
            0.0,
            10e-3,
            desc(0.1e-3, LineEnd::None, LineProperty::Phantom),
        );
        let (center, phantom) = (
            area(&conv.area(&center, DAffine2::IDENTITY).unwrap()),
            area(&conv.area(&phantom, DAffine2::IDENTITY).unwrap()),
        );
        // Per 1.1 mm: 0.7 mm drawn; per 1.4 mm: 0.8 mm drawn.
        close_to(center, (9.0 * 0.7e-3 + 0.1e-3) * 0.1e-3, 1e-12);
        close_to(phantom, (7.0 * 0.8e-3 + 0.2e-3) * 0.1e-3, 1e-12);
        assert!(conv.warnings.is_empty(), "{:?}", conv.warnings);
    }

    #[test]
    fn erasing_lines_cut() {
        let c = content();
        let erase = desc(0.2e-3, LineEnd::None, LineProperty::Erase);
        let cut = line(-1e-3, 3e-3, erase.clone());
        assert!(erases(&cut, &c));
        let group = ipc::Shape::UserSpecial(vec![square(2e-3, None, None), cut.clone()]);
        assert!(!erases(&group, &c));
        assert!(erases(&ipc::Shape::UserSpecial(vec![cut.clone()]), &c));
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        // The line along y = 0 erases half its width from the square.
        let s = conv.area(&group, DAffine2::IDENTITY).unwrap();
        close_to(area(&s), 4e-6 - 2e-3 * 0.1e-3, 1e-12);
        // An erasing line drawn first erases nothing of the group.
        let first = ipc::Shape::UserSpecial(vec![cut.clone(), square(2e-3, None, None)]);
        close_to(
            area(&conv.area(&first, DAffine2::IDENTITY).unwrap()),
            4e-6,
            1e-12,
        );
        // Alone, it is the area the caller erases.
        close_to(
            area(&conv.area(&cut, DAffine2::IDENTITY).unwrap()),
            0.8e-6,
            1e-12,
        );
        // An erasing outline cuts its own fill.
        let outlined = square(2e-3, Some(erase), None);
        let s = conv.area(&outlined, DAffine2::IDENTITY).unwrap();
        close_to(area(&s), 1.8e-3 * 1.8e-3, 1e-12);
    }

    fn text(string: &str, width: f64, height: f64, font: Option<&str>) -> ipc::Shape {
        ipc::Shape::Text(Box::new(ipc::Text {
            string: string.to_owned(),
            font_size: None,
            xform: ipc::Xform::default(),
            lower_left: ipc::Point::default(),
            upper_right: ipc::Point {
                x: width,
                y: height,
            },
            font_ref: font.map(str::to_owned),
            line: None,
            color: None,
        }))
    }

    /// Content with embedded font `E` in millimetres: an `I` (a 0.1 mm line) in a cell from
    /// -0.25 to 1, and a stroke of 0.05; external font `X`.
    fn fonts() -> ipc::Content {
        let xml = r#"<IPC-2581 revision="C"><Content><FunctionMode mode="ASSEMBLY"/>
            <DictionaryFont units="MILLIMETER">
              <EntryFont id="E"><FontDefEmbedded name="plotter">
                <LineDesc lineWidth="0.05" lineEnd="ROUND"/>
                <Glyph charCode="49" lowerLeftX="0" lowerLeftY="-0.25" upperRightX="0.5" upperRightY="1">
                  <Line startX="0.25" startY="0" endX="0.25" endY="1"><LineDesc lineWidth="0.1" lineEnd="ROUND"/></Line>
                </Glyph>
              </FontDefEmbedded></EntryFont>
              <EntryFont id="X"><FontDefExternal name="Arial" urn="urn:arial"/></EntryFont>
            </DictionaryFont></Content>
            <Ecad name="e"><CadHeader units="MILLIMETER"/><CadData/></Ecad></IPC-2581>"#;
        ipc::parse_bytes(xml.as_bytes()).unwrap().content
    }

    fn close_to_box(actual: (DVec2, DVec2), min: (f64, f64), max: (f64, f64)) {
        // Round caps are polygons: their extremes may fall a few micrometres short.
        let eps = 5e-6;
        close_to(actual.0.x, min.0, eps);
        close_to(actual.0.y, min.1, eps);
        close_to(actual.1.x, max.0, eps);
        close_to(actual.1.y, max.1, eps);
    }

    #[test]
    fn bundled_text_fills_the_box_height() {
        let c = content();
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        // The cell is 28 units (descenders to capitals): 0.1 mm per unit, strokes
        // 0.15 × 2.1 mm wide. `H` has stems at 5 and 17 units of its 22.
        let s = conv
            .area(&text("HH", 10e-3, 2.8e-3, None), DAffine2::IDENTITY)
            .unwrap();
        let w = STROKE_WIDTH * 2.1e-3 / 2.0;
        let (bottom, top) = (0.7e-3 - w, 2.8e-3 + w);
        close_to_box(bounds(&s), (0.5e-3 - w, bottom), (3.9e-3 + w, top));
        assert_eq!(conv.take_warnings(), Vec::<String>::new());

        // Rotated and mirrored by the `Text`'s `Xform`, then placed.
        let ipc::Shape::Text(mut t) = text("HH", 10e-3, 2.8e-3, None) else {
            unreachable!()
        };
        t.xform = ipc::Xform {
            rotation: 90.0,
            mirror: true,
            ..ipc::Xform::default()
        };
        let at = DAffine2::from_translation(DVec2::new(1.0, 2.0));
        let s = conv.area(&ipc::Shape::Text(t), at).unwrap();
        // Mirrored (x → -x), then rotated (x, y) → (-y, x).
        close_to_box(
            bounds(&s),
            (1.0 - top, 2.0 - 3.9e-3 - w),
            (1.0 - bottom, 2.0 - 0.5e-3 + w),
        );
    }

    #[test]
    fn wide_text_is_scaled_down_to_fit() {
        let c = content();
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        // 88 units into 2.2 mm: 0.025 mm per unit, centred in the 2.8 mm height.
        let s = conv
            .area(&text("HHHH", 2.2e-3, 2.8e-3, None), DAffine2::IDENTITY)
            .unwrap();
        let w = STROKE_WIDTH * 21.0 * 0.025e-3 / 2.0;
        let lift = (2.8e-3 - 28.0 * 0.025e-3) / 2.0;
        close_to_box(
            bounds(&s),
            (5.0 * 0.025e-3 - w, lift + 7.0 * 0.025e-3 - w),
            (83.0 * 0.025e-3 + w, lift + 28.0 * 0.025e-3 + w),
        );
        assert_eq!(
            conv.take_warnings(),
            ["a text wider than its bounding box was scaled down to fit"]
        );
        assert!(conv.take_warnings().is_empty());
        // An empty box draws nothing.
        assert!(
            conv.area(&text("H", 0.0, 1e-3, None), DAffine2::IDENTITY)
                .is_none()
        );
        assert!(
            conv.area(&text("", 1e-3, 1e-3, None), DAffine2::IDENTITY)
                .is_none()
        );
    }

    #[test]
    fn embedded_glyphs_and_their_fallbacks() {
        let c = fonts();
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        // The 1.25 mm cell into 2.5 mm: scale 2, lines 0.2 mm wide at x = 0.5 and 1.5 mm,
        // from the baseline at 0.5 mm to 2.5 mm.
        let s = conv
            .area(&text("II", 10e-3, 2.5e-3, Some("E")), DAffine2::IDENTITY)
            .unwrap();
        close_to_box(bounds(&s), (0.4e-3, 0.4e-3), (1.6e-3, 2.6e-3));
        assert!(conv.take_warnings().is_empty());
        // Characters the font lacks come from the bundled font, scaled to its cell, and
        // unknown ones are boxes; the bundled strokes are as wide as the font's.
        let s = conv
            .area(
                &text("I-\u{2603}\u{2603}Ω", 10e-3, 2.5e-3, Some("E")),
                DAffine2::IDENTITY,
            )
            .unwrap();
        let (min, max) = bounds(&s);
        close_to(min.x, 0.4e-3, 5e-6);
        // Three boxes of 16 units after `I` (1 mm) and `-` (its advance).
        let unit = 2.5e-3 / 28.0;
        let dash = StrokeFont::get().glyph('-').unwrap().advance * unit;
        close_to(
            max.x,
            1e-3 + dash + 2.0 * 16.0 * unit + 13.0 * unit + 0.05e-3,
            2e-6,
        );
        close_to(max.y, 2.6e-3, 5e-6);
        assert_eq!(
            conv.take_warnings(),
            [
                "embedded font `plotter` lacks some characters; they are drawn with the bundled font",
                "text characters without a glyph are drawn as boxes: U+03A9, U+2603",
            ]
        );
        // External and undefined fonts fall back to the bundled font.
        for (font, warning) in [
            (
                "X",
                "external font `Arial` is not available; its text is drawn with the bundled font",
            ),
            (
                "nope",
                "font `nope` is not defined; its text is drawn with the bundled font",
            ),
        ] {
            let s = conv
                .area(&text("HH", 10e-3, 2.8e-3, Some(font)), DAffine2::IDENTITY)
                .unwrap();
            close_to(bounds(&s).1.x, 3.9e-3 + STROKE_WIDTH * 2.1e-3 / 2.0, 5e-6);
            assert_eq!(conv.take_warnings(), [warning]);
        }
    }

    #[test]
    fn text_strokes_follow_a_line_desc() {
        let c = content();
        let mut conv = ShapeConverter::new(&c, T, MirrorOrder::MirrorThenRotate);
        let ipc::Shape::Text(mut t) = text("H", 10e-3, 2.8e-3, None) else {
            unreachable!()
        };
        t.line = Some(desc(0.4e-3, LineEnd::Round, LineProperty::Solid));
        let s = conv.area(&ipc::Shape::Text(t), DAffine2::IDENTITY).unwrap();
        close_to_box(bounds(&s), (0.3e-3, 0.5e-3), (1.9e-3, 3.0e-3));
        assert!(
            conv.filled(&text("H", 1e-3, 1e-3, None), DAffine2::IDENTITY)
                .is_none()
        );
    }

    #[test]
    fn texts_are_collected_and_strokes() {
        let c = content();
        let group = ipc::Shape::UserSpecial(vec![
            text("R1", 1e-3, 1e-3, None),
            square(1e-3, None, None),
            ipc::Shape::UserSpecial(vec![text("10k", 1e-3, 1e-3, None)]),
        ]);
        assert_eq!(texts(&group, &c), ["R1", "10k"]);
        assert!(texts(&square(1e-3, None, None), &c).is_empty());
        assert!(is_stroke(&text("A", 1e-3, 1e-3, None), &c));
        assert!(!erases(&text("A", 1e-3, 1e-3, None), &c));
    }
}
