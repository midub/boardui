//! 2.5D board geometry: 2D regions, booleans, overlap resolution, holes, extrusion and
//! triangulation, as required by the boardui glTF profile (`spec/README.md` §6).
//!
//! The crate is independent of the IPC-2581 parser. Callers describe board elements with
//! the small input types here and get triangle meshes back:
//!
//! 1. Describe each element as a [`Shape`] built from [`Path`]s of line and arc
//!    [`Segment`]s (closed polygons with holes, circles or [`Stroke`]s).
//! 2. Resolve a copper layer with [`resolve_layer`]: negative polarity and overlaps are
//!    applied so that the resulting [`Region`]s never overlap (spec §6.2).
//! 3. Cut holes with a [`HoleCutter`] and build plated barrels with [`Hole::barrel`]
//!    (spec §6.3).
//! 4. Extrude each region into a closed [`Prism`] with [`Region::extrude`] (spec §6.1).
//! 5. Assemble a layer's prisms into glTF-ready primitives with [`LayerMeshBuilder`]
//!    (spec §4, §8.1).
//!
//! # Units and precision
//!
//! Input coordinates are `f64` metres in IPC orientation: +x right, +y up in the top
//! view. Regions are stored on a fixed integer grid of [`GRID_STEP`] (10 nm), so every
//! boolean operation on a layer snaps to the same grid. Coordinates must stay within
//! ±[`MAX_COORDINATE`]. Output meshes are `f32` glTF coordinates (spec §3).

mod error;
mod grid;
mod hole;
mod index;
mod layer;
mod mesh;
mod path;
mod prism;
mod region;
mod shape;
#[cfg(test)]
mod test_util;

pub use error::{FeatureError, GeomError};
pub use glam::DVec2;
pub use grid::{GRID_STEP, MAX_COORDINATE};
pub use hole::{Hole, HoleCutter};
pub use layer::{Feature, Polarity, Priority, resolve_layer};
pub use mesh::{
    FeatureRange, Indices, LayerMesh, LayerMeshBuilder, MAX_PRIMITIVE_VERTICES, Primitive,
};
pub use path::{ArcDirection, Path, Segment, Tolerance};
pub use prism::Prism;
pub use region::{Bounds, Region};
pub use shape::{LineCap, Shape, Stroke};
