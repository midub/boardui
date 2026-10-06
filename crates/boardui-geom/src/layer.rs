//! Copper layer resolution: polarity and overlap priority (spec §6.2).

use crate::index::BoundsIndex;
use crate::region::GridRect;
use crate::{FeatureError, Region, Shape, Tolerance};

/// Overlap priority class of a copper feature (spec §6.2), from highest to lowest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Priority {
    /// Pads: `Pad`, or features in a `Set` with `padUsage="TERMINATION"`.
    Pad,
    /// Via lands: features in a `Set` with `padUsage="VIA"`.
    ViaLand,
    /// Traces: lines, arcs and polylines.
    Trace,
    /// Fills: contours and planes.
    Fill,
    /// Everything else.
    Other,
}

impl Priority {
    /// Lower rank wins.
    fn rank(self) -> u8 {
        match self {
            Self::Pad => 0,
            Self::ViaLand => 1,
            Self::Trace => 2,
            Self::Fill => 3,
            Self::Other => 4,
        }
    }
}

/// Whether a feature adds or removes copper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Polarity {
    /// Adds copper.
    Positive,
    /// Removes copper from every feature before it in document order.
    Negative,
}

/// A source feature of a copper layer.
#[derive(Debug, Clone, PartialEq)]
pub struct Feature {
    /// Geometry.
    pub shape: Shape,
    /// Overlap priority class.
    pub priority: Priority,
    /// Polarity.
    pub polarity: Polarity,
}

/// Resolves a layer's features into regions that don't overlap (spec §6.2).
///
/// `features` must be in document order; a feature's index in the slice is its
/// document position. The result has one region per feature, in the same order:
///
/// - A negative feature removes its area from every feature before it and resolves to
///   an empty region. Features after it are not affected.
/// - Where positive features overlap, the one with the higher [`Priority`] keeps the
///   overlapping area. On equal priority the earlier feature keeps it.
/// - A feature whose area is taken entirely resolves to an empty region, keeping its
///   slot.
///
/// The union of the regions is the layer's copper. Regions don't overlap, up to slivers
/// of grid rounding where boundaries cross.
///
/// Each feature only meets the features whose bounding boxes intersect its own, found
/// through an R-tree, so the cost grows with the number of neighbours rather than with
/// the layer size.
///
/// # Errors
///
/// Returns the index and cause of the first feature whose shape is invalid.
pub fn resolve_layer(
    features: &[Feature],
    tolerance: Tolerance,
) -> Result<Vec<Region>, FeatureError> {
    let mut regions = features
        .iter()
        .enumerate()
        .map(|(index, feature)| {
            feature
                .shape
                .to_region(tolerance)
                .map_err(|error| FeatureError { index, error })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let negative = |i: usize| features[i].polarity == Polarity::Negative;

    // Negative polarity: subtract every later negative feature nearby.
    let negatives = BoundsIndex::new(
        (0..features.len())
            .filter(|&i| negative(i))
            .filter_map(|i| Some((i, regions[i].grid_bounds()?))),
    );
    let bounds: Vec<Option<GridRect>> = regions.iter().map(Region::grid_bounds).collect();
    let cleared = subtract_neighbours(&regions, &bounds, &negatives, |i, j| !negative(i) && j > i);
    apply(&mut regions, cleared);
    for (i, region) in regions.iter_mut().enumerate() {
        if negative(i) {
            *region = Region::empty();
        }
    }

    // Overlaps: subtract every nearby feature that beats this one.
    let bounds: Vec<Option<GridRect>> = regions.iter().map(Region::grid_bounds).collect();
    let positives = BoundsIndex::new(
        bounds
            .iter()
            .enumerate()
            .filter_map(|(i, b)| Some((i, (*b)?))),
    );
    let beats = |i: usize, k: usize| {
        let (rank_i, rank_k) = (features[i].priority.rank(), features[k].priority.rank());
        rank_k < rank_i || (rank_k == rank_i && k < i)
    };
    let trimmed = subtract_neighbours(&regions, &bounds, &positives, beats);
    apply(&mut regions, trimmed);
    Ok(regions)
}

/// For every region `i`, subtracts the indexed regions `j` near it for which
/// `cuts(i, j)` holds. Returns only the regions that changed.
///
/// All results are computed from the unchanged input, so the order doesn't matter.
fn subtract_neighbours(
    regions: &[Region],
    bounds: &[Option<GridRect>],
    index: &BoundsIndex,
    cuts: impl Fn(usize, usize) -> bool,
) -> Vec<(usize, Region)> {
    bounds
        .iter()
        .enumerate()
        .filter_map(|(i, b)| {
            let cutters: Vec<&Region> = index
                .query((*b)?)
                .filter(|&j| j != i && cuts(i, j))
                .map(|j| &regions[j])
                .collect();
            (!cutters.is_empty()).then(|| (i, regions[i].subtract(cutters)))
        })
        .collect()
}

fn apply(regions: &mut [Region], changes: Vec<(usize, Region)>) {
    for (i, region) in changes {
        regions[i] = region;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{assert_close, perimeter, rect_shape};
    use crate::{DVec2, GRID_STEP, GeomError, LineCap, Path, Stroke};
    use proptest::prelude::*;

    const T: Tolerance = Tolerance::DEFAULT;

    fn feature(shape: Shape, priority: Priority) -> Feature {
        Feature {
            shape,
            priority,
            polarity: Polarity::Positive,
        }
    }

    fn negative(shape: Shape) -> Feature {
        Feature {
            shape,
            priority: Priority::Other,
            polarity: Polarity::Negative,
        }
    }

    /// A 2 mm × 1 mm rectangle with its lower left corner at `x` mm.
    fn block(x: f64, priority: Priority) -> Feature {
        feature(rect_shape(x * 1e-3, 0.0, x * 1e-3 + 2e-3, 1e-3), priority)
    }

    #[test]
    fn disjoint_features_are_unchanged() {
        let regions =
            resolve_layer(&[block(0.0, Priority::Trace), block(3.0, Priority::Pad)], T).unwrap();
        assert_close(regions[0].area(), 2e-6, 1e-15);
        assert_close(regions[1].area(), 2e-6, 1e-15);
    }

    #[test]
    fn higher_priority_keeps_the_overlap() {
        // The trace comes first but loses the 1 mm² overlap to the pad.
        let regions =
            resolve_layer(&[block(0.0, Priority::Trace), block(1.0, Priority::Pad)], T).unwrap();
        assert_close(regions[0].area(), 1e-6, 1e-15);
        assert_close(regions[1].area(), 2e-6, 1e-15);
        assert_close(regions[0].bounds().unwrap().max.x, 1e-3, 1e-12);
    }

    #[test]
    fn priority_classes_are_ordered() {
        let order = [
            Priority::Pad,
            Priority::ViaLand,
            Priority::Trace,
            Priority::Fill,
            Priority::Other,
        ];
        for pair in order.windows(2) {
            let (high, low) = (pair[0], pair[1]);
            let regions = resolve_layer(&[block(0.0, low), block(1.0, high)], T).unwrap();
            assert_close(regions[0].area(), 1e-6, 1e-15);
            assert_close(regions[1].area(), 2e-6, 1e-15);
        }
    }

    #[test]
    fn earlier_feature_wins_on_equal_priority() {
        let regions =
            resolve_layer(&[block(0.0, Priority::Fill), block(1.0, Priority::Fill)], T).unwrap();
        assert_close(regions[0].area(), 2e-6, 1e-15);
        assert_close(regions[1].area(), 1e-6, 1e-15);
        assert_close(regions[1].bounds().unwrap().min.x, 2e-3, 1e-12);
    }

    #[test]
    fn negative_features_clear_earlier_features_only() {
        let hole = rect_shape(0.5e-3, 0.0, 3.5e-3, 1e-3);
        let regions = resolve_layer(
            &[
                block(0.0, Priority::Pad),
                negative(hole),
                block(2.0, Priority::Trace),
            ],
            T,
        )
        .unwrap();
        assert_close(regions[0].area(), 0.5e-6, 1e-15);
        assert!(regions[1].is_empty(), "negative features have no geometry");
        assert_close(regions[2].area(), 2e-6, 1e-15);
    }

    #[test]
    fn cleared_area_is_not_claimed_by_lower_priority() {
        // The negative feature removes the pad's overlap with the fill first; the fill,
        // which comes later, then gets everything the pad no longer has.
        let regions = resolve_layer(
            &[
                block(0.0, Priority::Pad),
                negative(rect_shape(0.0, 0.0, 2e-3, 1e-3)),
                block(1.0, Priority::Fill),
            ],
            T,
        )
        .unwrap();
        assert!(regions[0].is_empty());
        assert_close(regions[2].area(), 2e-6, 1e-15);
    }

    #[test]
    fn covered_features_keep_their_slot() {
        let regions = resolve_layer(
            &[
                block(0.0, Priority::Pad),
                feature(rect_shape(0.5e-3, 0.25e-3, 1e-3, 0.75e-3), Priority::Trace),
                block(5.0, Priority::Trace),
            ],
            T,
        )
        .unwrap();
        assert_eq!(regions.len(), 3);
        assert!(regions[1].is_empty());
        assert!(!regions[2].is_empty());
    }

    #[test]
    fn invalid_shapes_report_their_index() {
        let bad = feature(
            Shape::Circle {
                center: DVec2::ZERO,
                radius: f64::NAN,
            },
            Priority::Pad,
        );
        let err = resolve_layer(&[block(0.0, Priority::Pad), bad], T).unwrap_err();
        assert_eq!(
            err,
            FeatureError {
                index: 1,
                error: GeomError::NonFinite
            }
        );
    }

    fn priority() -> impl Strategy<Value = Priority> {
        prop_oneof![
            Just(Priority::Pad),
            Just(Priority::ViaLand),
            Just(Priority::Trace),
            Just(Priority::Fill),
            Just(Priority::Other),
        ]
    }

    /// Shapes in a 2 mm square. Rectangles snap to a coarse 0.25 mm grid so that edges and
    /// corners often coincide; circles and strokes don't.
    fn shape() -> impl Strategy<Value = Shape> {
        let mm = |v: f64| v * 1e-3;
        let rect = (0..8u8, 0..8u8, 1..5u8, 1..5u8).prop_map(move |(x, y, w, h)| {
            let (x, y) = (f64::from(x) * 0.25, f64::from(y) * 0.25);
            let (w, h) = (f64::from(w) * 0.25, f64::from(h) * 0.25);
            rect_shape(mm(x), mm(y), mm(x + w), mm(y + h))
        });
        let circle = (0.0..2.0, 0.0..2.0, 0.05..0.5).prop_map(move |(x, y, r)| Shape::Circle {
            center: DVec2::new(mm(x), mm(y)),
            radius: mm(r),
        });
        let cap = prop_oneof![
            Just(LineCap::Round),
            Just(LineCap::Square),
            Just(LineCap::Flat)
        ];
        let stroke = (
            prop::collection::vec((0.0..2.0, 0.0..2.0), 2..4),
            0.05..0.3,
            cap,
        )
            .prop_map(move |(points, width, cap)| {
                let mut path = Path::new(DVec2::new(mm(points[0].0), mm(points[0].1)));
                for &(x, y) in &points[1..] {
                    path = path.line_to(DVec2::new(mm(x), mm(y)));
                }
                Shape::Stroke(Stroke {
                    path,
                    width: mm(width),
                    cap,
                })
            });
        prop_oneof![rect, circle, stroke]
    }

    fn features() -> impl Strategy<Value = Vec<Feature>> {
        let feature = (shape(), priority(), prop::bool::weighted(0.2)).prop_map(
            |(shape, priority, negative)| Feature {
                shape,
                priority,
                polarity: if negative {
                    Polarity::Negative
                } else {
                    Polarity::Positive
                },
            },
        );
        prop::collection::vec(feature, 1..10)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(64))]

        /// Spec §6.2: the sum of the feature areas equals the area of their union, and the
        /// union is the copper drawn in document order.
        #[test]
        fn resolved_features_do_not_overlap(features in features()) {
            let resolved = resolve_layer(&features, T).unwrap();
            prop_assert_eq!(resolved.len(), features.len());

            let sources: Vec<Region> =
                features.iter().map(|f| f.shape.to_region(T).unwrap()).collect();
            // Every boundary crossing may round by up to a grid step.
            let slack = GRID_STEP
                * (resolved.iter().map(perimeter).sum::<f64>()
                    + sources.iter().map(perimeter).sum::<f64>());

            let sum: f64 = resolved.iter().map(Region::area).sum();
            let union = Region::union_all(&resolved);
            prop_assert!((sum - union.area()).abs() <= slack, "overlap {}", sum - union.area());

            let mut copper = Region::empty();
            for (feature, region) in features.iter().zip(&sources) {
                copper = match feature.polarity {
                    Polarity::Positive => copper.union(region),
                    Polarity::Negative => copper.difference(region),
                };
            }
            let mismatch = copper.difference(&union).area() + union.difference(&copper).area();
            prop_assert!(mismatch <= slack, "copper mismatch {}", mismatch);

            for (i, (feature, region)) in features.iter().zip(&resolved).enumerate() {
                prop_assert!(region.difference(&sources[i]).area() <= slack);
                if feature.polarity == Polarity::Negative {
                    prop_assert!(region.is_empty());
                }
            }
        }

        /// A feature never keeps area of a feature that beats it.
        #[test]
        fn losers_keep_no_area_of_winners(features in features()) {
            let resolved = resolve_layer(&features, T).unwrap();
            let slack = GRID_STEP * resolved.iter().map(perimeter).sum::<f64>();
            for (i, loser) in resolved.iter().enumerate() {
                for (k, winner) in resolved.iter().enumerate() {
                    let (ri, rk) = (features[i].priority.rank(), features[k].priority.rank());
                    if rk < ri || (rk == ri && k < i) {
                        prop_assert!(loser.intersection(winner).area() <= slack);
                    }
                }
            }
        }
    }
}
