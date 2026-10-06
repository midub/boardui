//! Conversion between metres and the integer grid that regions are stored on.

use crate::GeomError;
use glam::DVec2;
use i_overlay::i_float::int::point::IntPoint;

/// Size of the integer grid that regions are stored on, in metres (10 nm).
///
/// Every coordinate is rounded to this grid when a shape becomes a [`Region`](crate::Region),
/// so all regions of a layer share one grid and booleans between them are consistent.
pub const GRID_STEP: f64 = 1.0 / UNITS_PER_METRE;

/// Largest supported absolute coordinate or length, in metres (2²⁸ grid steps, about
/// 2.68 m).
///
/// The limit keeps every intermediate value of the integer boolean engine in range.
pub const MAX_COORDINATE: f64 = MAX_UNITS as f64 / UNITS_PER_METRE;

const UNITS_PER_METRE: f64 = 1e8;
const MAX_UNITS: i32 = 1 << 28;

/// A point on the grid.
pub(crate) type GridPoint = IntPoint<i32>;

/// Converts metres to grid units.
pub(crate) fn units(metres: f64) -> Result<i32, GeomError> {
    if !metres.is_finite() {
        return Err(GeomError::NonFinite);
    }
    let units = (metres * UNITS_PER_METRE).round();
    if units.abs() > f64::from(MAX_UNITS) {
        return Err(GeomError::OutOfRange { value: metres });
    }
    // In range, so the cast is exact.
    Ok(units as i32)
}

/// Converts a point in metres to the grid.
pub(crate) fn grid_point(p: DVec2) -> Result<GridPoint, GeomError> {
    Ok(GridPoint::new(units(p.x)?, units(p.y)?))
}

/// Converts grid units to metres.
pub(crate) fn metres(units: i32) -> f64 {
    f64::from(units) / UNITS_PER_METRE
}

/// Converts a grid point to metres.
pub(crate) fn metres_point(p: GridPoint) -> DVec2 {
    DVec2::new(metres(p.x), metres(p.y))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_to_the_nearest_grid_step() {
        assert_eq!(units(0.001), Ok(100_000));
        assert_eq!(units(-0.000_000_014), Ok(-1));
        assert_eq!(units(0.000_000_016), Ok(2));
        assert_eq!(metres(100_000), 0.001);
    }

    #[test]
    fn rejects_non_finite_values() {
        assert_eq!(units(f64::NAN), Err(GeomError::NonFinite));
        assert_eq!(units(f64::INFINITY), Err(GeomError::NonFinite));
    }

    #[test]
    fn rejects_coordinates_out_of_range() {
        assert!(units(MAX_COORDINATE).is_ok());
        assert!(units(-MAX_COORDINATE).is_ok());
        assert_eq!(units(3.0), Err(GeomError::OutOfRange { value: 3.0 }));
        assert!(grid_point(DVec2::new(0.0, -3.0)).is_err());
    }
}
