//! Holes, slots and plated barrels (spec §6.3).

use crate::index::BoundsIndex;
use crate::shape::non_negative;
use crate::{GeomError, Prism, Region, Shape, Tolerance};
use glam::DVec2;

/// A drilled hole (IPC-2581 `Hole`) or slot (`SlotCavity`), at its finished size.
#[derive(Debug, Clone, PartialEq)]
pub enum Hole {
    /// A round hole.
    Round {
        /// Centre.
        center: DVec2,
        /// Diameter, in metres.
        diameter: f64,
    },
    /// A slot with the given outline, for example an oval [`Stroke`](crate::Stroke).
    Slot(Shape),
}

impl Hole {
    /// The area this hole removes from a layer: the opening grown by `clearance`.
    ///
    /// Pass the plating thickness as `clearance` for plated holes, which cuts layers at
    /// the outside of the barrel, and 0 for non-plated holes (spec §6.3). Slot outlines
    /// grow with rounded corners.
    pub fn cut_region(&self, clearance: f64, tolerance: Tolerance) -> Result<Region, GeomError> {
        let clearance = non_negative(clearance, "hole clearance")?;
        match self {
            Self::Round { center, diameter } => Shape::Circle {
                center: *center,
                radius: non_negative(*diameter, "hole diameter")? / 2.0 + clearance,
            }
            .to_region(tolerance),
            Self::Slot(outline) => outline.to_region(tolerance)?.offset(clearance, tolerance),
        }
    }

    /// The plated barrel: a tube around the opening with walls `wall` thick, from board
    /// height `z_min` to `z_max` (spec §6.3).
    ///
    /// Its outer wall coincides with [`Self::cut_region`] for the same `wall`.
    pub fn barrel(
        &self,
        wall: f64,
        z_min: f64,
        z_max: f64,
        tolerance: Tolerance,
    ) -> Result<Prism, GeomError> {
        let outer = self.cut_region(wall, tolerance)?;
        let inner = self.cut_region(0.0, tolerance)?;
        outer.difference(&inner).extrude(z_min, z_max)
    }
}

/// Cuts a fixed set of areas out of regions.
///
/// The areas are indexed in an R-tree, so each region only meets the cuts near it.
/// Typically the cuts are the [`Hole::cut_region`]s of every hole that passes through
/// one layer.
pub struct HoleCutter {
    cuts: Vec<Region>,
    index: BoundsIndex,
}

impl HoleCutter {
    /// Indexes the areas to cut.
    pub fn new(cuts: Vec<Region>) -> Self {
        let index = BoundsIndex::new(
            cuts.iter()
                .enumerate()
                .filter_map(|(i, cut)| Some((i, cut.grid_bounds()?))),
        );
        Self { cuts, index }
    }

    /// `region` without the cuts.
    pub fn cut(&self, region: &Region) -> Region {
        let Some(bounds) = region.grid_bounds() else {
            return Region::empty();
        };
        region.subtract(self.index.query(bounds).map(|i| &self.cuts[i]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{assert_close, assert_closed, rect, signed_volume};
    use crate::{LineCap, Path, Stroke};
    use std::f64::consts::{PI, TAU};

    const T: Tolerance = Tolerance::DEFAULT;

    fn drill(x: f64, diameter: f64) -> Hole {
        Hole::Round {
            center: DVec2::new(x, 0.0),
            diameter,
        }
    }

    /// Area lost by inscribing a circle of `radius`.
    fn slack(radius: f64) -> f64 {
        TAU * radius * T.metres()
    }

    #[test]
    fn non_plated_holes_cut_at_their_radius() {
        let cut = drill(0.0, 1e-3).cut_region(0.0, T).unwrap();
        assert_close(cut.area(), PI * 0.25e-6, slack(0.5e-3));
    }

    #[test]
    fn plated_holes_cut_at_the_barrel_outside() {
        let cut = drill(0.0, 1e-3).cut_region(25e-6, T).unwrap();
        let r = 0.525e-3;
        assert_close(cut.area(), PI * r * r, slack(r));
        assert_close(cut.bounds().unwrap().max.x, r, 1e-9);
    }

    #[test]
    fn slots_grow_by_the_clearance() {
        let slot = Hole::Slot(Shape::Stroke(Stroke {
            path: Path::new(DVec2::ZERO).line_to(DVec2::new(2e-3, 0.0)),
            width: 1e-3,
            cap: LineCap::Round,
        }));
        let opening = slot.cut_region(0.0, T).unwrap();
        let cut = slot.cut_region(25e-6, T).unwrap();
        let grown = 2e-3 * 1.05e-3 + PI * 0.525e-3 * 0.525e-3;
        assert_close(opening.area(), 2e-3 * 1e-3 + PI * 0.25e-6, slack(0.5e-3));
        assert_close(cut.area(), grown, 2.0 * slack(0.525e-3));
        assert!(cut.difference(&opening).area() > 0.0);
        assert!(opening.difference(&cut).is_empty());
    }

    #[test]
    fn invalid_holes_are_errors() {
        assert!(matches!(
            drill(0.0, -1e-3).cut_region(0.0, T),
            Err(GeomError::NegativeLength {
                what: "hole diameter",
                ..
            })
        ));
        assert!(matches!(
            drill(0.0, 1e-3).cut_region(-1e-6, T),
            Err(GeomError::NegativeLength {
                what: "hole clearance",
                ..
            })
        ));
    }

    #[test]
    fn barrels_are_closed_tubes() {
        let (r, wall) = (0.15e-3, 25e-6);
        let barrel = drill(1e-3, 2.0 * r)
            .barrel(wall, -0.8e-3, 0.8e-3, T)
            .unwrap();
        assert_closed(&barrel);
        let expected = PI * ((r + wall) * (r + wall) - r * r) * 1.6e-3;
        let volume = signed_volume(&barrel);
        assert!(volume > 0.0);
        assert_close(volume, expected, (slack(r) + slack(r + wall)) * 1.6e-3);
        // The tube is open: nothing near the hole axis.
        assert!(barrel.positions.iter().all(|&[x, _, z]| {
            let d = DVec2::new(f64::from(x) - 1e-3, f64::from(z)).length();
            d > r - 1e-6
        }));
    }

    #[test]
    fn cutter_removes_holes_from_nearby_regions_only() {
        let cutter = HoleCutter::new(vec![
            drill(0.0, 0.5e-3).cut_region(0.0, T).unwrap(),
            drill(10e-3, 0.5e-3).cut_region(0.0, T).unwrap(),
        ]);
        let pad = rect(-1e-3, -1e-3, 1e-3, 1e-3);
        let cut = cutter.cut(&pad);
        assert_close(cut.area(), 4e-6 - PI * 0.0625e-6, slack(0.25e-3));
        let far = rect(4e-3, -1e-3, 6e-3, 1e-3);
        assert_eq!(cutter.cut(&far), far);
        assert!(cutter.cut(&Region::empty()).is_empty());
    }
}
