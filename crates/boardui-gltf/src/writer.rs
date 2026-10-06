//! Writing a board as a boardui asset (spec §4, §7, §8).

use std::collections::HashMap;

use boardui_geom::{Indices, LayerMesh, Prism};

use crate::board::{
    Board, BoardDrill, BoardLayer, ComponentExtras, ComponentInfo, FeatureKind, Mount,
    PROFILE_VERSION, Role, Side, Source, Tables, ThicknessSource,
};
use crate::buffer::{AssetBuilder, push};
use crate::json::{
    Asset, Material, Mesh, Node, PbrMetallicRoughness, Primitive, PrimitiveExtensions, Scene,
};
use crate::metadata::{
    FeatureIdSet, MeshFeatures, NO_ROW, PropertyTable, PropertyTableProperty, StructuralMetadata,
    schema,
};
use crate::model::Model;

/// Extension names a boardui asset lists in `extensionsUsed` (spec §2).
pub const EXTENSIONS: [&str; 3] = [
    "BOARDUI_board",
    "EXT_mesh_features",
    "EXT_structural_metadata",
];

/// The profile's materials (spec §7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BuiltinMaterial {
    /// `boardui/copper`: copper features and barrels.
    Copper,
    /// `boardui/soldermask`.
    Soldermask,
    /// `boardui/silkscreen`.
    Silkscreen,
    /// `boardui/dielectric`.
    Dielectric,
    /// `boardui/body`: placeholder bodies.
    Body,
    /// `boardui/pin1`: pin-1 markers.
    Pin1,
}

impl BuiltinMaterial {
    /// The material name.
    pub fn name(self) -> &'static str {
        match self {
            Self::Copper => "boardui/copper",
            Self::Soldermask => "boardui/soldermask",
            Self::Silkscreen => "boardui/silkscreen",
            Self::Dielectric => "boardui/dielectric",
            Self::Body => "boardui/body",
            Self::Pin1 => "boardui/pin1",
        }
    }

    /// The material for a layer role.
    pub fn for_role(role: Role) -> Self {
        match role {
            Role::Copper => Self::Copper,
            Role::Dielectric => Self::Dielectric,
            Role::Soldermask => Self::Soldermask,
            Role::Silkscreen => Self::Silkscreen,
        }
    }

    fn material(self) -> Material {
        // (sRGB colour, alpha, metallic, roughness)
        let (rgb, alpha, metallic, roughness) = match self {
            Self::Copper => (0xC9A15A, 1.0, 1.0, 0.35),
            Self::Soldermask => (0x1E6B2E, 0.85, 0.0, 0.4),
            Self::Silkscreen => (0xF2F2F2, 1.0, 0.0, 0.8),
            Self::Dielectric => (0xC7B98A, 1.0, 0.0, 0.9),
            Self::Body => (0x2B2B2B, 1.0, 0.0, 0.6),
            Self::Pin1 => (0xE0E0E0, 1.0, 0.0, 0.6),
        };
        let channel = |shift: u32| srgb_to_linear(((rgb >> shift) & 0xff) as u8);
        Material {
            name: Some(self.name().to_owned()),
            pbr_metallic_roughness: Some(PbrMetallicRoughness {
                base_color_factor: Some([channel(16), channel(8), channel(0), alpha]),
                metallic_factor: Some(metallic),
                roughness_factor: Some(roughness),
                ..PbrMetallicRoughness::default()
            }),
            alpha_mode: (alpha < 1.0).then(|| "BLEND".to_owned()),
            ..Material::default()
        }
    }
}

/// Converts an 8-bit sRGB channel to a linear factor, rounded to 4 decimals.
fn srgb_to_linear(channel: u8) -> f32 {
    let c = f64::from(channel) / 255.0;
    let linear = if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    };
    ((linear * 1e4).round() / 1e4) as f32
}

/// A node transform: translation, rotation quaternion `[x, y, z, w]` and scale.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Transform {
    /// Translation in metres.
    pub translation: [f64; 3],
    /// Rotation quaternion `[x, y, z, w]`.
    pub rotation: [f64; 4],
    /// Scale.
    pub scale: [f64; 3],
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            translation: [0.0; 3],
            rotation: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0; 3],
        }
    }
}

impl Transform {
    fn apply(&self, node: &mut Node) {
        let round = |v: f64| {
            // Keep the JSON readable: drop float noise below 1e-12.
            let r = (v * 1e12).round() / 1e12;
            if r == 0.0 { 0.0 } else { r }
        };
        if self.translation != [0.0; 3] {
            node.translation = Some(self.translation.map(round));
        }
        if self.rotation != [0.0, 0.0, 0.0, 1.0] {
            node.rotation = Some(self.rotation.map(round));
        }
        if self.scale != [1.0; 3] {
            node.scale = Some(self.scale.map(round));
        }
    }
}

/// A row of a layer's or drill's feature table (spec §8.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeatureRow {
    /// `kind`.
    pub kind: FeatureKind,
    /// `source`: document-order index of the feature within its layer (spec §5).
    pub source: u32,
    /// Row in the `nets` table.
    pub net: Option<u32>,
    /// Row in the `pins` table.
    pub pin: Option<u32>,
    /// Row in the `components` table.
    pub component: Option<u32>,
}

/// A layer of the board (spec §4, §8.3).
#[derive(Debug, Clone)]
pub struct LayerAsset {
    /// Layer name, without the `layer/` prefix and not percent-encoded.
    pub name: String,
    /// Role.
    pub role: Role,
    /// Source `layerFunction`; `None` for synthesized layers.
    pub ipc_function: Option<String>,
    /// Side.
    pub side: Side,
    /// Lower end of the Z range, in metres.
    pub z_min: f64,
    /// Upper end of the Z range, in metres.
    pub z_max: f64,
    /// Where the thickness came from.
    pub thickness_source: ThicknessSource,
    /// Whether the converter synthesized the layer.
    pub synthesized: bool,
    /// Suggested default visibility.
    pub visible: bool,
    /// Geometry; feature IDs are rows of `features`.
    pub mesh: LayerMesh,
    /// The feature table.
    pub features: Vec<FeatureRow>,
}

/// A drill layer: the barrels of one drill span (spec §6.3).
#[derive(Debug, Clone)]
pub struct DrillAsset {
    /// Drill layer name.
    pub name: String,
    /// Name of the span's upper copper layer.
    pub from: String,
    /// Name of the span's lower copper layer.
    pub to: String,
    /// Geometry; feature IDs are rows of `features`.
    pub mesh: LayerMesh,
    /// The feature table.
    pub features: Vec<FeatureRow>,
}

/// A placed component (spec §6.8).
#[derive(Debug, Clone)]
pub struct ComponentAsset {
    /// Reference designator.
    pub ref_des: String,
    /// Part name.
    pub part: Option<String>,
    /// Package name.
    pub package: Option<String>,
    /// Mounting side: [`Side::Top`] or [`Side::Bottom`].
    pub side: Side,
    /// Mount type.
    pub mount: Option<Mount>,
    /// Placement on the mounting plane.
    pub transform: Transform,
    /// The body, if any.
    pub body: Option<BodyRef>,
}

/// The body of a component.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BodyRef {
    /// A placeholder body from [`BoardAsset::placeholders`], meshed on the component node.
    Placeholder(usize),
    /// A user model from [`BoardAsset::models`], on a child node with the given transform.
    Model {
        /// Index into [`BoardAsset::models`].
        model: usize,
        /// Correction from the mapping file, applied in the component frame.
        transform: Transform,
    },
}

/// A placeholder body shared by all components with the same package and dimensions.
#[derive(Debug, Clone)]
pub struct PlaceholderBody {
    /// Mesh name, for example the package name.
    pub name: String,
    /// Parts of the body, each a closed prism in the component frame.
    pub parts: Vec<(BuiltinMaterial, Prism)>,
}

/// A component pin referenced by a feature (spec §8.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinRow {
    /// Pin number.
    pub number: String,
    /// Pin name.
    pub name: Option<String>,
    /// Row in the `components` table.
    pub component: u32,
    /// Row in the `nets` table.
    pub net: Option<u32>,
}

/// Everything that goes into a boardui asset.
#[derive(Debug, Clone)]
pub struct BoardAsset {
    /// `asset.generator`.
    pub generator: String,
    /// `BOARDUI_board.source`.
    pub source: Source,
    /// Arc tessellation tolerance, in metres.
    pub tolerance: f64,
    /// Barrel wall thickness, in metres.
    pub plating_thickness: f64,
    /// Copper-to-copper thickness, in metres.
    pub thickness: f64,
    /// Layers, top to bottom.
    pub layers: Vec<LayerAsset>,
    /// Drill layers.
    pub drills: Vec<DrillAsset>,
    /// Net names; the index is the row.
    pub nets: Vec<String>,
    /// Components; the index is the row.
    pub components: Vec<ComponentAsset>,
    /// Pins; the index is the row.
    pub pins: Vec<PinRow>,
    /// Shared placeholder bodies.
    pub placeholders: Vec<PlaceholderBody>,
    /// Shared user models.
    pub models: Vec<Model>,
}

/// Percent-encodes one segment of an element ID (spec §5): `%`, `/`, `#`, `@`, whitespace and
/// control characters become `%XX`.
pub fn encode_id_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for c in segment.chars() {
        if matches!(c, '%' | '/' | '#' | '@') || c.is_whitespace() || c.is_control() {
            let mut buf = [0; 4];
            for byte in c.encode_utf8(&mut buf).bytes() {
                out.push_str(&format!("%{byte:02X}"));
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// The ID of a layer: `layer/<name>`. Synthesized layers pass their name with the leading `@`,
/// which is kept unencoded.
pub fn layer_id(name: &str, synthesized: bool) -> String {
    match name.strip_prefix('@') {
        Some(rest) if synthesized => format!("layer/@{}", encode_id_segment(rest)),
        _ => format!("layer/{}", encode_id_segment(name)),
    }
}

impl BoardAsset {
    /// Writes the asset as GLB.
    pub fn to_glb(&self) -> Vec<u8> {
        Writer::default().write(self)
    }
}

#[derive(Default)]
struct Writer {
    out: AssetBuilder,
    materials: HashMap<BuiltinMaterial, u32>,
    tables: Vec<PropertyTable>,
}

impl Writer {
    fn write(mut self, asset: &BoardAsset) -> Vec<u8> {
        self.out.root.asset = Asset {
            version: "2.0".into(),
            generator: Some(asset.generator.clone()),
            min_version: None,
        };
        self.out.root.extensions_used = EXTENSIONS.map(str::to_owned).to_vec();

        // Fixed group nodes first, then components, layers and drills.
        let board = self.node(named("board"));
        let layers = self.node(named("layers"));
        let drills = self.node(named("drills"));
        let components = self.node(named("components"));
        self.out.root.nodes[board as usize].children = vec![layers, drills, components];
        self.out.root.scenes = vec![Scene {
            name: Some("board".into()),
            nodes: vec![board],
        }];
        self.out.root.scene = Some(0);
        let component_nodes = self.components(asset, components);
        let tables = Tables {
            nets: self.nets_table(asset),
            components: self.components_table(asset, &component_nodes),
            pins: self.pins_table(asset),
        };

        let mut board_layers = Vec::new();
        for layer in &asset.layers {
            let id = layer_id(&layer.name, layer.synthesized);
            let table = self.feature_table(&id, &layer.features);
            let material = self.material(BuiltinMaterial::for_role(layer.role));
            let node = self.layer_node(&id, &layer.mesh, material, table, layer.features.len());
            self.out.root.nodes[layers as usize].children.push(node);
            board_layers.push(BoardLayer {
                id,
                name: layer.name.clone(),
                role: layer.role,
                ipc_function: layer.ipc_function.clone(),
                side: layer.side,
                z_min: layer.z_min,
                z_max: layer.z_max,
                thickness_source: layer.thickness_source,
                synthesized: layer.synthesized,
                visible: layer.visible,
                node,
                feature_table: table,
            });
        }
        let mut board_drills = Vec::new();
        for drill in &asset.drills {
            let id = layer_id(&drill.name, false);
            let table = self.feature_table(&id, &drill.features);
            let material = self.material(BuiltinMaterial::Copper);
            let node = self.layer_node(&id, &drill.mesh, material, table, drill.features.len());
            self.out.root.nodes[drills as usize].children.push(node);
            board_drills.push(BoardDrill {
                id,
                name: drill.name.clone(),
                from: layer_id(&drill.from, false),
                to: layer_id(&drill.to, false),
                node,
                feature_table: table,
            });
        }

        let board = Board {
            profile_version: PROFILE_VERSION.into(),
            source: asset.source.clone(),
            tolerance: asset.tolerance,
            plating_thickness: asset.plating_thickness,
            thickness: asset.thickness,
            layers: board_layers,
            drills: board_drills,
            tables,
            extensions: None,
            extras: None,
        };
        let extensions = &mut self.out.root.extensions;
        extensions.board = Some(serde_json::to_value(board).expect("BOARDUI_board serializes"));
        extensions.structural_metadata = Some(StructuralMetadata {
            schema: Some(schema()),
            schema_uri: None,
            property_tables: self.tables,
        });
        self.out.into_glb()
    }

    fn node(&mut self, node: Node) -> u32 {
        push(&mut self.out.root.nodes, node)
    }

    fn material(&mut self, builtin: BuiltinMaterial) -> u32 {
        if let Some(&index) = self.materials.get(&builtin) {
            return index;
        }
        let index = push(&mut self.out.root.materials, builtin.material());
        self.materials.insert(builtin, index);
        index
    }

    /// A layer or drill node with its mesh. Layers without geometry get no mesh.
    fn layer_node(
        &mut self,
        id: &str,
        mesh: &LayerMesh,
        material: u32,
        table: u32,
        rows: usize,
    ) -> u32 {
        let float_ids = rows > usize::from(u16::MAX);
        let mut primitives = Vec::new();
        for primitive in &mesh.primitives {
            let position = self.out.push_vec3(&primitive.positions, true);
            let feature_ids = self.out.push_feature_ids(&primitive.feature_ids, float_ids);
            let indices = match &primitive.indices {
                Indices::U16(indices) => self.out.push_indices_u16(indices),
                Indices::U32(indices) => self.out.push_indices_u32(indices),
            };
            primitives.push(Primitive {
                attributes: [
                    ("POSITION".into(), position),
                    ("_FEATURE_ID_0".into(), feature_ids),
                ]
                .into(),
                indices: Some(indices),
                material: Some(material),
                mode: None,
                extensions: PrimitiveExtensions {
                    mesh_features: Some(MeshFeatures {
                        feature_ids: vec![FeatureIdSet {
                            feature_count: primitive.features.len() as u32,
                            attribute: Some(0),
                            property_table: Some(table),
                            ..FeatureIdSet::default()
                        }],
                    }),
                    ..PrimitiveExtensions::default()
                },
            });
        }
        let mesh = (!primitives.is_empty()).then(|| {
            push(
                &mut self.out.root.meshes,
                Mesh {
                    name: Some(id.to_owned()),
                    primitives,
                },
            )
        });
        self.node(Node { mesh, ..named(id) })
    }

    fn components(&mut self, asset: &BoardAsset, group: u32) -> Vec<u32> {
        let mut placeholder_meshes: HashMap<usize, u32> = HashMap::new();
        let mut model_meshes: HashMap<usize, u32> = HashMap::new();
        let mut nodes = Vec::with_capacity(asset.components.len());
        for (row, component) in asset.components.iter().enumerate() {
            let info = ComponentInfo {
                id: format!("cmp/{}", encode_id_segment(&component.ref_des)),
                row: row as u32,
                ref_des: component.ref_des.clone(),
                part: component.part.clone(),
                package: component.package.clone(),
                side: component.side,
                mount: component.mount,
            };
            let mut node = Node {
                extras: Some(
                    serde_json::to_value(ComponentExtras { boardui: info })
                        .expect("extras serialize"),
                ),
                ..named(&component.ref_des)
            };
            component.transform.apply(&mut node);
            match component.body {
                Some(BodyRef::Placeholder(index)) => {
                    let mesh = match placeholder_meshes.get(&index) {
                        Some(&mesh) => mesh,
                        None => {
                            let mesh = self.placeholder_mesh(&asset.placeholders[index]);
                            placeholder_meshes.insert(index, mesh);
                            mesh
                        }
                    };
                    node.mesh = Some(mesh);
                }
                Some(BodyRef::Model { model, transform }) => {
                    let mesh = match model_meshes.get(&model) {
                        Some(&mesh) => mesh,
                        None => {
                            let mesh = asset.models[model].write(&mut self.out);
                            model_meshes.insert(model, mesh);
                            mesh
                        }
                    };
                    let mut child = Node {
                        mesh: Some(mesh),
                        ..named(&asset.models[model].name)
                    };
                    transform.apply(&mut child);
                    node.children.push(self.node(child));
                }
                None => {}
            }
            let index = self.node(node);
            self.out.root.nodes[group as usize].children.push(index);
            nodes.push(index);
        }
        nodes
    }

    fn placeholder_mesh(&mut self, body: &PlaceholderBody) -> u32 {
        let mut primitives = Vec::new();
        for (material, prism) in &body.parts {
            if prism.is_empty() {
                continue;
            }
            let material = self.material(*material);
            let position = self.out.push_vec3(prism.positions(), true);
            let indices = if prism.positions().len() <= boardui_geom::MAX_PRIMITIVE_VERTICES {
                let short: Vec<u16> = prism.indices().iter().map(|&i| i as u16).collect();
                self.out.push_indices_u16(&short)
            } else {
                self.out.push_indices_u32(prism.indices())
            };
            primitives.push(Primitive {
                attributes: [("POSITION".into(), position)].into(),
                indices: Some(indices),
                material: Some(material),
                ..Primitive::default()
            });
        }
        if primitives.is_empty() {
            // glTF meshes need a primitive; a body without geometry is a degenerate input.
            let position = self.out.push_vec3(&[[0.0; 3]; 3], true);
            primitives.push(Primitive {
                attributes: [("POSITION".into(), position)].into(),
                ..Primitive::default()
            });
        }
        push(
            &mut self.out.root.meshes,
            Mesh {
                name: Some(body.name.clone()),
                primitives,
            },
        )
    }

    fn table(&mut self, name: &str, class: &str, count: usize, columns: Vec<Column>) -> u32 {
        let mut properties = std::collections::BTreeMap::new();
        for column in columns {
            let (name, property) = column.write(&mut self.out);
            properties.insert(name, property);
        }
        push(
            &mut self.tables,
            PropertyTable {
                name: Some(name.to_owned()),
                class: class.to_owned(),
                count: count as u32,
                properties,
            },
        )
    }

    fn nets_table(&mut self, asset: &BoardAsset) -> u32 {
        let ids = asset
            .nets
            .iter()
            .map(|n| format!("net/{}", encode_id_segment(n)))
            .collect();
        self.table(
            "nets",
            "net",
            asset.nets.len(),
            vec![
                Column::Strings("id", ids),
                Column::Strings("name", asset.nets.clone()),
            ],
        )
    }

    fn components_table(&mut self, asset: &BoardAsset, nodes: &[u32]) -> u32 {
        let components = &asset.components;
        let columns = vec![
            Column::Strings(
                "id",
                components
                    .iter()
                    .map(|c| format!("cmp/{}", encode_id_segment(&c.ref_des)))
                    .collect(),
            ),
            Column::Strings(
                "refDes",
                components.iter().map(|c| c.ref_des.clone()).collect(),
            ),
            Column::Strings(
                "part",
                components
                    .iter()
                    .map(|c| c.part.clone().unwrap_or_default())
                    .collect(),
            ),
            Column::Strings(
                "package",
                components
                    .iter()
                    .map(|c| c.package.clone().unwrap_or_default())
                    .collect(),
            ),
            Column::U8("side", components.iter().map(|c| c.side.value()).collect()),
            Column::U8(
                "mount",
                components
                    .iter()
                    .map(|c| c.mount.unwrap_or(Mount::Other).value())
                    .collect(),
            ),
            Column::U32("node", nodes.to_vec()),
        ];
        self.table("components", "component", components.len(), columns)
    }

    fn pins_table(&mut self, asset: &BoardAsset) -> u32 {
        let pins = &asset.pins;
        let ids = pins
            .iter()
            .map(|p| {
                let component = &asset.components[p.component as usize].ref_des;
                format!(
                    "pin/{}/{}",
                    encode_id_segment(component),
                    encode_id_segment(&p.number)
                )
            })
            .collect();
        let mut columns = vec![
            Column::Strings("id", ids),
            Column::Strings("number", pins.iter().map(|p| p.number.clone()).collect()),
            Column::U32("component", pins.iter().map(|p| p.component).collect()),
        ];
        if pins.iter().any(|p| p.name.is_some()) {
            columns.push(Column::Strings(
                "name",
                pins.iter()
                    .map(|p| p.name.clone().unwrap_or_default())
                    .collect(),
            ));
        }
        if pins.iter().any(|p| p.net.is_some()) {
            columns.push(Column::U32(
                "net",
                pins.iter().map(|p| p.net.unwrap_or(NO_ROW)).collect(),
            ));
        }
        self.table("pins", "pin", pins.len(), columns)
    }

    fn feature_table(&mut self, id: &str, rows: &[FeatureRow]) -> u32 {
        let mut columns = vec![
            Column::U8("kind", rows.iter().map(|r| r.kind.value()).collect()),
            Column::U32("source", rows.iter().map(|r| r.source).collect()),
        ];
        for (name, get) in [
            (
                "net",
                (|r: &FeatureRow| r.net) as fn(&FeatureRow) -> Option<u32>,
            ),
            ("pin", |r| r.pin),
            ("component", |r| r.component),
        ] {
            if rows.iter().any(|r| get(r).is_some()) {
                columns.push(Column::U32(
                    name,
                    rows.iter().map(|r| get(r).unwrap_or(NO_ROW)).collect(),
                ));
            }
        }
        self.table(id, "feature", rows.len(), columns)
    }
}

fn named(name: &str) -> Node {
    Node {
        name: Some(name.to_owned()),
        ..Node::default()
    }
}

/// A property table column.
enum Column {
    Strings(&'static str, Vec<String>),
    U8(&'static str, Vec<u8>),
    U32(&'static str, Vec<u32>),
}

impl Column {
    fn write(self, out: &mut AssetBuilder) -> (String, PropertyTableProperty) {
        match self {
            Self::Strings(name, values) => {
                let mut bytes = Vec::new();
                let mut offsets = Vec::with_capacity((values.len() + 1) * 4);
                for value in &values {
                    offsets.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                    bytes.extend_from_slice(value.as_bytes());
                }
                offsets.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                let values = out.push_view(&bytes, None, None);
                let string_offsets = out.push_view(&offsets, None, None);
                (
                    name.to_owned(),
                    PropertyTableProperty {
                        values,
                        string_offsets: Some(string_offsets),
                        string_offset_type: Some("UINT32".into()),
                        array_offsets: None,
                    },
                )
            }
            Self::U8(name, values) => (name.to_owned(), plain(out, &values)),
            Self::U32(name, values) => {
                let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
                (name.to_owned(), plain(out, &bytes))
            }
        }
    }
}

fn plain(out: &mut AssetBuilder, bytes: &[u8]) -> PropertyTableProperty {
    PropertyTableProperty {
        values: out.push_view(bytes, None, None),
        ..PropertyTableProperty::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_percent_encoded() {
        assert_eq!(encode_id_segment("GND"), "GND");
        assert_eq!(encode_id_segment("A/B #1@x%"), "A%2FB%20%231%40x%25");
        assert_eq!(encode_id_segment("Ω\t"), "Ω%09");
        assert_eq!(layer_id("@core", true), "layer/@core");
        assert_eq!(layer_id("@core", false), "layer/%40core");
    }

    #[test]
    fn materials_are_linear() {
        assert_eq!(srgb_to_linear(255), 1.0);
        assert_eq!(srgb_to_linear(0), 0.0);
        let m = BuiltinMaterial::Soldermask.material();
        assert_eq!(m.alpha_mode.as_deref(), Some("BLEND"));
    }
}
