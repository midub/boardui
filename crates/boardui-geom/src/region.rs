//! 2D regions and boolean operations on them.

use crate::grid::{GridPoint, grid_point, metres, metres_point, units};
use crate::{GeomError, Tolerance};
use glam::DVec2;
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay::{Overlay, ShapeType};
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::i_float::int::angle::Angle;
use i_overlay::i_shape::int::shape::{IntContour, IntShapes};
use i_overlay::mesh::int::arc::ArcOptions;
use i_overlay::mesh::int::outline::offset::IntOutlineOffset;
use i_overlay::mesh::int::style::{IntLineJoin, IntOutlineStyle};

/// An axis-aligned bounding box, in metres.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    /// Lower left corner.
    pub min: DVec2,
    /// Upper right corner.
    pub max: DVec2,
}

/// An axis-aligned bounding box on the grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct GridRect {
    pub(crate) min: GridPoint,
    pub(crate) max: GridPoint,
}

/// A 2D region: zero or more polygons with holes, on the grid of
/// [`GRID_STEP`](crate::GRID_STEP).
///
/// Regions are always valid: polygons don't overlap or self-intersect, outer boundaries
/// run counter-clockwise and holes clockwise (in the top view, +y up).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Region {
    shapes: IntShapes<i32>,
}

impl Region {
    /// The empty region.
    pub fn empty() -> Self {
        Self::default()
    }

    /// Whether the region has no area.
    pub fn is_empty(&self) -> bool {
        self.shapes.is_empty()
    }

    /// Area in square metres.
    pub fn area(&self) -> f64 {
        let twice: i128 = self.contours().map(|contour| signed_area2(contour)).sum();
        // The exact integer area converts once, losing at most f64 rounding.
        twice as f64 / 2.0 * metres(1) * metres(1)
    }

    /// Bounding box, or `None` for an empty region.
    pub fn bounds(&self) -> Option<Bounds> {
        self.grid_bounds().map(|r| Bounds {
            min: metres_point(r.min),
            max: metres_point(r.max),
        })
    }

    /// The area covered by `self` or `other`.
    pub fn union(&self, other: &Self) -> Self {
        Self::union_all([self, other])
    }

    /// The area covered by `self` but not by `other`.
    pub fn difference(&self, other: &Self) -> Self {
        self.subtract([other])
    }

    /// The area covered by both `self` and `other`.
    pub fn intersection(&self, other: &Self) -> Self {
        if self.is_empty() || other.is_empty() {
            return Self::empty();
        }
        overlay([self], [other], OverlayRule::Intersect)
    }

    /// The area covered by any of `regions`.
    pub fn union_all<'a>(regions: impl IntoIterator<Item = &'a Region>) -> Self {
        overlay(regions, [], OverlayRule::Subject)
    }

    /// Builds a region from closed contours in metres, filled with the non-zero rule: a point
    /// is inside when the contours wind around it a non-zero number of times.
    ///
    /// Unlike [`Shape::Polygon`](crate::Shape::Polygon), orientations are kept, so
    /// counter-clockwise outlines with clockwise holes describe polygons with holes, and
    /// overlapping outlines add up to their union. Contours with fewer than three points
    /// are ignored.
    ///
    /// # Errors
    ///
    /// Returns an error for coordinates that are not finite or out of range.
    pub fn from_contours_nonzero<'a>(
        contours: impl IntoIterator<Item = &'a [DVec2]>,
    ) -> Result<Self, GeomError> {
        let contours = contours
            .into_iter()
            .map(|c| c.iter().map(|&p| grid_point(p)).collect::<Result<Vec<_>, _>>())
            .collect::<Result<Vec<_>, _>>()?;
        let mut overlay = Overlay::new(contours.iter().map(Vec::len).sum());
        for contour in contours.iter().filter(|c| c.len() >= 3) {
            overlay.add_contour(contour, ShapeType::Subject);
        }
        Ok(Self {
            shapes: overlay.overlay(OverlayRule::Subject, FillRule::NonZero),
        })
    }

    /// The region's polygons in metres: each is an outer contour (counter-clockwise)
    /// followed by its holes (clockwise).
    pub fn polygons(&self) -> Vec<Vec<Vec<DVec2>>> {
        self.shapes
            .iter()
            .map(|shape| {
                shape
                    .iter()
                    .map(|contour| contour.iter().map(|&p| metres_point(p)).collect())
                    .collect()
            })
            .collect()
    }

    /// Total length of all contours, in metres.
    pub fn perimeter(&self) -> f64 {
        self.contours()
            .map(|contour| {
                let n = contour.len();
                (0..n)
                    .map(|i| {
                        let (a, b) = (contour[i], contour[(i + 1) % n]);
                        let dx = f64::from(b.x) - f64::from(a.x);
                        let dy = f64::from(b.y) - f64::from(a.y);
                        dx.hypot(dy)
                    })
                    .sum::<f64>()
            })
            .sum::<f64>()
            * metres(1)
    }

    /// Grows the region by `distance` metres, or shrinks it for a negative `distance`.
    ///
    /// Corners are rounded, tessellated with `tolerance`.
    pub fn offset(&self, distance: f64, tolerance: Tolerance) -> Result<Self, GeomError> {
        let offset = units(distance)?;
        if offset == 0 || self.is_empty() {
            return Ok(self.clone());
        }
        let step = tolerance.max_step(distance.abs());
        let style = IntOutlineStyle::new(offset).line_join(IntLineJoin::Round(arc_options(step)));
        self.shapes
            .validate_outline(&style)
            .map_err(|_| GeomError::OutOfRange { value: distance })?;
        let shapes = self
            .shapes
            .outline(&style)
            .map_err(|_| GeomError::OutOfRange { value: distance })?;
        Ok(Self { shapes })
    }

    /// The area covered by `self` but by none of `others`.
    pub(crate) fn subtract<'a>(&self, others: impl IntoIterator<Item = &'a Region>) -> Self {
        if self.is_empty() {
            return Self::empty();
        }
        let others: Vec<&Region> = others.into_iter().filter(|r| !r.is_empty()).collect();
        if others.is_empty() {
            return self.clone();
        }
        overlay([self], others, OverlayRule::Difference)
    }

    /// Builds a region from an outline and holes in any orientation. The outline is
    /// filled with the non-zero rule; holes are removed from it.
    pub(crate) fn from_contours(outline: IntContour<i32>, holes: Vec<IntContour<i32>>) -> Self {
        let mut overlay = Overlay::new(outline.len() + holes.iter().map(Vec::len).sum::<usize>());
        let mut add = |mut contour: IntContour<i32>, shape_type| {
            if contour.len() < 3 {
                return;
            }
            // Clip contours must agree in orientation so that overlapping holes add up.
            if signed_area2(&contour) < 0 {
                contour.reverse();
            }
            overlay.add_contour(&contour, shape_type);
        };
        add(outline, ShapeType::Subject);
        for hole in holes {
            add(hole, ShapeType::Clip);
        }
        Self {
            shapes: overlay.overlay(OverlayRule::Difference, FillRule::NonZero),
        }
    }

    /// Wraps the output of an i_overlay operation, which is already valid.
    pub(crate) fn from_shapes(shapes: IntShapes<i32>) -> Self {
        Self { shapes }
    }

    pub(crate) fn shapes(&self) -> &IntShapes<i32> {
        &self.shapes
    }

    pub(crate) fn contours(&self) -> impl Iterator<Item = &IntContour<i32>> {
        self.shapes.iter().flatten()
    }

    /// Bounding box on the grid, or `None` for an empty region.
    pub(crate) fn grid_bounds(&self) -> Option<GridRect> {
        // Holes lie inside their outer contour, so outer contours suffice.
        let mut points = self.shapes.iter().filter_map(|s| s.first()).flatten();
        let first = *points.next()?;
        Some(points.fold(
            GridRect {
                min: first,
                max: first,
            },
            |r, p| GridRect {
                min: GridPoint::new(r.min.x.min(p.x), r.min.y.min(p.y)),
                max: GridPoint::new(r.max.x.max(p.x), r.max.y.max(p.y)),
            },
        ))
    }
}

/// Arc options for round joins and caps with at most `step` radians between vertices.
pub(crate) fn arc_options(step: f64) -> ArcOptions {
    ArcOptions {
        // `step` is finite (at most π/4), so the conversion succeeds.
        max_step: Angle::from_radians(step).unwrap_or(ArcOptions::MAX_STEP),
        ..ArcOptions::default()
    }
}

/// Twice the signed area of a contour in square grid units; positive when
/// counter-clockwise.
pub(crate) fn signed_area2(contour: &[GridPoint]) -> i128 {
    let Some(&origin) = contour.first() else {
        return 0;
    };
    let mut sum = 0;
    let mut prev = (0, 0);
    for p in &contour[1..] {
        let cur = (
            i128::from(p.x) - i128::from(origin.x),
            i128::from(p.y) - i128::from(origin.y),
        );
        sum += prev.0 * cur.1 - cur.0 * prev.1;
        prev = cur;
    }
    sum
}

/// Runs one i_overlay boolean on whole regions with the non-zero fill rule, which treats
/// every valid region as winding +1 inside and 0 outside.
fn overlay<'a, 'b>(
    subject: impl IntoIterator<Item = &'a Region>,
    clip: impl IntoIterator<Item = &'b Region>,
    rule: OverlayRule,
) -> Region {
    let mut overlay = Overlay::new(0);
    for region in subject {
        overlay.add_source(&region.shapes, ShapeType::Subject);
    }
    for region in clip {
        overlay.add_source(&region.shapes, ShapeType::Clip);
    }
    Region {
        shapes: overlay.overlay(rule, FillRule::NonZero),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{assert_close, rect};

    #[test]
    fn empty_region_has_no_area_or_bounds() {
        let empty = Region::empty();
        assert!(empty.is_empty());
        assert_eq!(empty.area(), 0.0);
        assert_eq!(empty.bounds(), None);
    }

    #[test]
    fn area_and_bounds_of_a_rectangle() {
        let r = rect(1e-3, 2e-3, 4e-3, 3e-3);
        assert_close(r.area(), 3e-3 * 1e-3, 1e-15);
        let b = r.bounds().unwrap();
        assert_close(b.min.x, 1e-3, 1e-12);
        assert_close(b.max.y, 3e-3, 1e-12);
    }

    #[test]
    fn booleans_of_overlapping_rectangles() {
        let a = rect(0.0, 0.0, 2e-3, 2e-3);
        let b = rect(1e-3, 1e-3, 3e-3, 3e-3);
        assert_close(a.union(&b).area(), 7e-6, 1e-15);
        assert_close(a.difference(&b).area(), 3e-6, 1e-15);
        assert_close(a.intersection(&b).area(), 1e-6, 1e-15);
        assert!(a.intersection(&Region::empty()).is_empty());
        assert_eq!(a.difference(&Region::empty()), a);
    }

    #[test]
    fn union_all_merges_many_regions() {
        let regions: Vec<Region> = (0..10)
            .map(|i| {
                let x = f64::from(i) * 1e-3;
                rect(x, 0.0, x + 1.5e-3, 1e-3)
            })
            .collect();
        let union = Region::union_all(&regions);
        assert_eq!(union.shapes().len(), 1);
        assert_close(union.area(), 10.5e-6, 1e-15);
    }

    #[test]
    fn difference_can_create_holes() {
        let ring = rect(0.0, 0.0, 3e-3, 3e-3).difference(&rect(1e-3, 1e-3, 2e-3, 2e-3));
        assert_eq!(ring.shapes().len(), 1);
        assert_eq!(ring.shapes()[0].len(), 2);
        assert!(
            signed_area2(&ring.shapes()[0][0]) > 0,
            "outer is counter-clockwise"
        );
        assert!(signed_area2(&ring.shapes()[0][1]) < 0, "hole is clockwise");
        assert_close(ring.area(), 8e-6, 1e-15);
    }

    #[test]
    fn from_contours_accepts_any_orientation_and_overlapping_holes() {
        let square = |x0: i32, y0: i32, x1: i32, y1: i32| {
            vec![
                GridPoint::new(x0, y0),
                GridPoint::new(x0, y1),
                GridPoint::new(x1, y1),
                GridPoint::new(x1, y0),
            ]
        };
        // Clockwise outline, holes of both orientations overlapping each other.
        let mut hole_b = square(3, 3, 7, 7);
        hole_b.reverse();
        let r = Region::from_contours(square(0, 0, 10, 10), vec![square(2, 2, 6, 6), hole_b]);
        assert_eq!(
            r.contours().map(|c| signed_area2(c)).sum::<i128>(),
            2 * (100 - 23)
        );
    }

    #[test]
    fn offset_grows_and_shrinks_with_round_corners() {
        let square = rect(0.0, 0.0, 2e-3, 2e-3);
        let grown = square.offset(1e-4, Tolerance::DEFAULT).unwrap();
        let expected = 4e-6 + 4.0 * 2e-3 * 1e-4 + std::f64::consts::PI * 1e-8;
        // Rounded corners are inscribed polygons, slightly smaller than true arcs.
        assert!(grown.area() <= expected);
        assert_close(grown.area(), expected, 4e-9);
        let shrunk = square.offset(-1e-4, Tolerance::DEFAULT).unwrap();
        assert_close(shrunk.area(), 1.8e-3 * 1.8e-3, 1e-12);
        assert_eq!(square.offset(0.0, Tolerance::DEFAULT).unwrap(), square);
        assert!(square.offset(-2e-3, Tolerance::DEFAULT).unwrap().is_empty());
    }

    #[test]
    fn offset_rejects_invalid_distances() {
        let square = rect(0.0, 0.0, 2e-3, 2e-3);
        assert_eq!(
            square.offset(f64::NAN, Tolerance::DEFAULT),
            Err(GeomError::NonFinite)
        );
        assert_eq!(
            square.offset(3.0, Tolerance::DEFAULT),
            Err(GeomError::OutOfRange { value: 3.0 })
        );
    }

    #[test]
    fn non_zero_contours_keep_orientation() {
        let square = |x0: f64, y0: f64, x1: f64, y1: f64| {
            vec![
                DVec2::new(x0, y0),
                DVec2::new(x1, y0),
                DVec2::new(x1, y1),
                DVec2::new(x0, y1),
            ]
        };
        let outer = square(0.0, 0.0, 3e-3, 3e-3);
        let mut hole = square(1e-3, 1e-3, 2e-3, 2e-3);
        hole.reverse();
        let other = square(2e-3, 0.0, 4e-3, 1e-3);
        let r = Region::from_contours_nonzero([&outer[..], &hole[..], &other[..]]).unwrap();
        assert_close(r.area(), 9e-6 - 1e-6 + 1e-6, 1e-15);
        assert_eq!(r.polygons().len(), 1);
        assert_eq!(r.polygons()[0].len(), 2, "the hole stays");
        assert_close(r.perimeter(), 4.0 * 1e-3 + 2.0 * (4e-3 + 3e-3), 1e-12);
        let nan = [DVec2::new(f64::NAN, 0.0); 3];
        assert!(Region::from_contours_nonzero([&nan[..]]).is_err());
    }

    #[test]
    fn signed_area_of_counter_clockwise_contour_is_positive() {
        let ccw = [
            GridPoint::new(0, 0),
            GridPoint::new(4, 0),
            GridPoint::new(4, 3),
        ];
        assert_eq!(signed_area2(&ccw), 12);
        assert_eq!(signed_area2(&[]), 0);
    }
}
