//! Paths of line and arc segments, and their tessellation (spec §6.1).

use crate::GeomError;
use crate::grid::{GRID_STEP, GridPoint, grid_point};
use glam::DVec2;
use std::f64::consts::{FRAC_PI_4, PI, TAU};

/// Maximum chord deviation used to tessellate arcs and circles (spec §6.1).
///
/// Arcs are split into chords that deviate from the true arc by at most this distance,
/// with at least 8 chords per full circle.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Tolerance(f64);

impl Tolerance {
    /// The profile default, 5 µm.
    pub const DEFAULT: Self = Self(5e-6);

    /// Creates a tolerance in metres. It must be finite and at least
    /// [`GRID_STEP`](crate::GRID_STEP).
    pub fn new(metres: f64) -> Result<Self, GeomError> {
        if metres.is_finite() && metres >= GRID_STEP {
            Ok(Self(metres))
        } else {
            Err(GeomError::InvalidTolerance { value: metres })
        }
    }

    /// The tolerance in metres.
    pub fn metres(self) -> f64 {
        self.0
    }

    /// Largest angle between consecutive vertices on a circle of `radius`.
    pub(crate) fn max_step(self, radius: f64) -> f64 {
        // The sagitta of a chord spanning angle `a` is `radius * (1 - cos(a / 2))`.
        let step = if radius > self.0 {
            2.0 * (1.0 - self.0 / radius).acos()
        } else {
            PI
        };
        step.min(FRAC_PI_4)
    }

    /// Number of chords for an arc of `radius` that sweeps `sweep` radians.
    pub(crate) fn segments(self, radius: f64, sweep: f64) -> usize {
        // The epsilon keeps exact multiples (a full circle in 8 steps) from rounding up.
        let count = (sweep.abs() / self.max_step(radius) - 1e-9).ceil();
        // `count` is at most a few hundred thousand for radii within MAX_COORDINATE.
        count.max(1.0) as usize
    }
}

impl Default for Tolerance {
    fn default() -> Self {
        Self::DEFAULT
    }
}

/// Direction of an arc in the top view (+x right, +y up).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArcDirection {
    /// Clockwise.
    Clockwise,
    /// Counter-clockwise.
    CounterClockwise,
}

/// One segment of a [`Path`]. It starts where the previous segment ends.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Segment {
    /// A straight line to `end`.
    Line {
        /// End point.
        end: DVec2,
    },
    /// A circular arc to `end` around `center`, as in IPC-2581 `Arc` and
    /// `PolyStepCurve`.
    ///
    /// An arc that ends where it starts (on the grid) is a full circle. When the start
    /// and end lie at slightly different distances from the centre, the radius changes
    /// linearly along the arc so that both end points are kept exactly.
    Arc {
        /// End point.
        end: DVec2,
        /// Centre of the circle.
        center: DVec2,
        /// Direction from start to end.
        direction: ArcDirection,
    },
}

/// A path of line and arc segments, in metres.
///
/// Used open as the centre line of a [`Stroke`](crate::Stroke), or closed as the
/// boundary of a [`Shape::Polygon`](crate::Shape::Polygon). A closed path is implicitly
/// closed: its last point connects back to `start`.
#[derive(Debug, Clone, PartialEq)]
pub struct Path {
    /// Start point.
    pub start: DVec2,
    /// Segments in order.
    pub segments: Vec<Segment>,
}

impl Path {
    /// Creates an empty path at `start`.
    pub fn new(start: DVec2) -> Self {
        Self {
            start,
            segments: Vec::new(),
        }
    }

    /// Appends a line to `end`.
    pub fn line_to(mut self, end: DVec2) -> Self {
        self.segments.push(Segment::Line { end });
        self
    }

    /// Appends an arc to `end` around `center`.
    pub fn arc_to(mut self, end: DVec2, center: DVec2, direction: ArcDirection) -> Self {
        self.segments.push(Segment::Arc {
            end,
            center,
            direction,
        });
        self
    }

    /// Tessellates the path onto the grid, dropping consecutive duplicate points.
    ///
    /// Arc chord counts are chosen for the arc radius plus `margin`, so that an outline
    /// offset by up to `margin` (a stroke edge) also meets the tolerance.
    pub(crate) fn tessellate(
        &self,
        tolerance: Tolerance,
        margin: f64,
    ) -> Result<Vec<GridPoint>, GeomError> {
        let mut points = Vec::with_capacity(self.segments.len() + 1);
        let mut push = |p: DVec2| -> Result<(), GeomError> {
            let p = grid_point(p)?;
            if points.last() != Some(&p) {
                points.push(p);
            }
            Ok(())
        };
        push(self.start)?;
        let mut current = self.start;
        for segment in &self.segments {
            match *segment {
                Segment::Line { end } => push(end)?,
                Segment::Arc {
                    end,
                    center,
                    direction,
                } => {
                    let full = grid_point(current)? == grid_point(end)?;
                    arc_points(
                        current, end, center, direction, full, tolerance, margin, &mut push,
                    )?;
                }
            }
            current = match *segment {
                Segment::Line { end } | Segment::Arc { end, .. } => end,
            };
        }
        Ok(points)
    }

    /// Tessellates the path as a closed contour: like [`Self::tessellate`], without
    /// repeating the start point at the end.
    pub(crate) fn tessellate_closed(
        &self,
        tolerance: Tolerance,
    ) -> Result<Vec<GridPoint>, GeomError> {
        let mut points = self.tessellate(tolerance, 0.0)?;
        if points.len() > 1 && points.first() == points.last() {
            points.pop();
        }
        Ok(points)
    }
}

/// Emits the points of an arc after `start`, ending with `end`.
#[allow(clippy::too_many_arguments)]
fn arc_points(
    start: DVec2,
    end: DVec2,
    center: DVec2,
    direction: ArcDirection,
    full: bool,
    tolerance: Tolerance,
    margin: f64,
    mut emit: impl FnMut(DVec2) -> Result<(), GeomError>,
) -> Result<(), GeomError> {
    if !center.is_finite() {
        return Err(GeomError::NonFinite);
    }
    let (from, to) = (start - center, end - center);
    let (r0, r1) = (from.length(), to.length());
    if r0 < GRID_STEP || r1 < GRID_STEP {
        // The centre coincides with an end point: there is no arc to draw.
        return emit(end);
    }
    let a0 = from.to_angle();
    let ccw = (to.to_angle() - a0).rem_euclid(TAU);
    let sweep = match (full, direction) {
        (true, ArcDirection::CounterClockwise) => TAU,
        (true, ArcDirection::Clockwise) => -TAU,
        (false, _) if ccw == 0.0 => 0.0,
        (false, ArcDirection::CounterClockwise) => ccw,
        (false, ArcDirection::Clockwise) => ccw - TAU,
    };
    let n = tolerance.segments(r0.max(r1) + margin, sweep);
    for k in 1..n {
        let t = k as f64 / n as f64;
        let radius = r0 + (r1 - r0) * t;
        emit(center + radius * DVec2::from_angle(a0 + sweep * t))?;
    }
    emit(end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::metres_point;

    fn tol(metres: f64) -> Tolerance {
        Tolerance::new(metres).unwrap()
    }

    /// Largest distance from a chord midpoint to the circle of `radius` around `center`.
    fn max_chord_deviation(points: &[GridPoint], center: DVec2, radius: f64) -> f64 {
        points
            .windows(2)
            .map(|w| {
                let mid = (metres_point(w[0]) + metres_point(w[1])) / 2.0;
                (radius - (mid - center).length()).abs()
            })
            .fold(0.0, f64::max)
    }

    #[test]
    fn tolerance_must_be_finite_and_at_least_one_grid_step() {
        assert!(Tolerance::new(5e-6).is_ok());
        assert!(Tolerance::new(GRID_STEP).is_ok());
        for bad in [0.0, -1e-6, GRID_STEP / 2.0, f64::NAN, f64::INFINITY] {
            assert!(matches!(
                Tolerance::new(bad),
                Err(GeomError::InvalidTolerance { .. })
            ));
        }
        assert_eq!(Tolerance::default().metres(), 5e-6);
    }

    #[test]
    fn full_circles_have_at_least_eight_segments() {
        // A tolerance larger than the radius would allow fewer.
        assert_eq!(tol(1e-3).segments(1e-4, TAU), 8);
        assert_eq!(tol(5e-6).segments(1e-5, TAU), 8);
        // A partial arc keeps the 45° limit.
        assert_eq!(tol(1e-3).segments(1e-4, PI / 2.0), 2);
    }

    #[test]
    fn segment_count_meets_the_tolerance() {
        let t = tol(5e-6);
        for radius in [1e-4, 1e-3, 1e-2, 0.1] {
            let n = t.segments(radius, TAU);
            let step = TAU / n as f64;
            assert!(radius * (1.0 - (step / 2.0).cos()) <= 5e-6 * (1.0 + 1e-9));
            // And it is not wastefully fine: one chord fewer would break it.
            let coarser = TAU / (n - 1) as f64;
            assert!(n == 8 || radius * (1.0 - (coarser / 2.0).cos()) > 5e-6);
        }
    }

    #[test]
    fn lines_are_kept_and_duplicates_dropped() {
        let path = Path::new(DVec2::ZERO)
            .line_to(DVec2::new(1e-3, 0.0))
            .line_to(DVec2::new(1e-3, 0.0))
            .line_to(DVec2::new(1e-3, 2e-3));
        let points = path.tessellate(Tolerance::DEFAULT, 0.0).unwrap();
        assert_eq!(
            points,
            [
                GridPoint::new(0, 0),
                GridPoint::new(100_000, 0),
                GridPoint::new(100_000, 200_000)
            ]
        );
    }

    #[test]
    fn arcs_keep_their_end_points_and_tolerance() {
        let center = DVec2::new(1e-3, 1e-3);
        let start = DVec2::new(3e-3, 1e-3);
        let end = DVec2::new(1e-3, 3e-3);
        let path = Path::new(start).arc_to(end, center, ArcDirection::CounterClockwise);
        let points = path.tessellate(Tolerance::DEFAULT, 0.0).unwrap();
        assert_eq!(points.first(), Some(&grid_point(start).unwrap()));
        assert_eq!(points.last(), Some(&grid_point(end).unwrap()));
        // A quarter turn counter-clockwise stays in the upper right quadrant.
        assert!(points.iter().all(|p| p.x >= 100_000 && p.y >= 100_000));
        // Grid rounding adds at most half a step per coordinate.
        assert!(max_chord_deviation(&points, center, 2e-3) <= 5e-6 + GRID_STEP);
    }

    #[test]
    fn clockwise_arcs_take_the_other_way_round() {
        let center = DVec2::ZERO;
        let start = DVec2::new(1e-3, 0.0);
        let end = DVec2::new(0.0, 1e-3);
        let path = Path::new(start).arc_to(end, center, ArcDirection::Clockwise);
        let points = path.tessellate(Tolerance::DEFAULT, 0.0).unwrap();
        // Three quarters of a turn through the lower half plane.
        assert!(points.iter().any(|p| p.y < -90_000));
        assert!(points.iter().any(|p| p.x < -90_000));
    }

    #[test]
    fn an_arc_ending_at_its_start_is_a_full_circle() {
        let start = DVec2::new(1e-3, 0.0);
        let path = Path::new(start).arc_to(start, DVec2::ZERO, ArcDirection::Clockwise);
        let points = path.tessellate_closed(Tolerance::DEFAULT).unwrap();
        let n = Tolerance::DEFAULT.segments(1e-3, TAU);
        assert_eq!(points.len(), n);
        let area = crate::region::signed_area2(&points);
        assert!(area < 0, "clockwise circle has negative area");
    }

    #[test]
    fn arc_radius_varies_linearly_between_unequal_ends() {
        let path = Path::new(DVec2::new(1e-3, 0.0)).arc_to(
            DVec2::new(-1.2e-3, 0.0),
            DVec2::ZERO,
            ArcDirection::CounterClockwise,
        );
        let points = path.tessellate(Tolerance::DEFAULT, 0.0).unwrap();
        let radii: Vec<f64> = points.iter().map(|&p| metres_point(p).length()).collect();
        assert!(radii.windows(2).all(|w| w[1] >= w[0] - GRID_STEP));
        assert!((radii[radii.len() / 2] - 1.1e-3).abs() < 2e-5);
    }

    #[test]
    fn margin_refines_arcs_for_wide_strokes() {
        let path = Path::new(DVec2::new(1e-4, 0.0)).arc_to(
            DVec2::new(0.0, 1e-4),
            DVec2::ZERO,
            ArcDirection::CounterClockwise,
        );
        let thin = path.tessellate(Tolerance::DEFAULT, 0.0).unwrap();
        let wide = path.tessellate(Tolerance::DEFAULT, 1e-3).unwrap();
        assert!(wide.len() > thin.len());
    }

    #[test]
    fn degenerate_arcs_become_lines() {
        let path = Path::new(DVec2::ZERO).arc_to(
            DVec2::new(1e-3, 0.0),
            DVec2::ZERO,
            ArcDirection::Clockwise,
        );
        assert_eq!(path.tessellate(Tolerance::DEFAULT, 0.0).unwrap().len(), 2);
    }

    #[test]
    fn invalid_coordinates_are_errors() {
        let path = Path::new(DVec2::new(f64::NAN, 0.0));
        assert_eq!(
            path.tessellate(Tolerance::DEFAULT, 0.0),
            Err(GeomError::NonFinite)
        );
        let path = Path::new(DVec2::ZERO).arc_to(
            DVec2::new(1e-3, 0.0),
            DVec2::new(f64::INFINITY, 0.0),
            ArcDirection::Clockwise,
        );
        assert_eq!(
            path.tessellate(Tolerance::DEFAULT, 0.0),
            Err(GeomError::NonFinite)
        );
        let path = Path::new(DVec2::ZERO).line_to(DVec2::new(5.0, 0.0));
        assert!(matches!(
            path.tessellate(Tolerance::DEFAULT, 0.0),
            Err(GeomError::OutOfRange { .. })
        ));
    }
}
