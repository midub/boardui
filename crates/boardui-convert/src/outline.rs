//! The board outline: step profiles, with the cut-outs that only a board outline layer draws
//! (spec §6.7).
//!
//! KiCad writes the `Profile` as the outer polygon alone and leaves the board's inner
//! contours (holes, slots, the gaps of a panel) on `Edge.Cuts`, a `BOARD_OUTLINE` layer, as
//! separate lines and arcs. When a step's profile has no `Cutout`, the closed contours of its
//! board outline layers that lie inside the profile are cut out of it.

use std::collections::HashMap;
use std::f64::consts::TAU;

use boardui_geom::{ArcDirection, DVec2, Path, Region, Shape, Tolerance};
use boardui_ipc2581 as ipc;
use glam::DAffine2;

use crate::Warnings;
use crate::panel::Part;
use crate::shapes::{ShapeConverter, closed, direction, point};

/// Segment ends this close are joined into one contour. KiCad chains `Edge.Cuts` with the
/// same distance.
pub(crate) const CHAIN_GAP: f64 = 20e-6;
/// A contour is a cut-out only if it stays this far inside the profile: the contour that
/// traces the profile itself is not one.
pub(crate) const MIN_CLEARANCE: f64 = 20e-6;
/// The area of a contour outside the shrunk profile below which it counts as inside, in m².
const OUTSIDE_AREA: f64 = 1e-12;
/// Nesting depth of user primitives followed.
const MAX_DEPTH: usize = 16;

/// Whether a `layerFunction` is the board outline.
pub(crate) fn is_board_outline(function: &str) -> bool {
    function.eq_ignore_ascii_case("BOARD_OUTLINE")
}

/// A line or arc of a board outline layer.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Edge {
    start: DVec2,
    end: DVec2,
    /// Centre and direction of an arc; `None` for a line.
    arc: Option<(DVec2, ArcDirection)>,
}

impl Edge {
    fn reversed(self) -> Self {
        let arc = self.arc.map(|(center, d)| {
            let d = match d {
                ArcDirection::Clockwise => ArcDirection::CounterClockwise,
                ArcDirection::CounterClockwise => ArcDirection::Clockwise,
            };
            (center, d)
        });
        Self {
            start: self.end,
            end: self.start,
            arc,
        }
    }

    fn transformed(self, at: DAffine2) -> Self {
        let mirrored = at.matrix2.determinant() < 0.0;
        let arc = self.arc.map(|(center, d)| {
            let d = match (d, mirrored) {
                (d, false) => d,
                (ArcDirection::Clockwise, true) => ArcDirection::CounterClockwise,
                (ArcDirection::CounterClockwise, true) => ArcDirection::Clockwise,
            };
            (at.transform_point2(center), d)
        });
        Self {
            start: at.transform_point2(self.start),
            end: at.transform_point2(self.end),
            arc,
        }
    }

    /// Length along the edge; an arc that ends where it starts is a full circle.
    fn length(&self) -> f64 {
        let Some((center, d)) = self.arc else {
            return self.start.distance(self.end);
        };
        let (a, b) = (self.start - center, self.end - center);
        let mut sweep = a.angle_to(b);
        if d == ArcDirection::Clockwise {
            sweep = -sweep;
        }
        if sweep <= 1e-12 {
            sweep += TAU;
        }
        sweep * a.length().max(b.length())
    }
}

/// A closed contour of a board outline layer, in step coordinates.
#[derive(Debug)]
enum Contour<'a> {
    /// Lines and arcs chained end to end; the last ends at the first's start.
    Chain(Vec<Edge>),
    /// A closed shape (polygon, outline, closed polyline, standard primitive) placed with
    /// `at`.
    Closed { shape: &'a ipc::Shape, at: DAffine2 },
}

impl Contour<'_> {
    /// The area it encloses, placed with `frame`.
    fn shape(&self, frame: DAffine2, shapes: &mut ShapeConverter<'_>) -> Option<Shape> {
        match self {
            Self::Chain(edges) => {
                let mut path = Path::new(frame.transform_point2(edges.first()?.start));
                for edge in edges {
                    let edge = edge.transformed(frame);
                    path = match edge.arc {
                        None => path.line_to(edge.end),
                        Some((center, d)) => path.arc_to(edge.end, center, d),
                    };
                }
                Some(Shape::Polygon {
                    outline: path,
                    holes: Vec::new(),
                })
            }
            Self::Closed { shape, at } => shapes.filled(shape, frame * *at),
        }
    }
}

/// The cut-outs each placed step takes from its board outline layers.
pub(crate) struct Cutouts<'a> {
    by_step: HashMap<&'a str, Vec<Contour<'a>>>,
}

impl<'a> Cutouts<'a> {
    /// Finds the cut-outs of the steps of `parts` whose profile has no `Cutout`, once per
    /// step, with one warning per step that gets some.
    pub(crate) fn find(
        ecad: &'a ipc::Ecad,
        content: &'a ipc::Content,
        parts: &[Part<'a>],
        shapes: &mut ShapeConverter<'_>,
        tolerance: Tolerance,
        warnings: &mut Warnings,
    ) -> Self {
        let mut by_step = HashMap::new();
        for part in parts {
            let step = part.step;
            if by_step.contains_key(step.name.as_str()) {
                continue;
            }
            let found = step_cutouts(ecad, content, step, shapes, tolerance);
            if !found.is_empty() {
                let mut layers: Vec<(&str, usize)> = Vec::new();
                for (layer, _) in &found {
                    match layers.iter_mut().find(|(l, _)| l == layer) {
                        Some((_, n)) => *n += 1,
                        None => layers.push((layer, 1)),
                    }
                }
                let counts: Vec<String> = layers
                    .iter()
                    .map(|(layer, n)| format!("{n} on layer `{layer}`"))
                    .collect();
                warnings.push(format!(
                    "the profile of step `{}` has no cutouts; the closed contours inside it were cut out: {}",
                    step.name,
                    counts.join(", ")
                ));
            }
            by_step.insert(
                step.name.as_str(),
                found.into_iter().map(|(_, c)| c).collect(),
            );
        }
        Self { by_step }
    }

    /// The outline of a part: its step's profile with its cut-outs, placed on the board.
    /// `None` without a profile.
    pub(crate) fn profile(
        &self,
        part: &Part<'_>,
        shapes: &mut ShapeConverter<'_>,
    ) -> Option<Shape> {
        let base = shapes.contour(part.step.profile.as_ref()?, part.frame)?;
        let cut: Vec<Shape> = self
            .by_step
            .get(part.step.name.as_str())
            .into_iter()
            .flatten()
            .filter_map(|c| c.shape(part.frame, shapes))
            .collect();
        if cut.is_empty() {
            return Some(base);
        }
        Some(Shape::Difference {
            base: Box::new(base),
            cut,
        })
    }
}

/// The closed contours of `step`'s board outline layers that lie inside its profile, with
/// their layer, if the profile has no `Cutout`.
fn step_cutouts<'a>(
    ecad: &'a ipc::Ecad,
    content: &'a ipc::Content,
    step: &'a ipc::Step,
    shapes: &mut ShapeConverter<'_>,
    tolerance: Tolerance,
) -> Vec<(&'a str, Contour<'a>)> {
    let Some(profile) = &step.profile else {
        return Vec::new();
    };
    if !profile.cutouts.is_empty() {
        return Vec::new();
    }
    let mut contours = Vec::new();
    for (name, lf) in step.layer_features.iter() {
        if !ecad
            .layers
            .get(name)
            .is_some_and(|l| is_board_outline(&l.function))
        {
            continue;
        }
        let mut edges = Vec::new();
        let mut closed = Vec::new();
        for (_, feature) in lf.features() {
            if let ipc::FeatureElement::Features(f) = &feature.element {
                let at = shapes.placement(f.location, &f.xform);
                collect(&f.shape, at, content, 0, &mut edges, &mut closed);
            }
        }
        let (chains, open) = chain(edges);
        if open > 0 {
            tracing::debug!("layer {name}: {open} open contours ignored");
        }
        contours.extend(
            chains
                .into_iter()
                .map(Contour::Chain)
                .chain(closed)
                .map(|c| (name, c)),
        );
    }
    if contours.is_empty() {
        return Vec::new();
    }
    let inside = shapes
        .contour(profile, DAffine2::IDENTITY)
        .and_then(|s| s.to_region(tolerance).ok())
        .and_then(|r| r.offset(-MIN_CLEARANCE, tolerance).ok());
    let Some(inside) = inside.filter(|r| !r.is_empty()) else {
        return Vec::new();
    };
    contours
        .into_iter()
        .filter(|(_, c)| {
            let region = c
                .shape(DAffine2::IDENTITY, shapes)
                .and_then(|s| s.to_region(tolerance).ok());
            region.is_some_and(|r| is_inside(&r, &inside))
        })
        .collect()
}

/// Whether a contour's area is non-empty and lies within `inside`.
fn is_inside(region: &Region, inside: &Region) -> bool {
    !region.is_empty() && region.difference(inside).area() <= OUTSIDE_AREA
}

/// Splits a shape of a board outline layer into lines and arcs (`edges`) and closed shapes.
fn collect<'a>(
    shape: &'a ipc::Shape,
    at: DAffine2,
    content: &'a ipc::Content,
    depth: usize,
    edges: &mut Vec<Edge>,
    closed_shapes: &mut Vec<Contour<'a>>,
) {
    match shape {
        ipc::Shape::Line(line) => edges.push(Edge {
            start: at.transform_point2(point(line.start)),
            end: at.transform_point2(point(line.end)),
            arc: None,
        }),
        ipc::Shape::Arc(arc) => edges.push(Edge {
            start: at.transform_point2(point(arc.start)),
            end: at.transform_point2(point(arc.end)),
            arc: Some((
                at.transform_point2(point(arc.center)),
                direction(arc.clockwise, at),
            )),
        }),
        ipc::Shape::Polyline(polyline) if !closed(&polyline.path) => {
            let mut current = at.transform_point2(point(polyline.path.start));
            for step in &polyline.path.steps {
                let edge = match *step {
                    ipc::PolyStep::Segment { to } => Edge {
                        start: current,
                        end: at.transform_point2(point(to)),
                        arc: None,
                    },
                    ipc::PolyStep::Curve {
                        to,
                        center,
                        clockwise,
                    } => Edge {
                        start: current,
                        end: at.transform_point2(point(to)),
                        arc: Some((at.transform_point2(point(center)), direction(clockwise, at))),
                    },
                };
                current = edge.end;
                edges.push(edge);
            }
        }
        ipc::Shape::UserSpecial(parts) => {
            for part in parts {
                collect(part, at, content, depth, edges, closed_shapes);
            }
        }
        ipc::Shape::UserRef(id) if depth < MAX_DEPTH => {
            if let Some(shape) = content.user_primitives.get(id) {
                collect(shape, at, content, depth + 1, edges, closed_shapes);
            }
        }
        ipc::Shape::Polyline(_)
        | ipc::Shape::Polygon(_)
        | ipc::Shape::Outline(_)
        | ipc::Shape::Standard(_)
        | ipc::Shape::StandardRef(_) => closed_shapes.push(Contour::Closed { shape, at }),
        ipc::Shape::UserRef(_) | ipc::Shape::Text(_) | ipc::Shape::Unsupported { .. } => {}
    }
}

/// Chains edges whose ends meet (within [`CHAIN_GAP`]) into closed contours, in any order
/// and direction. Returns the closed chains and the number of chains left open.
fn chain(edges: Vec<Edge>) -> (Vec<Vec<Edge>>, usize) {
    let cell = |p: DVec2| {
        (
            (p.x / CHAIN_GAP).floor() as i64,
            (p.y / CHAIN_GAP).floor() as i64,
        )
    };
    let mut ends: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for (i, e) in edges.iter().enumerate() {
        ends.entry(cell(e.start)).or_default().push(i);
        if cell(e.end) != cell(e.start) {
            ends.entry(cell(e.end)).or_default().push(i);
        }
    }
    let mut used = vec![false; edges.len()];
    let (mut chains, mut open) = (Vec::new(), 0);
    for first in 0..edges.len() {
        if used[first] {
            continue;
        }
        used[first] = true;
        let mut chain = vec![edges[first]];
        let start = edges[first].start;
        let mut length = edges[first].length();
        loop {
            let end = chain.last().expect("chain").end;
            // A contour shorter than a few gaps is a speck, not a closed loop.
            if end.distance(start) <= CHAIN_GAP && length > 3.0 * CHAIN_GAP {
                chain.last_mut().expect("chain").end = start;
                chains.push(chain);
                break;
            }
            // The unused edge with an end nearest to this one.
            let (cx, cy) = cell(end);
            let mut best: Option<(f64, usize, bool)> = None;
            for x in cx - 1..=cx + 1 {
                for y in cy - 1..=cy + 1 {
                    for &i in ends.get(&(x, y)).into_iter().flatten() {
                        if used[i] {
                            continue;
                        }
                        for (d, reverse) in [
                            (edges[i].start.distance(end), false),
                            (edges[i].end.distance(end), true),
                        ] {
                            if d <= CHAIN_GAP && best.is_none_or(|(b, _, _)| d < b) {
                                best = Some((d, i, reverse));
                            }
                        }
                    }
                }
            }
            let Some((_, i, reverse)) = best else {
                open += 1;
                break;
            };
            used[i] = true;
            let edge = if reverse {
                edges[i].reversed()
            } else {
                edges[i]
            };
            length += edge.length();
            chain.push(edge);
        }
    }
    (chains, open)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Warning;
    use crate::shapes::MirrorOrder;

    fn mm(x: f64, y: f64) -> DVec2 {
        DVec2::new(x, y) * 1e-3
    }

    fn line(start: DVec2, end: DVec2) -> Edge {
        Edge {
            start,
            end,
            arc: None,
        }
    }

    #[test]
    fn chains_edges_in_any_order_and_direction() {
        let off = DVec2::new(5e-6, 0.0);
        let edges = vec![
            line(mm(1.0, 0.0), mm(1.0, 1.0)),
            // Ends 5 µm short of the corner.
            line(mm(0.0, 1.0), mm(0.0, 0.0) + off),
            line(mm(1.0, 1.0), mm(0.0, 1.0)).reversed(),
            line(mm(0.0, 0.0), mm(1.0, 0.0)),
            // A full circle on its own.
            Edge {
                start: mm(5.0, 0.0),
                end: mm(5.0, 0.0),
                arc: Some((mm(4.0, 0.0), ArcDirection::Clockwise)),
            },
            // Two sides of a square: open.
            line(mm(8.0, 0.0), mm(9.0, 0.0)),
            line(mm(9.0, 0.0), mm(9.0, 1.0)),
        ];
        let (chains, open) = chain(edges);
        assert_eq!(open, 1);
        assert_eq!(chains.iter().map(Vec::len).collect::<Vec<_>>(), [4, 1]);
        for c in &chains {
            for pair in c.windows(2) {
                assert!(pair[0].end.distance(pair[1].start) <= CHAIN_GAP);
            }
            assert_eq!(c.last().unwrap().end, c[0].start);
        }
    }

    fn lines(points: &[(f64, f64)]) -> String {
        points
            .iter()
            .zip(points.iter().cycle().skip(1))
            .map(|((x0, y0), (x1, y1))| {
                format!(
                    r#"<Line startX="{x0}" startY="{y0}" endX="{x1}" endY="{y1}"><LineDesc lineWidth="0.1" lineEnd="ROUND"/></Line>"#
                )
            })
            .collect()
    }

    fn doc(cutout: &str) -> ipc::Document {
        let rect =
            |x0: f64, y0: f64, x1: f64, y1: f64| lines(&[(x0, y0), (x1, y0), (x1, y1), (x0, y1)]);
        let edges = [
            // The profile itself, a square crossing its edge and one 10 µm inside it.
            rect(0.0, 0.0, 20.0, 10.0),
            rect(18.0, 4.0, 22.0, 6.0),
            rect(0.01, 4.0, 2.0, 6.0),
            // Cut-outs: a square, a full circle and a slot with an arc written backwards.
            rect(5.0, 4.0, 7.0, 6.0),
            r#"<Arc startX="13" startY="5" endX="13" endY="5" centerX="12" centerY="5" clockwise="false"><LineDesc lineWidth="0.1" lineEnd="ROUND"/></Arc>"#.into(),
            r#"<Line startX="8" startY="7" endX="10" endY="7"><LineDesc lineWidth="0.1" lineEnd="ROUND"/></Line>"#.into(),
            r#"<Arc startX="10" startY="7" endX="10" endY="8" centerX="10" centerY="7.5" clockwise="false"><LineDesc lineWidth="0.1" lineEnd="ROUND"/></Arc>"#.into(),
            r#"<Line startX="10" startY="8" endX="8" endY="8"><LineDesc lineWidth="0.1" lineEnd="ROUND"/></Line>"#.into(),
            r#"<Arc startX="8" startY="7" endX="8" endY="8" centerX="8" centerY="7.5" clockwise="true"><LineDesc lineWidth="0.1" lineEnd="ROUND"/></Arc>"#.into(),
        ]
        .concat();
        let xml = format!(
            r#"<?xml version="1.0"?>
<IPC-2581 revision="C"><Content><FunctionMode mode="ASSEMBLY"/><StepRef name="B"/></Content>
<Ecad name="e"><CadHeader units="MILLIMETER"/><CadData>
<Layer name="TOP" layerFunction="CONDUCTOR" side="TOP"/>
<Layer name="Edge.Cuts" layerFunction="BOARD_OUTLINE" side="ALL"/>
<Step name="B"><Profile><Polygon><PolyBegin x="0" y="0"/><PolyStepSegment x="20" y="0"/>
<PolyStepSegment x="20" y="10"/><PolyStepSegment x="0" y="10"/><PolyStepSegment x="0" y="0"/></Polygon>{cutout}</Profile>
<LayerFeature layerRef="Edge.Cuts"><Set><Features><UserSpecial>{edges}</UserSpecial></Features></Set>
<Set><Features><Location x="15" y="5"/><Circle diameter="1"/></Features></Set></LayerFeature>
</Step></CadData></Ecad></IPC-2581>"#
        );
        ipc::parse_bytes(xml.as_bytes()).unwrap()
    }

    fn outline(d: &ipc::Document, frame: DAffine2) -> (Region, Vec<Warning>) {
        let tolerance = Tolerance::DEFAULT;
        let mut shapes = ShapeConverter::new(&d.content, tolerance, MirrorOrder::MirrorThenRotate);
        let parts = [Part {
            step: d.ecad.steps.get("B").unwrap(),
            frame,
            flipped: false,
            instance: None,
        }];
        let mut warnings = Warnings::default();
        let cutouts = Cutouts::find(
            &d.ecad,
            &d.content,
            &parts,
            &mut shapes,
            tolerance,
            &mut warnings,
        );
        let shape = cutouts.profile(&parts[0], &mut shapes).unwrap();
        (shape.to_region(tolerance).unwrap(), warnings.into_vec())
    }

    #[test]
    fn cuts_closed_contours_inside_the_profile() {
        let d = doc("");
        let cut = 4.0 + std::f64::consts::PI * (1.0 + 0.25 + 0.25) + 2.0;
        // Arcs are tessellated inside the circle, which cuts about 0.04 mm² less.
        let expected = (200.0 - cut) * 1e-6;
        let (region, warnings) = outline(&d, DAffine2::IDENTITY);
        assert!(
            (region.area() - expected).abs() < 0.1e-6,
            "{}",
            region.area()
        );
        let messages: Vec<_> = warnings.iter().map(|w| w.message.as_str()).collect();
        assert_eq!(
            messages,
            [
                "the profile of step `B` has no cutouts; the closed contours inside it were cut out: 4 on layer `Edge.Cuts`"
            ]
        );
        // Placed mirrored and turned, as a flipped panel instance: the same area.
        let frame = DAffine2::from_angle(0.5) * DAffine2::from_scale(DVec2::new(-1.0, 1.0));
        let (region, _) = outline(&d, frame);
        assert!(
            (region.area() - expected).abs() < 0.1e-6,
            "{}",
            region.area()
        );
    }

    #[test]
    fn keeps_a_profile_with_cutouts() {
        let d = doc(
            r#"<Cutout><PolyBegin x="1" y="1"/><PolyStepSegment x="2" y="1"/><PolyStepSegment x="2" y="2"/><PolyStepSegment x="1" y="1"/></Cutout>"#,
        );
        let (region, warnings) = outline(&d, DAffine2::IDENTITY);
        assert!(
            (region.area() - 199.5e-6).abs() < 0.01e-6,
            "{}",
            region.area()
        );
        assert!(warnings.is_empty());
    }
}
