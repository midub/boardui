//! Writer for the boardui glTF profile (`spec/README.md`): glTF/GLB output, metadata tables and
//! user-model import.
//!
//! - [`BoardAsset`] describes a converted board: layers and drills with their meshes and
//!   feature tables, nets, components, pins and component bodies. [`BoardAsset::to_glb`]
//!   writes it as a GLB with the scene structure of spec §4, the materials of §7, and the
//!   `EXT_mesh_features`, `EXT_structural_metadata` and `BOARDUI_board` extensions of §8.
//! - [`Model`] reads a user-supplied glTF/GLB component model (spec §6.9).
//! - [`glb`], [`json`] and [`buffer`] read assets back, for validation.

pub mod board;
pub mod buffer;
pub mod glb;
pub mod json;
pub mod metadata;
mod model;
mod writer;

pub use board::{
    Board, BoardDrill, BoardLayer, ComponentExtras, ComponentInfo, FeatureKind, Fiducial, Mount,
    PROFILE_VERSION, Role, Side, Source, Tables, ThicknessSource,
};
pub use json::Root;
pub use model::{Model, ModelError, ModelImage, ModelPrimitive, ModelTexture};
pub use writer::{
    BoardAsset, BodyRef, BuiltinMaterial, ComponentAsset, DrillAsset, EXTENSIONS, FeatureRow,
    InstanceAsset, LayerAsset, NetRow, PinRow, PlaceholderBody, Transform, encode_id_segment,
    layer_id,
};
