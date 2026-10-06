//! Extrusion of regions into closed prisms (spec §6.1, §3).

use crate::grid::{GridPoint, metres};
use crate::{GeomError, Region};
use i_overlay::i_shape::int::shape::IntShape;
use i_triangle::int::unchecked::IntUncheckedTriangulatable;

/// A closed triangle mesh in glTF coordinates.
///
/// Board point (x, y) at height z maps to glTF (x, z, −y) (spec §3). Triangles wind
/// counter-clockwise seen from outside, and every edge is shared by exactly two
/// triangles. There are no normals: clients compute flat normals (spec §6.1).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Prism {
    pub(crate) positions: Vec<[f32; 3]>,
    pub(crate) indices: Vec<u32>,
}

impl Prism {
    /// Vertex positions, in metres.
    pub fn positions(&self) -> &[[f32; 3]] {
        &self.positions
    }

    /// Vertex indices, three per triangle.
    pub fn indices(&self) -> &[u32] {
        &self.indices
    }

    /// Whether the prism has no triangles.
    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }
}

impl Region {
    /// Extrudes the region from board height `z_min` to `z_max` into a closed prism
    /// (spec §6.1).
    ///
    /// Each boundary point becomes a bottom and a top vertex, shared by the caps and the
    /// side walls. An empty region gives an empty prism.
    pub fn extrude(&self, z_min: f64, z_max: f64) -> Result<Prism, GeomError> {
        if !z_min.is_finite() || !z_max.is_finite() {
            return Err(GeomError::NonFinite);
        }
        if z_min >= z_max {
            return Err(GeomError::InvalidZRange { z_min, z_max });
        }
        let mut prism = Prism::default();
        for shape in self.shapes() {
            extrude_shape(shape, z_min as f32, z_max as f32, &mut prism)?;
        }
        Ok(prism)
    }
}

/// Where a boundary point occurs: its contour neighbours, which tell its interior wedge
/// apart from other occurrences of the same point.
#[derive(Clone, Copy)]
struct Occurrence {
    prev: GridPoint,
    point: GridPoint,
    next: GridPoint,
}

/// Appends one polygon with holes. Boundary point `k` of the polygon gets bottom vertex
/// `base + 2k` and top vertex `base + 2k + 1`.
fn extrude_shape(
    shape: &IntShape<i32>,
    z_min: f32,
    z_max: f32,
    prism: &mut Prism,
) -> Result<(), GeomError> {
    let base = u32::try_from(prism.positions.len()).map_err(|_| GeomError::Triangulation)?;
    let mut occurrences = Vec::with_capacity(shape.iter().map(Vec::len).sum());
    for contour in shape {
        let first = occurrences.len() as u32;
        let n = contour.len();
        for (m, &p) in contour.iter().enumerate() {
            occurrences.push(Occurrence {
                prev: contour[(m + n - 1) % n],
                point: p,
                next: contour[(m + 1) % n],
            });
            let (x, y) = (metres(p.x) as f32, -metres(p.y) as f32);
            prism.positions.push([x, z_min, y]);
            prism.positions.push([x, z_max, y]);
            // Side wall below edge m → m+1. The interior lies left of the edge (outer
            // contours run counter-clockwise, holes clockwise), so this quad faces out.
            let a = base + 2 * (first + m as u32);
            let b = base + 2 * (first + ((m + 1) % n) as u32);
            prism
                .indices
                .extend_from_slice(&[a, b, b + 1, a, b + 1, a + 1]);
        }
    }

    // The triangulator dedupes and reorders points, so map them back to occurrences.
    let mut sorted: Vec<u32> = (0..occurrences.len() as u32).collect();
    sorted.sort_unstable_by_key(|&k| {
        let p = occurrences[k as usize].point;
        (p.x, p.y)
    });
    let key = |k: u32| {
        let p = occurrences[k as usize].point;
        (p.x, p.y)
    };
    let triangulation = shape.uncheck_triangulate();
    let points = triangulation.points();
    let candidates = points
        .iter()
        .map(|p| {
            let start = sorted.partition_point(|&k| key(k) < (p.x, p.y));
            let end = sorted.partition_point(|&k| key(k) <= (p.x, p.y));
            if start == end {
                Err(GeomError::Triangulation)
            } else {
                Ok(&sorted[start..end])
            }
        })
        .collect::<Result<Vec<_>, _>>()?;

    for triangle in triangulation.triangle_indices::<usize>().chunks_exact(3) {
        let mut corners = [0u32; 3];
        for (c, corner) in corners.iter_mut().enumerate() {
            let (p, q, r) = (triangle[c], triangle[(c + 1) % 3], triangle[(c + 2) % 3]);
            *corner = match candidates[p] {
                [only] => *only,
                many => {
                    let inward = (points[q], points[r]);
                    *many
                        .iter()
                        .find(|&&k| in_wedge(&occurrences[k as usize], inward))
                        .unwrap_or(&many[0])
                }
            };
        }
        let [a, b, c] = corners.map(|k| base + 2 * k);
        // The triangulator emits counter-clockwise triangles: up for the top cap,
        // reversed for the bottom cap.
        prism
            .indices
            .extend_from_slice(&[a + 1, b + 1, c + 1, a, c, b]);
    }
    Ok(())
}

/// Whether a triangle with a corner at `occurrence.point` and its other corners at
/// `others` lies in the occurrence's interior wedge.
///
/// Several occurrences of one point (where contours touch) have disjoint wedges.
fn in_wedge(occurrence: &Occurrence, others: (GridPoint, GridPoint)) -> bool {
    let p = occurrence.point;
    let rel = |q: GridPoint| {
        (
            i128::from(q.x) - i128::from(p.x),
            i128::from(q.y) - i128::from(p.y),
        )
    };
    let cross = |a: (i128, i128), b: (i128, i128)| a.0 * b.1 - a.1 * b.0;
    // The interior runs counter-clockwise from the outgoing edge to the incoming one.
    let (out, back) = (rel(occurrence.next), rel(occurrence.prev));
    let (q, r) = (rel(others.0), rel(others.1));
    // Points into the triangle from its corner at `p`.
    let d = (q.0 + r.0, q.1 + r.1);
    if cross(out, back) > 0 {
        cross(out, d) > 0 && cross(d, back) > 0
    } else {
        cross(out, d) > 0 || cross(d, back) > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{assert_close, assert_closed, rect, signed_volume};
    use crate::{DVec2, Path, Shape, Tolerance};
    use proptest::prelude::*;

    #[test]
    fn maps_board_coordinates_to_gltf() {
        let prism = rect(1e-3, 2e-3, 3e-3, 5e-3).extrude(-1e-4, 2e-4).unwrap();
        assert_eq!(prism.positions.len(), 8);
        for &[x, y, z] in &prism.positions {
            assert!(x == 1e-3 || x == 3e-3);
            assert!(y == -1e-4 || y == 2e-4);
            // Board +y points to glTF −z.
            assert!(z == -2e-3 || z == -5e-3);
        }
    }

    #[test]
    fn box_is_closed_and_faces_outward() {
        let prism = rect(0.0, 0.0, 2e-3, 1e-3).extrude(0.0, 1e-3).unwrap();
        // 2 cap triangles each, 2 per side wall.
        assert_eq!(prism.indices.len(), 3 * (2 + 2 + 8));
        assert_closed(&prism);
        assert_close(signed_volume(&prism), 2e-9, 1e-15);
    }

    #[test]
    fn every_triangle_faces_away_from_the_centre() {
        let prism = rect(-1e-3, -1e-3, 1e-3, 1e-3).extrude(-1e-3, 1e-3).unwrap();
        for t in prism.indices.chunks_exact(3) {
            let [a, b, c] = [0, 1, 2].map(|i| glam::Vec3::from(prism.positions[t[i] as usize]));
            let normal = (b - a).cross(c - a);
            assert!(normal.dot((a + b + c) / 3.0) > 0.0, "inward triangle {t:?}");
        }
    }

    #[test]
    fn holes_become_inner_walls() {
        let ring = rect(0.0, 0.0, 3e-3, 3e-3).difference(&rect(1e-3, 1e-3, 2e-3, 2e-3));
        let prism = ring.extrude(0.0, 1e-3).unwrap();
        assert_eq!(prism.positions.len(), 16);
        assert_closed(&prism);
        assert_close(signed_volume(&prism), 8e-9, 1e-15);
    }

    #[test]
    fn touching_contours_stay_manifold() {
        // Two holes touching the outline and each other at single points.
        let outline = Path::new(DVec2::ZERO)
            .line_to(DVec2::new(4e-3, 0.0))
            .line_to(DVec2::new(4e-3, 4e-3))
            .line_to(DVec2::new(0.0, 4e-3));
        let diamond = |cx: f64, cy: f64| {
            Path::new(DVec2::new(cx - 1e-3, cy))
                .line_to(DVec2::new(cx, cy - 1e-3))
                .line_to(DVec2::new(cx + 1e-3, cy))
                .line_to(DVec2::new(cx, cy + 1e-3))
        };
        let region = Shape::Polygon {
            outline,
            holes: vec![diamond(1e-3, 2e-3), diamond(3e-3, 2e-3)],
        }
        .to_region(Tolerance::DEFAULT)
        .unwrap();
        let prism = region.extrude(0.0, 1e-3).unwrap();
        assert_closed(&prism);
        // f32 positions carry about 7 significant digits.
        assert_close(signed_volume(&prism), 12e-9, 1e-14);
    }

    #[test]
    fn empty_region_gives_empty_prism() {
        let prism = Region::empty().extrude(0.0, 1.0).unwrap();
        assert!(prism.is_empty());
        assert!(prism.positions.is_empty());
    }

    #[test]
    fn rejects_bad_z_ranges() {
        let r = rect(0.0, 0.0, 1e-3, 1e-3);
        assert_eq!(
            r.extrude(1e-3, 1e-3),
            Err(GeomError::InvalidZRange {
                z_min: 1e-3,
                z_max: 1e-3
            })
        );
        assert!(r.extrude(2e-3, 1e-3).is_err());
        assert_eq!(r.extrude(0.0, f64::NAN), Err(GeomError::NonFinite));
    }

    /// Unions of random rectangles on a coarse grid, which often touch at corners and
    /// edges, plus random circles.
    fn region() -> impl Strategy<Value = Region> {
        let rects = prop::collection::vec((0..8u8, 0..8u8, 1..4u8, 1..4u8), 1..8);
        let circles = prop::collection::vec((0.0..2.0, 0.0..2.0, 0.05..0.4), 0..3);
        (rects, circles, prop::bool::ANY).prop_map(|(rects, circles, subtract)| {
            let q = |v: u8| f64::from(v) * 0.25e-3;
            let boxes: Vec<Region> = rects
                .iter()
                .map(|&(x, y, w, h)| rect(q(x), q(y), q(x + w), q(y + h)))
                .collect();
            let discs: Vec<Region> = circles
                .iter()
                .map(|&(x, y, r)| {
                    Shape::Circle {
                        center: DVec2::new(x * 1e-3, y * 1e-3),
                        radius: r * 1e-3,
                    }
                    .to_region(Tolerance::DEFAULT)
                    .unwrap()
                })
                .collect();
            let boxes = Region::union_all(&boxes);
            let discs = Region::union_all(&discs);
            if subtract {
                boxes.difference(&discs)
            } else {
                boxes.union(&discs)
            }
        })
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(128))]

        /// Every edge is used exactly twice, in opposite directions.
        #[test]
        fn prisms_are_closed_manifolds(region in region()) {
            let prism = region.extrude(-0.5e-3, 0.25e-3).unwrap();
            assert_closed(&prism);
        }

        /// Outward orientation: the signed volume is positive and equals area × height.
        #[test]
        fn prisms_enclose_area_times_height(region in region()) {
            let prism = region.extrude(-0.5e-3, 0.25e-3).unwrap();
            let volume = signed_volume(&prism);
            let expected = region.area() * 0.75e-3;
            prop_assert!(volume > 0.0 || region.is_empty());
            // f32 positions carry about 7 significant digits.
            prop_assert!((volume - expected).abs() <= 1e-5 * expected);
        }
    }
}
