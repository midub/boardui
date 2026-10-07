//! Assembly of per-feature prisms into layer mesh primitives (spec §4, §8.1).

use crate::{GeomError, Prism};
use std::ops::Range;

/// Most vertices in a primitive whose indices fit `UNSIGNED_SHORT` (spec §4).
///
/// glTF reserves index 65,535, so 65,535 vertices (indices 0 to 65,534) is the limit.
pub const MAX_PRIMITIVE_VERTICES: usize = 65_535;

/// Triangle vertex indices of a [`Primitive`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Indices {
    /// `UNSIGNED_SHORT` indices, for primitives of at most [`MAX_PRIMITIVE_VERTICES`]
    /// vertices.
    U16(Vec<u16>),
    /// `UNSIGNED_INT` indices, for a primitive that holds a single feature with more
    /// vertices.
    U32(Vec<u32>),
}

impl Indices {
    /// Number of indices.
    pub fn len(&self) -> usize {
        match self {
            Self::U16(indices) => indices.len(),
            Self::U32(indices) => indices.len(),
        }
    }

    /// Whether there are no indices.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Where one feature lies in a [`Primitive`].
#[derive(Debug, Clone, PartialEq)]
pub struct FeatureRange {
    /// Feature ID: the feature's row in the layer's feature table.
    pub id: u32,
    /// The feature's vertices.
    pub vertices: Range<u32>,
    /// The feature's entries in the index buffer.
    pub indices: Range<u32>,
    /// Lower corner of the feature's bounding box, in glTF coordinates.
    pub min: [f32; 3],
    /// Upper corner of the feature's bounding box, in glTF coordinates.
    pub max: [f32; 3],
}

/// One glTF mesh primitive of a layer.
///
/// Features are contiguous in both vertices and indices, in ascending ID order
/// (spec §8.1), and no feature spans two primitives (spec §4).
#[derive(Debug, Clone, PartialEq)]
pub struct Primitive {
    /// Vertex positions (`POSITION`), in glTF coordinates.
    pub positions: Vec<[f32; 3]>,
    /// Triangle vertex indices, counter-clockwise seen from outside.
    pub indices: Indices,
    /// Feature ID of each vertex (`_FEATURE_ID_0`). The glTF writer picks the component
    /// type from the size of the feature table (spec §8.1).
    pub feature_ids: Vec<u32>,
    /// The features, in ascending ID order. Its length is the primitive's
    /// `featureCount`.
    pub features: Vec<FeatureRange>,
    /// Lower corner of the bounding box (`POSITION` accessor `min`).
    pub min: [f32; 3],
    /// Upper corner of the bounding box (`POSITION` accessor `max`).
    pub max: [f32; 3],
}

/// The mesh of one layer or drill node: its primitives in ascending feature order.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LayerMesh {
    /// The primitives.
    pub primitives: Vec<Primitive>,
}

impl LayerMesh {
    /// The mesh of regions extruded from board height `from.0` to `from.1`
    /// ([`Region::extrude`](crate::Region::extrude)), moved to the heights `to`: the same
    /// mesh as extruding the regions from `to.0` to `to.1`, without triangulating them again.
    ///
    /// Vertices at height `from.0` move to `to.0`, all others to `to.1`. Returns `None` when
    /// extrusion rejects either range, or `from.0` and `from.1` are the same in `f32` so that
    /// bottom and top vertices can't be told apart.
    pub fn restacked(&self, from: (f64, f64), to: (f64, f64)) -> Option<Self> {
        let valid = |(z_min, z_max): (f64, f64)| {
            z_min.is_finite() && z_max.is_finite() && z_min < z_max
        };
        let (bottom, top) = (from.0 as f32, from.1 as f32);
        if !valid(from) || !valid(to) || bottom == top {
            return None;
        }
        // Board z is glTF y (spec §3).
        let z = |y: f32| if y == bottom { to.0 as f32 } else { to.1 as f32 };
        let mut mesh = self.clone();
        for p in &mut mesh.primitives {
            p.positions.iter_mut().for_each(|v| v[1] = z(v[1]));
            let ranges = p.features.iter_mut().map(|f| (&mut f.min, &mut f.max));
            for (min, max) in ranges.chain([(&mut p.min, &mut p.max)]) {
                (min[1], max[1]) = (z(min[1]), z(max[1]));
            }
        }
        Some(mesh)
    }
}

/// Builds a [`LayerMesh`] from the prisms of a layer's features (spec §4, §8.1).
///
/// Features are packed greedily into primitives of at most [`MAX_PRIMITIVE_VERTICES`]
/// vertices with `UNSIGNED_SHORT` indices. A feature never spans two primitives: a
/// feature with more vertices than that gets a primitive of its own, with
/// `UNSIGNED_INT` indices.
#[derive(Debug, Default)]
pub struct LayerMeshBuilder {
    primitives: Vec<Primitive>,
    open: Batch,
    last_id: Option<u32>,
}

impl LayerMeshBuilder {
    /// Creates an empty builder.
    pub fn new() -> Self {
        Self::default()
    }

    /// Appends the prism of feature `id`.
    ///
    /// IDs must strictly ascend from one call to the next. A feature with an empty
    /// prism has no vertices and appears in no primitive; its ID still counts for the
    /// order.
    pub fn push(&mut self, id: u32, prism: &Prism) -> Result<(), GeomError> {
        if let Some(previous) = self.last_id
            && id <= previous
        {
            return Err(GeomError::FeatureOrder { previous, next: id });
        }
        self.last_id = Some(id);
        if prism.is_empty() {
            return Ok(());
        }
        let count = prism.positions().len();
        if self.open.positions.len() + count > MAX_PRIMITIVE_VERTICES {
            self.flush();
        }
        self.open.append(id, prism);
        if count > MAX_PRIMITIVE_VERTICES {
            self.flush();
        }
        Ok(())
    }

    /// Finishes the mesh.
    pub fn finish(mut self) -> LayerMesh {
        self.flush();
        LayerMesh {
            primitives: self.primitives,
        }
    }

    fn flush(&mut self) {
        if let Some(primitive) = std::mem::take(&mut self.open).into_primitive() {
            self.primitives.push(primitive);
        }
    }
}

/// The primitive being filled.
#[derive(Debug, Default)]
struct Batch {
    positions: Vec<[f32; 3]>,
    indices: Vec<u32>,
    feature_ids: Vec<u32>,
    features: Vec<FeatureRange>,
}

impl Batch {
    fn append(&mut self, id: u32, prism: &Prism) {
        // Primitive sizes are bounded by a single prism's, whose counts fit u32.
        let first_vertex = self.positions.len() as u32;
        let first_index = self.indices.len() as u32;
        self.positions.extend_from_slice(prism.positions());
        self.indices
            .extend(prism.indices().iter().map(|&i| first_vertex + i));
        self.feature_ids.resize(self.positions.len(), id);
        let (min, max) = bounds(prism.positions());
        self.features.push(FeatureRange {
            id,
            vertices: first_vertex..self.positions.len() as u32,
            indices: first_index..self.indices.len() as u32,
            min,
            max,
        });
    }

    fn into_primitive(self) -> Option<Primitive> {
        let first = self.features.first()?;
        let (min, max) = self.features[1..]
            .iter()
            .fold((first.min, first.max), |(lo, hi), f| {
                (
                    [0, 1, 2].map(|i| lo[i].min(f.min[i])),
                    [0, 1, 2].map(|i| hi[i].max(f.max[i])),
                )
            });
        let indices = if self.positions.len() <= MAX_PRIMITIVE_VERTICES {
            // Every index is below the vertex count, so it fits.
            Indices::U16(self.indices.iter().map(|&i| i as u16).collect())
        } else {
            Indices::U32(self.indices)
        };
        Some(Primitive {
            positions: self.positions,
            indices,
            feature_ids: self.feature_ids,
            features: self.features,
            min,
            max,
        })
    }
}

/// Bounding box of a non-empty point set.
fn bounds(positions: &[[f32; 3]]) -> ([f32; 3], [f32; 3]) {
    positions.iter().fold(
        ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]),
        |(lo, hi), p| {
            (
                [0, 1, 2].map(|i| lo[i].min(p[i])),
                [0, 1, 2].map(|i| hi[i].max(p[i])),
            )
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::rect;
    use proptest::prelude::*;

    /// A synthetic prism with `n` vertices along the x axis and a fan of triangles.
    fn prism(n: usize, x0: f32) -> Prism {
        Prism {
            positions: (0..n).map(|i| [x0 + i as f32, 0.0, -1.0]).collect(),
            indices: (1..n as u32 - 1).flat_map(|i| [0, i, i + 1]).collect(),
        }
    }

    #[test]
    fn ids_must_ascend() {
        let mut builder = LayerMeshBuilder::new();
        builder.push(3, &prism(3, 0.0)).unwrap();
        assert_eq!(
            builder.push(3, &prism(3, 0.0)),
            Err(GeomError::FeatureOrder {
                previous: 3,
                next: 3
            })
        );
        assert!(builder.push(2, &Prism::default()).is_err());
        assert!(builder.push(4, &Prism::default()).is_ok());
        assert!(builder.push(4, &prism(3, 0.0)).is_err());
    }

    #[test]
    fn features_are_contiguous_with_ranges_and_bounds() {
        let a = rect(0.0, 0.0, 1e-3, 1e-3).extrude(0.0, 1e-4).unwrap();
        let b = rect(2e-3, 0.0, 3e-3, 2e-3).extrude(0.0, 1e-4).unwrap();
        let mut builder = LayerMeshBuilder::new();
        builder.push(0, &a).unwrap();
        builder.push(1, &Prism::default()).unwrap();
        builder.push(5, &b).unwrap();
        let mesh = builder.finish();
        assert_eq!(mesh.primitives.len(), 1);
        let p = &mesh.primitives[0];
        assert_eq!(p.positions.len(), 16);
        assert_eq!(p.feature_ids, [[0; 8], [5; 8]].concat());
        assert_eq!(p.features.len(), 2, "empty features have no range");
        assert_eq!(p.features[1].id, 5);
        assert_eq!(p.features[1].vertices, 8..16);
        assert_eq!(p.features[1].indices, 36..72);
        let Indices::U16(indices) = &p.indices else {
            panic!("expected u16 indices");
        };
        assert!(indices[36..].iter().all(|&i| (8..16).contains(&i)));
        assert_eq!(p.features[1].min, [2e-3, 0.0, -2e-3]);
        assert_eq!(p.features[1].max, [3e-3, 1e-4, 0.0]);
        assert_eq!(p.min, [0.0, 0.0, -2e-3]);
        assert_eq!(p.max, [3e-3, 1e-4, 0.0]);
    }

    #[test]
    fn splits_between_features_at_the_vertex_limit() {
        let mut builder = LayerMeshBuilder::new();
        for id in 0..10_000 {
            builder.push(id, &prism(8, 0.0)).unwrap();
        }
        let mesh = builder.finish();
        assert_eq!(mesh.primitives.len(), 2);
        // 8,191 features of 8 vertices fit in 65,535.
        assert_eq!(mesh.primitives[0].positions.len(), 8_191 * 8);
        assert_eq!(mesh.primitives[1].features[0].id, 8_191);
        assert_eq!(mesh.primitives[1].features[0].vertices, 0..8);
        assert!(
            mesh.primitives
                .iter()
                .all(|p| matches!(p.indices, Indices::U16(_)))
        );
    }

    #[test]
    fn oversized_features_get_their_own_u32_primitive() {
        let mut builder = LayerMeshBuilder::new();
        builder.push(0, &prism(10, 0.0)).unwrap();
        builder.push(1, &prism(70_000, 0.0)).unwrap();
        builder.push(2, &prism(10, 0.0)).unwrap();
        let mesh = builder.finish();
        assert_eq!(mesh.primitives.len(), 3);
        assert!(matches!(mesh.primitives[0].indices, Indices::U16(_)));
        let big = &mesh.primitives[1];
        assert_eq!(big.features.len(), 1);
        let Indices::U32(indices) = &big.indices else {
            panic!("expected u32 indices");
        };
        assert_eq!(indices.iter().max(), Some(&69_999));
        assert!(matches!(mesh.primitives[2].indices, Indices::U16(_)));
    }

    #[test]
    fn empty_layer_has_no_primitives() {
        assert!(LayerMeshBuilder::new().finish().primitives.is_empty());
    }

    /// A plate with a hole, extruded from `z_min` to `z_max` as one feature.
    fn plate(z_min: f64, z_max: f64) -> LayerMesh {
        let region = rect(0.0, 0.0, 3e-3, 2e-3).difference(&rect(1e-3, 5e-4, 2e-3, 1.5e-3));
        let mut builder = LayerMeshBuilder::new();
        builder
            .push(0, &region.extrude(z_min, z_max).unwrap())
            .unwrap();
        builder.finish()
    }

    #[test]
    fn restacking_needs_valid_distinct_heights() {
        let mesh = plate(0.0, 1e-4);
        assert_eq!(
            mesh.restacked((0.0, 1e-4), (1e-3, 1.2e-3)),
            Some(plate(1e-3, 1.2e-3))
        );
        assert_eq!(mesh.restacked((0.0, 1e-4), (1e-3, 1e-3)), None);
        assert_eq!(mesh.restacked((0.0, 1e-4), (0.0, f64::NAN)), None);
        assert_eq!(mesh.restacked((1e-4, 0.0), (0.0, 1e-4)), None);
        let thin = plate(1.0, 1.0 + 1e-12);
        assert_eq!(thin.restacked((1.0, 1.0 + 1e-12), (0.0, 1e-4)), None);
    }

    proptest! {
        /// Moving an extruded mesh to other heights gives exactly the mesh extruded there.
        #[test]
        fn restacking_equals_extruding_again(
            z in 0.0..3e-3f64,
            thickness in 1e-6..1e-3f64,
            to in 0.0..3e-3f64,
            to_thickness in 1e-9..1e-3f64,
        ) {
            let restacked = plate(z, z + thickness)
                .restacked((z, z + thickness), (to, to + to_thickness));
            prop_assert_eq!(restacked, Some(plate(to, to + to_thickness)));
        }
    }

    proptest! {
        /// Spec §8.1: within each primitive, features are contiguous in vertices and in
        /// indices, in ascending ID order, and reference only their own vertices.
        #[test]
        fn features_are_contiguous(
            sizes in prop::collection::vec(
                prop_oneof![8 => 3..200usize, 2 => 5_000..30_000usize, 1 => 65_000..70_000usize],
                1..20,
            ),
            gaps in prop::collection::vec(1..4u32, 20),
        ) {
            let mut builder = LayerMeshBuilder::new();
            let mut id = 0;
            let mut pushed = Vec::new();
            for (k, &n) in sizes.iter().enumerate() {
                id += gaps[k];
                let p = prism(n, k as f32);
                builder.push(id, &p).unwrap();
                pushed.push((id, p));
            }
            let mesh = builder.finish();

            let mut expected = pushed.iter();
            for primitive in &mesh.primitives {
                let n = primitive.positions.len();
                prop_assert!(n <= MAX_PRIMITIVE_VERTICES || primitive.features.len() == 1);
                prop_assert_eq!(
                    matches!(primitive.indices, Indices::U16(_)),
                    n <= MAX_PRIMITIVE_VERTICES
                );
                let indices: Vec<u32> = match &primitive.indices {
                    Indices::U16(v) => v.iter().map(|&i| u32::from(i)).collect(),
                    Indices::U32(v) => v.clone(),
                };
                let (mut vertex, mut index) = (0, 0);
                for range in &primitive.features {
                    let (id, prism) = expected.next().unwrap();
                    prop_assert_eq!(range.id, *id);
                    prop_assert_eq!(range.vertices.start, vertex);
                    prop_assert_eq!(range.indices.start, index);
                    vertex = range.vertices.end;
                    index = range.indices.end;
                    let vertices = range.vertices.start as usize..vertex as usize;
                    prop_assert_eq!(&primitive.positions[vertices.clone()], prism.positions());
                    prop_assert!(primitive.feature_ids[vertices].iter().all(|f| f == id));
                    prop_assert!(indices[range.indices.start as usize..index as usize]
                        .iter()
                        .all(|i| range.vertices.contains(i)));
                }
                prop_assert_eq!(vertex as usize, n);
                prop_assert_eq!(index as usize, indices.len());
                prop_assert!(primitive.features.windows(2).all(|w| w[0].id < w[1].id));
            }
            prop_assert!(expected.next().is_none());
        }
    }
}
