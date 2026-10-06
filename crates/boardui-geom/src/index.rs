//! Spatial index over region bounding boxes.

use crate::grid::GridPoint;
use crate::region::GridRect;
use rstar::primitives::{GeomWithData, Rectangle};
use rstar::{AABB, RTree};

type Entry = GeomWithData<Rectangle<[f64; 2]>, usize>;

/// An R-tree of bounding boxes, each tagged with an index chosen by the caller.
pub(crate) struct BoundsIndex {
    tree: RTree<Entry>,
}

impl BoundsIndex {
    /// Bulk-loads the index.
    pub(crate) fn new(items: impl IntoIterator<Item = (usize, GridRect)>) -> Self {
        let entries = items
            .into_iter()
            .map(|(index, rect)| {
                GeomWithData::new(
                    Rectangle::from_corners(corner(rect.min), corner(rect.max)),
                    index,
                )
            })
            .collect();
        Self {
            tree: RTree::bulk_load(entries),
        }
    }

    /// Indices of the boxes that intersect or touch `rect`, in no particular order.
    pub(crate) fn query(&self, rect: GridRect) -> impl Iterator<Item = usize> + '_ {
        // f64 holds grid coordinates exactly and, unlike i32, can't overflow in rstar's
        // area computations.
        let envelope = AABB::from_corners(corner(rect.min), corner(rect.max));
        self.tree
            .locate_in_envelope_intersecting(envelope)
            .map(|entry| entry.data)
    }
}

fn corner(p: GridPoint) -> [f64; 2] {
    [f64::from(p.x), f64::from(p.y)]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: i32, y0: i32, x1: i32, y1: i32) -> GridRect {
        GridRect {
            min: GridPoint::new(x0, y0),
            max: GridPoint::new(x1, y1),
        }
    }

    #[test]
    fn finds_intersecting_and_touching_boxes_only() {
        let index = BoundsIndex::new([
            (7, rect(0, 0, 10, 10)),
            (8, rect(10, 0, 20, 10)),
            (9, rect(30, 30, 40, 40)),
        ]);
        let mut found: Vec<usize> = index.query(rect(5, 5, 10, 6)).collect();
        found.sort_unstable();
        assert_eq!(found, [7, 8]);
        assert_eq!(index.query(rect(21, 21, 29, 29)).count(), 0);
    }
}
