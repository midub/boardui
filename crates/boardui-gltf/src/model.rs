//! User-supplied component models (spec §6.9), read with the `gltf` crate.
//!
//! A model's default scene is flattened into one mesh: each primitive of each node is baked
//! into the model frame with its node's world transform. Every component that uses the model
//! then shares that mesh (spec §6.8). Positions, normals, the first texture coordinate and
//! colour sets, indices and materials (with their textures) are kept; skins, morph targets,
//! animations, cameras and lights are dropped.

use std::collections::HashMap;
use std::fmt;

use base64::Engine;
use gltf::mesh::Mode;

use crate::buffer::{AssetBuilder, push};
use crate::json::{Image, Material, Mesh, PbrMetallicRoughness, Primitive, Sampler, TextureInfo};

/// A user model, flattened into one mesh.
#[derive(Debug, Clone, PartialEq)]
pub struct Model {
    /// Name of the model node, usually the file stem.
    pub name: String,
    /// Primitives in the model frame.
    pub primitives: Vec<ModelPrimitive>,
    /// Materials; textures index [`Model::textures`].
    pub materials: Vec<Material>,
    /// Textures.
    pub textures: Vec<ModelTexture>,
    /// Encoded images (PNG, JPEG, …).
    pub images: Vec<ModelImage>,
    /// Things that were dropped while reading, for diagnostics.
    pub warnings: Vec<String>,
}

/// A triangle primitive of a [`Model`].
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ModelPrimitive {
    /// Positions.
    pub positions: Vec<[f32; 3]>,
    /// Normals, if the source had them.
    pub normals: Option<Vec<[f32; 3]>>,
    /// First texture coordinate set.
    pub tex_coords: Option<Vec<[f32; 2]>>,
    /// First colour set, RGBA.
    pub colors: Option<Vec<[f32; 4]>>,
    /// Triangle indices, counter-clockwise.
    pub indices: Vec<u32>,
    /// Index into [`Model::materials`].
    pub material: Option<usize>,
}

/// A texture of a [`Model`].
#[derive(Debug, Clone, PartialEq)]
pub struct ModelTexture {
    /// Index into [`Model::images`].
    pub image: usize,
    /// Sampler settings.
    pub sampler: Option<Sampler>,
}

/// An encoded image of a [`Model`].
#[derive(Debug, Clone, PartialEq)]
pub struct ModelImage {
    /// The encoded bytes.
    pub bytes: Vec<u8>,
    /// MIME type, for example `image/png`.
    pub mime_type: String,
}

/// Why a model could not be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelError(pub String);

impl fmt::Display for ModelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ModelError {}

impl Model {
    /// Reads a `.glb` or `.gltf` model.
    ///
    /// `resolve` loads external resources (buffers and images) by their URI, relative to the
    /// model file. Data URIs are decoded here.
    ///
    /// # Errors
    ///
    /// Returns an error if the file is not valid glTF, a resource can't be loaded, or the
    /// model has no triangles.
    pub fn from_slice(
        name: &str,
        bytes: &[u8],
        mut resolve: impl FnMut(&str) -> Result<Vec<u8>, String>,
    ) -> Result<Self, ModelError> {
        let gltf = gltf::Gltf::from_slice(bytes).map_err(|e| ModelError(e.to_string()))?;
        let mut load = |uri: &str| -> Result<Vec<u8>, ModelError> {
            if let Some(data) = uri.strip_prefix("data:") {
                let (_, payload) = data
                    .split_once(";base64,")
                    .ok_or_else(|| ModelError(format!("unsupported data URI in {name}")))?;
                base64::engine::general_purpose::STANDARD
                    .decode(payload)
                    .map_err(|e| ModelError(format!("bad data URI in {name}: {e}")))
            } else {
                resolve(uri).map_err(|e| ModelError(format!("cannot load {uri}: {e}")))
            }
        };
        let mut buffers = Vec::new();
        for buffer in gltf.buffers() {
            let data = match buffer.source() {
                gltf::buffer::Source::Bin => gltf
                    .blob
                    .clone()
                    .ok_or_else(|| ModelError(format!("{name} has no binary chunk")))?,
                gltf::buffer::Source::Uri(uri) => load(uri)?,
            };
            if data.len() < buffer.length() {
                return Err(ModelError(format!("buffer {} is short", buffer.index())));
            }
            buffers.push(data);
        }

        let mut model = Self {
            name: name.to_owned(),
            primitives: Vec::new(),
            materials: Vec::new(),
            textures: Vec::new(),
            images: Vec::new(),
            warnings: Vec::new(),
        };
        let mut reader = Reader {
            buffers: &buffers,
            load: &mut load,
            materials: HashMap::new(),
            textures: HashMap::new(),
            images: HashMap::new(),
        };
        let scene = gltf
            .default_scene()
            .or_else(|| gltf.scenes().next())
            .ok_or_else(|| ModelError(format!("{name} has no scene")))?;
        for node in scene.nodes() {
            reader.node(&mut model, &node, glam::Mat4::IDENTITY)?;
        }
        if gltf.skins().next().is_some() || gltf.animations().next().is_some() {
            model.warnings.push("skins and animations are ignored".into());
        }
        if model.primitives.is_empty() {
            return Err(ModelError(format!("{name} has no triangles")));
        }
        Ok(model)
    }

    /// Bounding box of all positions, `(min, max)`.
    pub fn bounds(&self) -> ([f32; 3], [f32; 3]) {
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for p in self.primitives.iter().flat_map(|p| &p.positions) {
            for k in 0..3 {
                min[k] = min[k].min(p[k]);
                max[k] = max[k].max(p[k]);
            }
        }
        (min, max)
    }

    /// Writes the model's mesh, materials and textures. Returns the mesh index.
    pub(crate) fn write(&self, out: &mut AssetBuilder) -> u32 {
        let images: Vec<u32> = self
            .images
            .iter()
            .map(|image| {
                let view = out.push_view(&image.bytes, None, None);
                push(
                    &mut out.root.images,
                    Image {
                        name: None,
                        buffer_view: Some(view),
                        mime_type: Some(image.mime_type.clone()),
                        uri: None,
                    },
                )
            })
            .collect();
        let textures: Vec<u32> = self
            .textures
            .iter()
            .map(|texture| {
                let sampler = texture
                    .sampler
                    .clone()
                    .map(|s| push(&mut out.root.samplers, s));
                push(
                    &mut out.root.textures,
                    crate::json::Texture {
                        sampler,
                        source: Some(images[texture.image]),
                    },
                )
            })
            .collect();
        let remap = |info: &mut Option<TextureInfo>| {
            if let Some(info) = info {
                info.index = textures[info.index as usize];
            }
        };
        let materials: Vec<u32> = self
            .materials
            .iter()
            .map(|material| {
                let mut material = material.clone();
                if let Some(pbr) = &mut material.pbr_metallic_roughness {
                    remap(&mut pbr.base_color_texture);
                    remap(&mut pbr.metallic_roughness_texture);
                }
                remap(&mut material.normal_texture);
                remap(&mut material.occlusion_texture);
                remap(&mut material.emissive_texture);
                push(&mut out.root.materials, material)
            })
            .collect();
        let mut primitives = Vec::new();
        for p in &self.primitives {
            let mut attributes = std::collections::BTreeMap::new();
            attributes.insert("POSITION".to_owned(), out.push_vec3(&p.positions, true));
            if let Some(normals) = &p.normals {
                attributes.insert("NORMAL".to_owned(), out.push_vec3(normals, false));
            }
            if let Some(uv) = &p.tex_coords {
                attributes.insert("TEXCOORD_0".to_owned(), out.push_vec_f32(uv));
            }
            if let Some(colors) = &p.colors {
                attributes.insert("COLOR_0".to_owned(), out.push_vec_f32(colors));
            }
            let indices = if p.positions.len() <= boardui_geom::MAX_PRIMITIVE_VERTICES {
                let short: Vec<u16> = p.indices.iter().map(|&i| i as u16).collect();
                out.push_indices_u16(&short)
            } else {
                out.push_indices_u32(&p.indices)
            };
            primitives.push(Primitive {
                attributes,
                indices: Some(indices),
                material: p.material.map(|m| materials[m]),
                ..Primitive::default()
            });
        }
        push(
            &mut out.root.meshes,
            Mesh {
                name: Some(self.name.clone()),
                primitives,
            },
        )
    }
}

struct Reader<'a, L> {
    buffers: &'a [Vec<u8>],
    load: &'a mut L,
    materials: HashMap<usize, usize>,
    textures: HashMap<usize, usize>,
    images: HashMap<usize, usize>,
}

impl<L: FnMut(&str) -> Result<Vec<u8>, ModelError>> Reader<'_, L> {
    fn node(
        &mut self,
        model: &mut Model,
        node: &gltf::Node<'_>,
        parent: glam::Mat4,
    ) -> Result<(), ModelError> {
        let world = parent * glam::Mat4::from_cols_array_2d(&node.transform().matrix());
        if let Some(mesh) = node.mesh() {
            for primitive in mesh.primitives() {
                if primitive.mode() != Mode::Triangles {
                    model
                        .warnings
                        .push(format!("{:?} primitives are ignored", primitive.mode()));
                    continue;
                }
                let p = self.primitive(model, &primitive, world)?;
                if !p.indices.is_empty() {
                    model.primitives.push(p);
                }
            }
        }
        for child in node.children() {
            self.node(model, &child, world)?;
        }
        Ok(())
    }

    fn primitive(
        &mut self,
        model: &mut Model,
        primitive: &gltf::Primitive<'_>,
        world: glam::Mat4,
    ) -> Result<ModelPrimitive, ModelError> {
        let buffers = self.buffers;
        let reader = primitive.reader(|b| buffers.get(b.index()).map(Vec::as_slice));
        let Some(positions) = reader.read_positions() else {
            return Ok(ModelPrimitive::default());
        };
        let positions: Vec<[f32; 3]> = positions
            .map(|p| world.transform_point3(p.into()).into())
            .collect();
        let normal_matrix = glam::Mat3::from_mat4(world).inverse().transpose();
        let normals = reader.read_normals().map(|normals| {
            normals
                .map(|n| (normal_matrix * glam::Vec3::from(n)).normalize_or_zero().into())
                .collect()
        });
        let tex_coords = reader
            .read_tex_coords(0)
            .map(|t| t.into_f32().collect::<Vec<_>>());
        let colors = reader
            .read_colors(0)
            .map(|c| c.into_rgba_f32().collect::<Vec<_>>());
        let mut indices: Vec<u32> = match reader.read_indices() {
            Some(indices) => indices.into_u32().collect(),
            None => (0..positions.len() as u32).collect(),
        };
        indices.truncate(indices.len() / 3 * 3);
        if indices.iter().any(|&i| i as usize >= positions.len()) {
            return Err(ModelError(format!("{}: index out of range", model.name)));
        }
        if world.determinant() < 0.0 {
            for triangle in indices.chunks_exact_mut(3) {
                triangle.swap(1, 2);
            }
        }
        let material = match primitive.material().index() {
            Some(index) => Some(self.material(model, &primitive.material(), index)?),
            None => None,
        };
        Ok(ModelPrimitive {
            positions,
            normals,
            tex_coords,
            colors,
            indices,
            material,
        })
    }

    fn material(
        &mut self,
        model: &mut Model,
        material: &gltf::Material<'_>,
        index: usize,
    ) -> Result<usize, ModelError> {
        if let Some(&local) = self.materials.get(&index) {
            return Ok(local);
        }
        let pbr = material.pbr_metallic_roughness();
        let mut texture = |info: Option<gltf::texture::Texture<'_>>,
                           tex_coord: u32|
         -> Result<Option<TextureInfo>, ModelError> {
            let Some(texture) = info else { return Ok(None) };
            Ok(Some(TextureInfo {
                index: self.texture(model, &texture)? as u32,
                tex_coord: (tex_coord != 0).then_some(tex_coord),
                scale: None,
                strength: None,
            }))
        };
        let base_color_texture = match pbr.base_color_texture() {
            Some(info) => texture(Some(info.texture()), info.tex_coord())?,
            None => None,
        };
        let metallic_roughness_texture = match pbr.metallic_roughness_texture() {
            Some(info) => texture(Some(info.texture()), info.tex_coord())?,
            None => None,
        };
        let emissive_texture = match material.emissive_texture() {
            Some(info) => texture(Some(info.texture()), info.tex_coord())?,
            None => None,
        };
        let normal_texture = match material.normal_texture() {
            Some(info) => texture(Some(info.texture()), info.tex_coord())?.map(|mut t| {
                t.scale = Some(info.scale()).filter(|&s| s != 1.0);
                t
            }),
            None => None,
        };
        let occlusion_texture = match material.occlusion_texture() {
            Some(info) => texture(Some(info.texture()), info.tex_coord())?.map(|mut t| {
                t.strength = Some(info.strength()).filter(|&s| s != 1.0);
                t
            }),
            None => None,
        };
        let emissive = material.emissive_factor();
        let json = Material {
            name: material.name().map(str::to_owned),
            pbr_metallic_roughness: Some(PbrMetallicRoughness {
                base_color_factor: Some(pbr.base_color_factor()),
                base_color_texture,
                metallic_factor: Some(pbr.metallic_factor()),
                roughness_factor: Some(pbr.roughness_factor()),
                metallic_roughness_texture,
            }),
            normal_texture,
            occlusion_texture,
            emissive_texture,
            emissive_factor: (emissive != [0.0; 3]).then_some(emissive),
            alpha_mode: match material.alpha_mode() {
                gltf::material::AlphaMode::Opaque => None,
                gltf::material::AlphaMode::Mask => Some("MASK".into()),
                gltf::material::AlphaMode::Blend => Some("BLEND".into()),
            },
            alpha_cutoff: material
                .alpha_cutoff()
                .filter(|_| material.alpha_mode() == gltf::material::AlphaMode::Mask),
            double_sided: material.double_sided(),
        };
        let local = model.materials.len();
        model.materials.push(json);
        self.materials.insert(index, local);
        Ok(local)
    }

    fn texture(
        &mut self,
        model: &mut Model,
        texture: &gltf::texture::Texture<'_>,
    ) -> Result<usize, ModelError> {
        if let Some(&local) = self.textures.get(&texture.index()) {
            return Ok(local);
        }
        let image = self.image(model, &texture.source())?;
        let sampler = texture.sampler();
        let sampler = sampler.index().map(|_| Sampler {
            mag_filter: sampler.mag_filter().map(|f| f.as_gl_enum()),
            min_filter: sampler.min_filter().map(|f| f.as_gl_enum()),
            wrap_s: Some(sampler.wrap_s().as_gl_enum()),
            wrap_t: Some(sampler.wrap_t().as_gl_enum()),
        });
        let local = model.textures.len();
        model.textures.push(ModelTexture { image, sampler });
        self.textures.insert(texture.index(), local);
        Ok(local)
    }

    fn image(&mut self, model: &mut Model, image: &gltf::Image<'_>) -> Result<usize, ModelError> {
        if let Some(&local) = self.images.get(&image.index()) {
            return Ok(local);
        }
        let (bytes, mime_type) = match image.source() {
            gltf::image::Source::View { view, mime_type } => {
                let buffer = &self.buffers[view.buffer().index()];
                let bytes = buffer
                    .get(view.offset()..view.offset() + view.length())
                    .ok_or_else(|| ModelError("image view outside its buffer".into()))?;
                (bytes.to_vec(), mime_type.to_owned())
            }
            gltf::image::Source::Uri { uri, mime_type } => {
                let mime = mime_type.map(str::to_owned).unwrap_or_else(|| {
                    if uri.to_ascii_lowercase().ends_with(".png") || uri.contains("image/png") {
                        "image/png".into()
                    } else {
                        "image/jpeg".into()
                    }
                });
                ((self.load)(uri)?, mime)
            }
        };
        let local = model.images.len();
        model.images.push(ModelImage { bytes, mime_type });
        self.images.insert(image.index(), local);
        Ok(local)
    }
}
