//! Helpers shared by the unit and property tests.

use crate::grid::metres_point;
use crate::{DVec2, Path, Prism, Region, Shape, Tolerance};
use std::collections::HashMap;

/// An axis-aligned rectangle shape, in metres.
pub(crate) fn rect_shape(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
    Shape::Polygon {
        outline: Path::new(DVec2::new(x0, y0))
            .line_to(DVec2::new(x1, y0))
            .line_to(DVec2::new(x1, y1))
            .line_to(DVec2::new(x0, y1)),
        holes: Vec::new(),
    }
}

/// An axis-aligned rectangle region, in metres.
pub(crate) fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Region {
    rect_shape(x0, y0, x1, y1)
        .to_region(Tolerance::DEFAULT)
        .unwrap()
}

#[track_caller]
pub(crate) fn assert_close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{actual} differs from {expected} by more than {tolerance}"
    );
}

/// Total boundary length of a region, in metres.
pub(crate) fn perimeter(region: &Region) -> f64 {
    region
        .contours()
        .map(|contour| {
            let n = contour.len();
            (0..n)
                .map(|i| (metres_point(contour[(i + 1) % n]) - metres_point(contour[i])).length())
                .sum::<f64>()
        })
        .sum()
}

/// Asserts that every edge of the prism is used exactly twice, in opposite directions.
#[track_caller]
pub(crate) fn assert_closed(prism: &Prism) {
    assert_eq!(prism.indices.len() % 3, 0);
    assert!(
        prism
            .indices
            .iter()
            .all(|&i| (i as usize) < prism.positions.len())
    );
    let mut edges: HashMap<(u32, u32), u32> = HashMap::new();
    for t in prism.indices.as_chunks::<3>().0 {
        for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            assert_ne!(a, b, "degenerate triangle {t:?}");
            *edges.entry((a, b)).or_default() += 1;
        }
    }
    for (&(a, b), &count) in &edges {
        assert_eq!(count, 1, "edge {a}→{b} used {count} times in one direction");
        assert_eq!(edges.get(&(b, a)), Some(&1), "edge {a}→{b} has no opposite");
    }
}

/// Signed volume enclosed by the prism, in cubic metres; positive when its triangles
/// face outward.
pub(crate) fn signed_volume(prism: &Prism) -> f64 {
    prism
        .indices
        .as_chunks::<3>()
        .0
        .iter()
        .map(|t| {
            let [a, b, c] =
                t.map(|i| glam::DVec3::from(prism.positions[i as usize].map(f64::from)));
            a.dot(b.cross(c)) / 6.0
        })
        .sum()
}
