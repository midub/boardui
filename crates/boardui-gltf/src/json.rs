//! `serde` types for the subset of glTF 2.0 that boardui writes and validates.
//!
//! The types read any glTF asset: unknown properties are ignored, and unknown extensions and
//! extras are kept as JSON values.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

use crate::metadata::{MeshFeatures, StructuralMetadata};

/// `componentType` `UNSIGNED_BYTE`.
pub const UNSIGNED_BYTE: u32 = 5121;
/// `componentType` `UNSIGNED_SHORT`.
pub const UNSIGNED_SHORT: u32 = 5123;
/// `componentType` `UNSIGNED_INT`.
pub const UNSIGNED_INT: u32 = 5125;
/// `componentType` `FLOAT`.
pub const FLOAT: u32 = 5126;
/// `componentType` `BYTE`.
pub const BYTE: u32 = 5120;
/// `componentType` `SHORT`.
pub const SHORT: u32 = 5122;
/// Buffer view `target` for vertex attributes.
pub const ARRAY_BUFFER: u32 = 34962;
/// Buffer view `target` for indices.
pub const ELEMENT_ARRAY_BUFFER: u32 = 34963;

/// The root object of a glTF asset.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    /// `asset`.
    pub asset: Asset,
    /// `extensionsUsed`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extensions_used: Vec<String>,
    /// `extensionsRequired`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extensions_required: Vec<String>,
    /// `scene`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scene: Option<u32>,
    /// `scenes`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scenes: Vec<Scene>,
    /// `nodes`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<Node>,
    /// `meshes`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub meshes: Vec<Mesh>,
    /// `materials`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub materials: Vec<Material>,
    /// `textures`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub textures: Vec<Texture>,
    /// `images`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<Image>,
    /// `samplers`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub samplers: Vec<Sampler>,
    /// `accessors`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub accessors: Vec<Accessor>,
    /// `bufferViews`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub buffer_views: Vec<BufferView>,
    /// `buffers`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub buffers: Vec<Buffer>,
    /// `extensions`.
    #[serde(default, skip_serializing_if = "RootExtensions::is_empty")]
    pub extensions: RootExtensions,
    /// `extras`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extras: Option<Value>,
}

/// `asset`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    /// `version`, `2.0`.
    pub version: String,
    /// `generator`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generator: Option<String>,
    /// `minVersion`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_version: Option<String>,
}

/// Root `extensions`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RootExtensions {
    /// `EXT_structural_metadata`.
    #[serde(
        rename = "EXT_structural_metadata",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub structural_metadata: Option<StructuralMetadata>,
    /// `BOARDUI_board`, kept as JSON so that a validator can report schema violations
    /// itself. See [`Board`](crate::Board).
    #[serde(
        rename = "BOARDUI_board",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub board: Option<Value>,
    /// Other extensions.
    #[serde(flatten)]
    pub other: BTreeMap<String, Value>,
}

impl RootExtensions {
    fn is_empty(&self) -> bool {
        self.structural_metadata.is_none() && self.board.is_none() && self.other.is_empty()
    }
}

/// A scene.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    /// `name`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Root `nodes`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<u32>,
}

/// A node.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    /// `name`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// `children`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<u32>,
    /// `mesh`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh: Option<u32>,
    /// `translation`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub translation: Option<[f64; 3]>,
    /// `rotation` quaternion `[x, y, z, w]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<[f64; 4]>,
    /// `scale`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<[f64; 3]>,
    /// `matrix`, column-major.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matrix: Option<[f64; 16]>,
    /// `extras`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extras: Option<Value>,
}

impl Node {
    /// Whether the node has the identity transform.
    pub fn is_identity(&self) -> bool {
        const IDENTITY: [f64; 16] = [
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ];
        self.translation.is_none_or(|t| t == [0.0; 3])
            && self.rotation.is_none_or(|r| r == [0.0, 0.0, 0.0, 1.0])
            && self.scale.is_none_or(|s| s == [1.0; 3])
            && self.matrix.is_none_or(|m| m == IDENTITY)
    }
}

/// A mesh.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mesh {
    /// `name`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// `primitives`.
    pub primitives: Vec<Primitive>,
}

/// A mesh primitive.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Primitive {
    /// `attributes`: semantic → accessor.
    pub attributes: BTreeMap<String, u32>,
    /// `indices`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indices: Option<u32>,
    /// `material`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material: Option<u32>,
    /// `mode`. Absent: triangles (4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<u32>,
    /// `extensions`.
    #[serde(default, skip_serializing_if = "PrimitiveExtensions::is_empty")]
    pub extensions: PrimitiveExtensions,
}

/// Primitive `extensions`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PrimitiveExtensions {
    /// `EXT_mesh_features`.
    #[serde(
        rename = "EXT_mesh_features",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub mesh_features: Option<MeshFeatures>,
    /// Other extensions.
    #[serde(flatten)]
    pub other: BTreeMap<String, Value>,
}

impl PrimitiveExtensions {
    fn is_empty(&self) -> bool {
        self.mesh_features.is_none() && self.other.is_empty()
    }
}

/// A material.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Material {
    /// `name`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// `pbrMetallicRoughness`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pbr_metallic_roughness: Option<PbrMetallicRoughness>,
    /// `normalTexture`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normal_texture: Option<TextureInfo>,
    /// `occlusionTexture`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occlusion_texture: Option<TextureInfo>,
    /// `emissiveTexture`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emissive_texture: Option<TextureInfo>,
    /// `emissiveFactor`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emissive_factor: Option<[f32; 3]>,
    /// `alphaMode`: `OPAQUE`, `MASK` or `BLEND`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alpha_mode: Option<String>,
    /// `alphaCutoff`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alpha_cutoff: Option<f32>,
    /// `doubleSided`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub double_sided: bool,
}

/// `pbrMetallicRoughness`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PbrMetallicRoughness {
    /// `baseColorFactor`, linear RGBA.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_color_factor: Option<[f32; 4]>,
    /// `baseColorTexture`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_color_texture: Option<TextureInfo>,
    /// `metallicFactor`. Absent: 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metallic_factor: Option<f32>,
    /// `roughnessFactor`. Absent: 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roughness_factor: Option<f32>,
    /// `metallicRoughnessTexture`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metallic_roughness_texture: Option<TextureInfo>,
}

/// A texture reference in a material.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextureInfo {
    /// `index` of the texture.
    pub index: u32,
    /// `texCoord` set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tex_coord: Option<u32>,
    /// `scale` (normal textures).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f32>,
    /// `strength` (occlusion textures).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strength: Option<f32>,
}

/// A texture.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Texture {
    /// `sampler`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sampler: Option<u32>,
    /// `source` image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<u32>,
}

/// An image.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    /// `name`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// `bufferView`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buffer_view: Option<u32>,
    /// `mimeType`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// `uri`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
}

/// A texture sampler.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sampler {
    /// `magFilter`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mag_filter: Option<u32>,
    /// `minFilter`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_filter: Option<u32>,
    /// `wrapS`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrap_s: Option<u32>,
    /// `wrapT`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrap_t: Option<u32>,
}

/// An accessor.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Accessor {
    /// `bufferView`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buffer_view: Option<u32>,
    /// `byteOffset`.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub byte_offset: u64,
    /// `componentType`.
    pub component_type: u32,
    /// `normalized`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub normalized: bool,
    /// `count`.
    pub count: u64,
    /// `type`: `SCALAR`, `VEC2`, `VEC3`, `VEC4`, `MAT2`, `MAT3` or `MAT4`.
    #[serde(rename = "type")]
    pub kind: String,
    /// `min`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<Vec<f64>>,
    /// `max`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<Vec<f64>>,
    /// `sparse`, not used by boardui.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sparse: Option<Value>,
}

impl Accessor {
    /// Number of components per element, or `None` for an unknown `type`.
    pub fn components(&self) -> Option<usize> {
        Some(match self.kind.as_str() {
            "SCALAR" => 1,
            "VEC2" => 2,
            "VEC3" => 3,
            "VEC4" | "MAT2" => 4,
            "MAT3" => 9,
            "MAT4" => 16,
            _ => return None,
        })
    }
}

/// Size in bytes of a `componentType`, or `None` for an unknown type.
pub fn component_size(component_type: u32) -> Option<usize> {
    Some(match component_type {
        BYTE | UNSIGNED_BYTE => 1,
        SHORT | UNSIGNED_SHORT => 2,
        UNSIGNED_INT | FLOAT => 4,
        _ => return None,
    })
}

/// A buffer view.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BufferView {
    /// `buffer`.
    pub buffer: u32,
    /// `byteOffset`.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub byte_offset: u64,
    /// `byteLength`.
    pub byte_length: u64,
    /// `byteStride`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub byte_stride: Option<u32>,
    /// `target`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<u32>,
}

/// A buffer.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Buffer {
    /// `byteLength`.
    pub byte_length: u64,
    /// `uri`. Absent for the GLB binary chunk.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
}

fn is_zero(value: &u64) -> bool {
    *value == 0
}
