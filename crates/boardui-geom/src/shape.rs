//! Input shapes and their conversion to regions.

use crate::grid::{GridPoint, grid_point, metres_point, units};
use crate::region::arc_options;
use crate::{GeomError, Path, Region, Tolerance};
use glam::DVec2;
use i_overlay::i_float::int::angle::Angle;
use i_overlay::mesh::int::stroke::offset::IntStrokeOffset;
use i_overlay::mesh::int::style::{IntLineCap, IntLineJoin, IntStrokeStyle};
use std::f64::consts::TAU;

/// Corners sharper than this (1/12 turn, 30°) get their miter clipped, like an SVG miter
/// limit of about 4.
const MITER_MIN_ANGLE: Angle = Angle::from_bits(0x1555_5555);

/// How the ends of a [`Stroke`] are drawn, matching IPC-2581 `LineDesc@lineEnd`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineCap {
    /// A half circle around each end (`ROUND`). Corners are rounded too.
    Round,
    /// A square extending half the width beyond each end (`SQUARE`). Corners are
    /// mitered.
    Square,
    /// Cut off at the end points (`NONE`). Corners are mitered.
    Flat,
}

/// An open path drawn with a pen of constant width.
///
/// A path whose last point equals its start is stroked as a closed loop, without caps.
#[derive(Debug, Clone, PartialEq)]
pub struct Stroke {
    /// Centre line.
    pub path: Path,
    /// Line width, in metres.
    pub width: f64,
    /// End style.
    pub cap: LineCap,
}

/// A 2D shape in metres.
#[derive(Debug, Clone, PartialEq)]
pub enum Shape {
    /// A closed outline with holes. Paths are implicitly closed and may run in either
    /// direction; a self-intersecting outline is filled with the non-zero rule.
    Polygon {
        /// Outer boundary.
        outline: Path,
        /// Holes removed from the outline (IPC-2581 `Cutout`s).
        holes: Vec<Path>,
    },
    /// A filled circle.
    Circle {
        /// Centre.
        center: DVec2,
        /// Radius, in metres.
        radius: f64,
    },
    /// A stroked path.
    Stroke(Stroke),
}

impl Shape {
    /// Converts the shape to a region, tessellating arcs and circles with `tolerance`.
    pub fn to_region(&self, tolerance: Tolerance) -> Result<Region, GeomError> {
        match self {
            Self::Polygon { outline, holes } => {
                let outline = outline.tessellate_closed(tolerance)?;
                let holes = holes
                    .iter()
                    .map(|hole| hole.tessellate_closed(tolerance))
                    .collect::<Result<_, _>>()?;
                Ok(Region::from_contours(outline, holes))
            }
            Self::Circle { center, radius } => circle(*center, *radius, tolerance),
            Self::Stroke(stroke) => stroke.to_region(tolerance),
        }
    }
}

impl Stroke {
    fn to_region(&self, tolerance: Tolerance) -> Result<Region, GeomError> {
        let half_width = non_negative(self.width, "stroke width")? / 2.0;
        let radius = units(half_width)?;
        // Square and flat ends are cut square to the first and last chord, which is
        // tilted from the arc's tangent by half a chord angle. Refining arcs as if their
        // radius grew by 2 hw² / tolerance keeps the tilt within the tolerance at the
        // stroke's corners.
        let margin = match self.cap {
            LineCap::Round => half_width,
            LineCap::Square | LineCap::Flat => {
                half_width.max(2.0 * half_width * half_width / tolerance.metres())
            }
        };
        let mut points = self.path.tessellate(tolerance, margin)?;
        if radius == 0 {
            return Ok(Region::empty());
        }
        if let [center] = points[..] {
            // A zero-length stroke is just its caps.
            return match self.cap {
                LineCap::Round => circle(metres_point(center), half_width, tolerance),
                LineCap::Square => Ok(square(center, radius)),
                LineCap::Flat => Ok(Region::empty()),
            };
        }
        let closed = points.len() > 2 && points.first() == points.last();
        if closed {
            points.pop();
        }
        let round = arc_options(tolerance.max_step(half_width));
        let (cap, join) = match self.cap {
            LineCap::Round => (IntLineCap::Round(round), IntLineJoin::Round(round)),
            LineCap::Square => (IntLineCap::Square, IntLineJoin::Miter(MITER_MIN_ANGLE)),
            LineCap::Flat => (IntLineCap::Butt, IntLineJoin::Miter(MITER_MIN_ANGLE)),
        };
        let style = IntStrokeStyle::new(2 * radius)
            .start_cap(cap.clone())
            .end_cap(cap)
            .line_join(join);
        let out_of_range = |_| GeomError::OutOfRange { value: self.width };
        points
            .as_slice()
            .validate_stroke(&style)
            .map_err(out_of_range)?;
        let shapes = points
            .as_slice()
            .stroke(&style, closed)
            .map_err(out_of_range)?;
        Ok(Region::from_shapes(shapes))
    }
}

/// A tessellated circle.
fn circle(center: DVec2, radius: f64, tolerance: Tolerance) -> Result<Region, GeomError> {
    let radius = non_negative(radius, "circle radius")?;
    grid_point(center)?;
    units(radius)?;
    let n = tolerance.segments(radius, TAU);
    let contour = (0..n)
        .map(|k| grid_point(center + radius * DVec2::from_angle(TAU * k as f64 / n as f64)))
        .collect::<Result<_, _>>()?;
    Ok(Region::from_contours(contour, Vec::new()))
}

/// An axis-aligned square of half side `half` around `center`.
fn square(center: GridPoint, half: i32) -> Region {
    let (x0, y0, x1, y1) = (
        center.x - half,
        center.y - half,
        center.x + half,
        center.y + half,
    );
    let contour = vec![
        GridPoint::new(x0, y0),
        GridPoint::new(x1, y0),
        GridPoint::new(x1, y1),
        GridPoint::new(x0, y1),
    ];
    Region::from_contours(contour, Vec::new())
}

/// Checks that a length is finite and not negative.
pub(crate) fn non_negative(value: f64, what: &'static str) -> Result<f64, GeomError> {
    if !value.is_finite() {
        Err(GeomError::NonFinite)
    } else if value < 0.0 {
        Err(GeomError::NegativeLength { what, value })
    } else {
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ArcDirection;
    use crate::test_util::assert_close;
    use std::f64::consts::PI;

    const T: Tolerance = Tolerance::DEFAULT;

    fn line(x0: f64, y0: f64, x1: f64, y1: f64, width: f64, cap: LineCap) -> Shape {
        Shape::Stroke(Stroke {
            path: Path::new(DVec2::new(x0, y0)).line_to(DVec2::new(x1, y1)),
            width,
            cap,
        })
    }

    /// Area lost by inscribing a circle of `radius` with tolerance `T`: at most the
    /// circumference times the tolerance.
    fn circle_slack(radius: f64) -> f64 {
        TAU * radius * T.metres()
    }

    #[test]
    fn round_cap_adds_half_circles() {
        let r = line(0.0, 0.0, 2e-3, 0.0, 2e-4, LineCap::Round)
            .to_region(T)
            .unwrap();
        let expected = 2e-3 * 2e-4 + PI * 1e-4 * 1e-4;
        assert!(r.area() <= expected);
        assert_close(r.area(), expected, circle_slack(1e-4));
        let b = r.bounds().unwrap();
        // Cap vertices need not hit the extreme point exactly.
        assert_close(b.min.x, -1e-4, T.metres());
        assert_close(b.max.x, 2.1e-3, T.metres());
    }

    #[test]
    fn square_cap_extends_by_half_the_width() {
        let r = line(0.0, 0.0, 2e-3, 0.0, 2e-4, LineCap::Square)
            .to_region(T)
            .unwrap();
        assert_close(r.area(), 2.2e-3 * 2e-4, 1e-15);
        let b = r.bounds().unwrap();
        assert_close(b.min.x, -1e-4, 1e-12);
        assert_close(b.max.y, 1e-4, 1e-12);
    }

    #[test]
    fn flat_cap_ends_at_the_end_points() {
        let r = line(0.0, 0.0, 0.0, 2e-3, 2e-4, LineCap::Flat)
            .to_region(T)
            .unwrap();
        assert_close(r.area(), 2e-3 * 2e-4, 1e-15);
        let b = r.bounds().unwrap();
        assert_close(b.min.y, 0.0, 1e-12);
        assert_close(b.max.x, 1e-4, 1e-12);
    }

    #[test]
    fn square_and_flat_corners_are_mitered() {
        let path = Path::new(DVec2::ZERO)
            .line_to(DVec2::new(2e-3, 0.0))
            .line_to(DVec2::new(2e-3, 2e-3));
        let stroke = |cap| {
            Shape::Stroke(Stroke {
                path: path.clone(),
                width: 2e-4,
                cap,
            })
            .to_region(T)
            .unwrap()
        };
        // Two 2 mm legs, each with a 0.1 mm × 0.1 mm mitered corner square.
        assert_close(stroke(LineCap::Flat).area(), 4e-3 * 2e-4, 1e-15);
        let b = stroke(LineCap::Flat).bounds().unwrap();
        assert_close(b.max.x, 2.1e-3, 1e-12);
        assert_close(b.min.y, -1e-4, 1e-12);
        assert_close(stroke(LineCap::Square).area(), 4.2e-3 * 2e-4, 1e-15);
    }

    #[test]
    fn round_corners_are_rounded() {
        let path = Path::new(DVec2::ZERO)
            .line_to(DVec2::new(2e-3, 0.0))
            .line_to(DVec2::new(2e-3, 2e-3));
        let r = Shape::Stroke(Stroke {
            path,
            width: 2e-4,
            cap: LineCap::Round,
        })
        .to_region(T)
        .unwrap();
        // Two legs overlapping in a 0.1 mm square, two half-circle caps and a quarter
        // circle at the corner.
        let expected = 4e-3 * 2e-4 - 1e-8 + 1.25 * PI * 1e-8;
        assert_close(r.area(), expected, circle_slack(1e-4));
    }

    #[test]
    fn arc_strokes_follow_the_arc() {
        // A half ring between radii 0.9 mm and 1.1 mm.
        let path = Path::new(DVec2::new(1e-3, 0.0)).arc_to(
            DVec2::new(-1e-3, 0.0),
            DVec2::ZERO,
            ArcDirection::CounterClockwise,
        );
        let r = Shape::Stroke(Stroke {
            path,
            width: 2e-4,
            cap: LineCap::Flat,
        })
        .to_region(T)
        .unwrap();
        let expected = PI / 2.0 * (1.1e-3 * 1.1e-3 - 0.9e-3 * 0.9e-3);
        assert_close(
            r.area(),
            expected,
            circle_slack(1.1e-3) + circle_slack(0.9e-3),
        );
        // The flat ends stay square to the arc.
        assert!(r.bounds().unwrap().min.y >= -T.metres());
    }

    #[test]
    fn closed_strokes_have_no_caps() {
        let s = 2e-3;
        let path = Path::new(DVec2::ZERO)
            .line_to(DVec2::new(s, 0.0))
            .line_to(DVec2::new(s, s))
            .line_to(DVec2::new(0.0, s))
            .line_to(DVec2::ZERO);
        let r = Shape::Stroke(Stroke {
            path,
            width: 2e-4,
            cap: LineCap::Square,
        })
        .to_region(T)
        .unwrap();
        // A square frame from -0.1 mm to 2.1 mm with a 1.8 mm hole.
        assert_close(r.area(), 2.2e-3 * 2.2e-3 - 1.8e-3 * 1.8e-3, 1e-15);
    }

    #[test]
    fn zero_length_strokes_are_their_caps() {
        let dot = |cap| {
            line(1e-3, 1e-3, 1e-3, 1e-3, 2e-4, cap)
                .to_region(T)
                .unwrap()
        };
        assert_close(dot(LineCap::Round).area(), PI * 1e-8, circle_slack(1e-4));
        assert_close(dot(LineCap::Square).area(), 4e-8, 1e-15);
        assert!(dot(LineCap::Flat).is_empty());
    }

    #[test]
    fn zero_width_strokes_are_empty() {
        let r = line(0.0, 0.0, 1e-3, 0.0, 0.0, LineCap::Round)
            .to_region(T)
            .unwrap();
        assert!(r.is_empty());
    }

    #[test]
    fn invalid_strokes_are_errors() {
        assert_eq!(
            line(0.0, 0.0, 1e-3, 0.0, -1e-4, LineCap::Round).to_region(T),
            Err(GeomError::NegativeLength {
                what: "stroke width",
                value: -1e-4
            })
        );
        assert_eq!(
            line(0.0, 0.0, 1e-3, 0.0, f64::NAN, LineCap::Round).to_region(T),
            Err(GeomError::NonFinite)
        );
        assert_eq!(
            line(0.0, 0.0, 3.0, 0.0, 0.5, LineCap::Round).to_region(T),
            Err(GeomError::OutOfRange { value: 3.0 })
        );
        assert_eq!(
            line(0.0, 0.0, 1e-3, 0.0, 6.0, LineCap::Round).to_region(T),
            Err(GeomError::OutOfRange { value: 3.0 })
        );
    }

    #[test]
    fn circles_meet_the_tolerance() {
        let radius = 5e-4;
        let r = Shape::Circle {
            center: DVec2::new(1e-3, -1e-3),
            radius,
        }
        .to_region(T)
        .unwrap();
        assert!(r.area() <= PI * radius * radius);
        assert_close(r.area(), PI * radius * radius, circle_slack(radius));
        let b = r.bounds().unwrap();
        assert_close(b.max.x, 1.5e-3, 1e-9);
        assert!(
            Shape::Circle {
                center: DVec2::ZERO,
                radius: 0.0
            }
            .to_region(T)
            .unwrap()
            .is_empty()
        );
        assert!(
            Shape::Circle {
                center: DVec2::ZERO,
                radius: -1.0
            }
            .to_region(T)
            .is_err()
        );
    }

    #[test]
    fn polygons_with_arcs_and_holes() {
        // A 4 mm disc drawn as two half arcs, with a 2 mm square hole.
        let outline = Path::new(DVec2::new(2e-3, 0.0))
            .arc_to(DVec2::new(-2e-3, 0.0), DVec2::ZERO, ArcDirection::Clockwise)
            .arc_to(DVec2::new(2e-3, 0.0), DVec2::ZERO, ArcDirection::Clockwise);
        let hole = Path::new(DVec2::new(-1e-3, -1e-3))
            .line_to(DVec2::new(1e-3, -1e-3))
            .line_to(DVec2::new(1e-3, 1e-3))
            .line_to(DVec2::new(-1e-3, 1e-3));
        let r = Shape::Polygon {
            outline,
            holes: vec![hole],
        }
        .to_region(T)
        .unwrap();
        assert_close(r.area(), PI * 4e-6 - 4e-6, circle_slack(2e-3));
    }

    #[test]
    fn a_full_circle_arc_outline_is_a_disc() {
        let start = DVec2::new(1e-3, 0.0);
        let r = Shape::Polygon {
            outline: Path::new(start).arc_to(start, DVec2::ZERO, ArcDirection::CounterClockwise),
            holes: Vec::new(),
        }
        .to_region(T)
        .unwrap();
        assert_close(r.area(), PI * 1e-6, circle_slack(1e-3));
    }
}
