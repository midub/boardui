//! Profile validation (spec §10).

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fmt;

use boardui_geom::{DVec2, GRID_STEP, Region};
use boardui_gltf::buffer::{read_u32s, read_vec3, view_bytes};
use boardui_gltf::json::{FLOAT, Root, UNSIGNED_SHORT};
use boardui_gltf::metadata::{NO_ROW, PropertyTable, SCHEMA_JSON};
use boardui_gltf::{
    Board, ComponentExtras, EXTENSIONS, FeatureKind, Fiducial, Mount, PROFILE_VERSION, Role, Side,
    encode_id_segment, glb, layer_id,
};

/// How bad an [`Issue`] is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    /// Breaks a MUST of the profile.
    Error,
    /// Breaks a SHOULD, or is suspicious.
    Warning,
}

/// A finding of [`validate`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issue {
    /// Error or warning.
    pub severity: Severity,
    /// What is wrong, and where.
    pub message: String,
}

impl fmt::Display for Issue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let level = match self.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        };
        write!(f, "{level}: {}", self.message)
    }
}

/// The result of [`validate`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Report {
    /// All findings.
    pub issues: Vec<Issue>,
}

impl Report {
    /// Whether no rule was broken (warnings are allowed).
    pub fn is_valid(&self) -> bool {
        !self.issues.iter().any(|i| i.severity == Severity::Error)
    }

    /// Number of errors.
    pub fn errors(&self) -> usize {
        self.issues
            .iter()
            .filter(|i| i.severity == Severity::Error)
            .count()
    }

    fn error(&mut self, message: impl Into<String>) {
        self.issues.push(Issue {
            severity: Severity::Error,
            message: message.into(),
        });
    }

    fn warn(&mut self, message: impl Into<String>) {
        self.issues.push(Issue {
            severity: Severity::Warning,
            message: message.into(),
        });
    }
}

/// Checks a GLB file against the rules of the boardui profile (spec §10):
///
/// - the extensions are declared as in §2;
/// - the scene structure follows §4, and IDs are unique and well-formed (§5);
/// - feature IDs are contiguous and ascending within primitives (§8.1);
/// - metadata references are in range, and component `extras` match the `components` table
///   (§8.2, §8.4);
/// - per copper layer, the sum of feature areas equals the area of their union, within
///   `δ · P` where `P` is the sum of the feature perimeters and `δ` is 20 nm plus twice the
///   float32 spacing at the largest coordinate (§6.2);
/// - prisms are closed (§6.1);
/// - layer Z ranges are ordered (§6.4).
///
/// The Khronos glTF validator is not part of this function; the CLI runs it separately.
pub fn validate(bytes: &[u8]) -> Report {
    let mut report = Report::default();
    let (root, bin) = match glb::read(bytes) {
        Ok(read) => read,
        Err(e) => {
            report.error(e.to_string());
            return report;
        }
    };
    Validator {
        root: &root,
        bin,
        report: &mut report,
    }
    .run();
    report
}

struct Validator<'a> {
    root: &'a Root,
    bin: &'a [u8],
    report: &'a mut Report,
}

/// A property table read back.
struct Table {
    count: usize,
    columns: HashMap<String, Column>,
}

enum Column {
    Strings(Vec<String>),
    Numbers(Vec<u32>),
    Floats(Vec<f64>),
}

impl Table {
    fn strings(&self, name: &str) -> Option<&[String]> {
        match self.columns.get(name)? {
            Column::Strings(s) => Some(s),
            _ => None,
        }
    }

    fn numbers(&self, name: &str) -> Option<&[u32]> {
        match self.columns.get(name)? {
            Column::Numbers(n) => Some(n),
            _ => None,
        }
    }

    fn floats(&self, name: &str) -> Option<&[f64]> {
        match self.columns.get(name)? {
            Column::Floats(f) => Some(f),
            _ => None,
        }
    }
}

impl Validator<'_> {
    fn run(&mut self) {
        let root = self.root;
        if root.asset.version != "2.0" {
            self.report.error(format!(
                "asset.version is {:?}, expected \"2.0\"",
                root.asset.version
            ));
        }
        for name in EXTENSIONS {
            if !root.extensions_used.iter().any(|e| e == name) {
                self.report
                    .error(format!("extensionsUsed does not list {name}"));
            }
            if root.extensions_required.iter().any(|e| e == name) {
                self.report
                    .error(format!("{name} must not be in extensionsRequired"));
            }
        }
        let Some(board) = self.board() else { return };
        let Some(tables) = self.tables() else { return };
        self.scene(&board);
        let nets = self.shared_table(&tables, board.tables.nets, "nets", "net");
        let components =
            self.shared_table(&tables, board.tables.components, "components", "component");
        let pins = self.shared_table(&tables, board.tables.pins, "pins", "pin");
        let instances = self.shared_table(&tables, board.tables.instances, "instances", "instance");
        let empty = Table {
            count: 0,
            columns: HashMap::new(),
        };
        let (Some(nets), Some(components), Some(pins), Some(instances)) =
            (nets, components, pins, instances)
        else {
            return;
        };
        let (nets, components, pins, instances) = (
            nets.unwrap_or(&empty),
            components.unwrap_or(&empty),
            pins.unwrap_or(&empty),
            instances.unwrap_or(&empty),
        );
        let scopes = self.instances(instances);
        self.nets(nets, &scopes);
        self.components(&board, components, &scopes);
        self.pins(pins, components, nets, &scopes);
        self.layers(&board, &tables, nets, components, pins, instances);
    }

    fn board(&mut self) -> Option<Board> {
        let Some(value) = &self.root.extensions.board else {
            self.report.error("the root has no BOARDUI_board extension");
            return None;
        };
        let board: Board = match serde_json::from_value(value.clone()) {
            Ok(board) => board,
            Err(e) => {
                self.report
                    .error(format!("BOARDUI_board does not match its schema: {e}"));
                return None;
            }
        };
        let (major, minor) = PROFILE_VERSION.split_once('.').expect("major.minor");
        match board.profile_version.split_once('.') {
            Some((m, n)) if m == major => {
                if n != minor {
                    self.report.warn(format!(
                        "profile version {} is not {PROFILE_VERSION}; checking as {PROFILE_VERSION}",
                        board.profile_version
                    ));
                }
            }
            _ => {
                self.report.error(format!(
                    "unsupported profile version {:?}",
                    board.profile_version
                ));
                return None;
            }
        }
        let sha = &board.source.sha256;
        if sha.len() != 64
            || !sha
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            self.report
                .error("BOARDUI_board.source.sha256 is not 64 lowercase hex digits");
        }
        for (what, value) in [
            ("tolerance", board.tolerance),
            ("platingThickness", board.plating_thickness),
            ("thickness", board.thickness),
        ] {
            if !(value.is_finite() && value > 0.0) {
                self.report
                    .error(format!("BOARDUI_board.{what} must be positive"));
            }
        }
        Some(board)
    }

    fn tables(&mut self) -> Option<Vec<Option<Table>>> {
        let Some(metadata) = &self.root.extensions.structural_metadata else {
            self.report
                .error("the root has no EXT_structural_metadata extension");
            return None;
        };
        let expected: serde_json::Value =
            serde_json::from_str(SCHEMA_JSON).expect("embedded schema");
        if metadata.schema.as_ref() != Some(&expected) {
            self.report
                .error("EXT_structural_metadata does not embed the profile's schema (spec §8.2)");
        }
        Some(
            metadata
                .property_tables
                .iter()
                .enumerate()
                .map(|(i, table)| self.read_table(i, table))
                .collect(),
        )
    }

    fn read_table(&mut self, index: usize, table: &PropertyTable) -> Option<Table> {
        let schema: serde_json::Value = serde_json::from_str(SCHEMA_JSON).expect("schema");
        let Some(class) = schema["classes"].get(&table.class) else {
            self.report.error(format!(
                "property table {index} has unknown class `{}`",
                table.class
            ));
            return None;
        };
        let count = table.count as usize;
        let mut columns = HashMap::new();
        for (name, property) in &table.properties {
            let Some(definition) = class["properties"].get(name) else {
                self.report.error(format!(
                    "property table {index} has unknown property `{name}`"
                ));
                continue;
            };
            let read = match definition["type"].as_str() {
                Some("STRING") => self.read_strings(property, count).map(Column::Strings),
                Some("ENUM") => view_bytes(self.root, self.bin, property.values).and_then(|b| {
                    b.get(..count)
                        .ok_or_else(|| "too few values".to_owned())
                        .map(|b| Column::Numbers(b.iter().map(|&v| u32::from(v)).collect()))
                }),
                _ if definition["componentType"] == "FLOAT64" => {
                    view_bytes(self.root, self.bin, property.values).and_then(|b| {
                        b.get(..count * 8)
                            .ok_or_else(|| "too few values".to_owned())
                            .map(|b| {
                                Column::Floats(
                                    b.as_chunks::<8>()
                                        .0
                                        .iter()
                                        .map(|&c| f64::from_le_bytes(c))
                                        .collect(),
                                )
                            })
                    })
                }
                _ => view_bytes(self.root, self.bin, property.values).and_then(|b| {
                    b.get(..count * 4)
                        .ok_or_else(|| "too few values".to_owned())
                        .map(|b| {
                            Column::Numbers(
                                b.as_chunks::<4>()
                                    .0
                                    .iter()
                                    .map(|&c| u32::from_le_bytes(c))
                                    .collect(),
                            )
                        })
                }),
            };
            match read {
                Ok(column) => {
                    columns.insert(name.clone(), column);
                }
                Err(e) => self
                    .report
                    .error(format!("property `{name}` of table {index}: {e}")),
            }
        }
        if let Some(props) = class["properties"].as_object() {
            for (name, definition) in props {
                if definition["required"] == true && !table.properties.contains_key(name) {
                    self.report.error(format!(
                        "property table {index} lacks required property `{name}`"
                    ));
                }
            }
        }
        Some(Table { count, columns })
    }

    fn read_strings(
        &self,
        property: &boardui_gltf::metadata::PropertyTableProperty,
        count: usize,
    ) -> Result<Vec<String>, String> {
        let values = view_bytes(self.root, self.bin, property.values)?;
        let offsets = view_bytes(
            self.root,
            self.bin,
            property.string_offsets.ok_or("no stringOffsets")?,
        )?;
        let width = match property.string_offset_type.as_deref().unwrap_or("UINT32") {
            "UINT8" => 1,
            "UINT16" => 2,
            "UINT32" => 4,
            other => return Err(format!("unsupported stringOffsetType {other}")),
        };
        if offsets.len() < (count + 1) * width {
            return Err("too few string offsets".into());
        }
        let offset = |i: usize| -> usize {
            let b = &offsets[i * width..(i + 1) * width];
            b.iter()
                .rev()
                .fold(0usize, |acc, &x| acc << 8 | usize::from(x))
        };
        (0..count)
            .map(|i| {
                let (a, b) = (offset(i), offset(i + 1));
                let bytes = values
                    .get(a..b)
                    .ok_or_else(|| format!("string {i} lies outside its buffer view"))?;
                String::from_utf8(bytes.to_vec()).map_err(|_| format!("string {i} is not UTF-8"))
            })
            .collect()
    }

    /// The shared table `what`: `Some(None)` when it is absent (no rows), `None` when it is
    /// broken.
    fn shared_table<'t>(
        &mut self,
        tables: &'t [Option<Table>],
        index: Option<u32>,
        what: &str,
        class: &str,
    ) -> Option<Option<&'t Table>> {
        let Some(index) = index else {
            return Some(None);
        };
        let metadata = self.root.extensions.structural_metadata.as_ref()?;
        match metadata.property_tables.get(index as usize) {
            Some(t) if t.class == class => tables[index as usize].as_ref().map(Some),
            Some(t) => {
                self.report.error(format!(
                    "BOARDUI_board.tables.{what} is table {index} of class `{}`, expected `{class}`",
                    t.class
                ));
                None
            }
            None => {
                self.report.error(format!(
                    "BOARDUI_board.tables.{what} ({index}) does not exist"
                ));
                None
            }
        }
    }

    fn scene(&mut self, board: &Board) {
        let root = self.root;
        let scene = root.scene.map_or(0, |s| s as usize);
        let Some(scene) = root.scenes.get(scene) else {
            self.report.error("the asset has no scene");
            return;
        };
        if root.scenes.len() != 1 {
            self.report.error("the asset must have exactly one scene");
        }
        let node = |i: u32| root.nodes.get(i as usize);
        let name = |i: u32| node(i).and_then(|n| n.name.as_deref());
        let [board_node] = scene.nodes[..] else {
            self.report
                .error("the scene must have exactly one root node");
            return;
        };
        if name(board_node) != Some("board") {
            self.report.error("the root node must be named `board`");
        }
        let Some(board_node) = node(board_node) else {
            self.report.error("the root node does not exist");
            return;
        };
        let groups: Vec<Option<&str>> = board_node.children.iter().map(|&c| name(c)).collect();
        if groups != [Some("layers"), Some("drills"), Some("components")] {
            self.report
                .error("the root node's children must be `layers`, `drills` and `components`");
            return;
        }
        let group = |k: usize| node(board_node.children[k]).expect("named, so it exists");

        let layer_nodes: Vec<u32> = board.layers.iter().map(|l| l.node).collect();
        if group(0).children != layer_nodes {
            self.report.error(
                "the children of `layers` must be the nodes of BOARDUI_board.layers, in order",
            );
        }
        let drill_nodes: Vec<u32> = board.drills.iter().map(|d| d.node).collect();
        if group(1).children != drill_nodes {
            self.report.error(
                "the children of `drills` must be the nodes of BOARDUI_board.drills, in order",
            );
        }
        let mut ids = HashSet::new();
        let entries = board
            .layers
            .iter()
            .map(|l| (&l.id, &l.name, l.node, l.synthesized))
            .chain(board.drills.iter().map(|d| (&d.id, &d.name, d.node, false)));
        for (id, layer_name, index, synthesized) in entries {
            if *id != layer_id(layer_name, synthesized) || !well_formed(id) {
                self.report.error(format!(
                    "layer ID `{id}` is not the encoded ID of layer `{layer_name}`"
                ));
            }
            if !ids.insert(id.clone()) {
                self.report.error(format!("layer ID `{id}` is not unique"));
            }
            match node(index) {
                Some(n) => {
                    if n.name.as_deref() != Some(id.as_str()) {
                        self.report
                            .error(format!("the node of `{id}` must be named `{id}`"));
                    }
                    if !n.is_identity() {
                        self.report.error(format!(
                            "the node of `{id}` must have an identity transform"
                        ));
                    }
                    if !n.children.is_empty() {
                        self.report
                            .error(format!("the node of `{id}` must not have children"));
                    }
                }
                None => self
                    .report
                    .error(format!("the node of `{id}` does not exist")),
            }
        }
        for drill in &board.drills {
            for end in [&drill.from, &drill.to] {
                let copper = board
                    .layers
                    .iter()
                    .any(|l| &l.id == end && l.role == Role::Copper);
                if !copper {
                    self.report.error(format!(
                        "drill `{}` spans to `{end}`, which is not a copper layer",
                        drill.id
                    ));
                }
            }
        }
        self.z_order(board);
    }

    fn z_order(&mut self, board: &Board) {
        let layers = &board.layers;
        for l in layers {
            if l.z_min.is_nan() || l.z_max.is_nan() || l.z_min >= l.z_max {
                self.report.error(format!("`{}` has zMin ≥ zMax", l.id));
            }
            if l.role == Role::Copper && l.side == Side::Internal {
                continue;
            }
        }
        let eps = 1e-9;
        for (i, upper) in layers.iter().enumerate() {
            for lower in &layers[i + 1..] {
                if upper.z_min + eps >= lower.z_max {
                    continue;
                }
                // The exceptions: soldermask overlaps the outer copper of its side, and paste
                // the soldermask and silkscreen of its side (spec §6.4, §6.11).
                let allowed = |a: &boardui_gltf::BoardLayer, b: &boardui_gltf::BoardLayer| {
                    a.side == b.side
                        && match a.role {
                            Role::Soldermask => b.role == Role::Copper,
                            Role::Paste => matches!(b.role, Role::Soldermask | Role::Silkscreen),
                            _ => false,
                        }
                };
                if allowed(upper, lower) || allowed(lower, upper) {
                    continue;
                }
                self.report.error(format!(
                    "Z ranges of `{}` and `{}` are out of order or overlap",
                    upper.id, lower.id
                ));
            }
        }
        let copper: Vec<_> = layers.iter().filter(|l| l.role == Role::Copper).collect();
        if let (Some(top), Some(bottom)) = (copper.first(), copper.last())
            && copper.len() > 1
            && ((top.z_max + bottom.z_min).abs() > 1e-9
                || (top.z_max - bottom.z_min - board.thickness).abs() > 1e-9)
        {
            self.report
                .warn("the outer copper surfaces are not at ±thickness/2 (spec §3, §8.3)");
        }
    }

    /// Checks the instances (spec §6.14) and returns the ID segment of each, with its
    /// trailing `/`.
    fn instances(&mut self, instances: &Table) -> Vec<String> {
        let empty = Vec::new();
        let ids = instances.strings("id").unwrap_or(&empty);
        let steps = instances.strings("step").unwrap_or(&empty);
        let parents = instances.numbers("parent");
        let sides = instances.numbers("side").unwrap_or(&[]);
        let placements = ["x", "y", "angle"].map(|c| instances.floats(c).unwrap_or(&[]));
        let mut scopes = Vec::with_capacity(instances.count);
        let mut seen = HashSet::new();
        for row in 0..instances.count.min(ids.len()) {
            let id = &ids[row];
            let segment = id.strip_prefix("inst/").filter(|s| !s.contains('/'));
            match segment {
                Some(segment) if well_formed(id) => scopes.push(format!("{segment}/")),
                _ => {
                    self.report
                        .error(format!("instance ID `{id}` is not well-formed"));
                    scopes.push(String::new());
                }
            }
            if !seen.insert(id) {
                self.report
                    .error(format!("instance ID `{id}` is not unique"));
            }
            if steps.get(row).is_none_or(String::is_empty) {
                self.report.error(format!("instance `{id}` has no step"));
            }
            if let Some(&parent) = parents.and_then(|p| p.get(row))
                && parent != NO_ROW
                && parent as usize >= row
            {
                self.report.error(format!(
                    "instance `{id}` has parent row {parent}, which doesn't precede it"
                ));
            }
            if !matches!(
                sides.get(row).and_then(|&s| Side::from_value(s as u8)),
                Some(Side::Top | Side::Bottom)
            ) {
                self.report
                    .error(format!("instance `{id}` must have side TOP or BOTTOM"));
            }
            if placements
                .iter()
                .any(|column| column.get(row).is_none_or(|v| !v.is_finite()))
            {
                self.report
                    .error(format!("instance `{id}` has no finite placement"));
            }
        }
        scopes
    }

    /// The ID segment of a row's instance, with its trailing `/`, or nothing.
    fn scope<'s>(
        &mut self,
        table: &Table,
        name: &str,
        row: usize,
        scopes: &'s [String],
    ) -> &'s str {
        match table.numbers("instance").map(|c| c[row]) {
            None | Some(NO_ROW) => "",
            Some(i) => match scopes.get(i as usize) {
                Some(scope) => scope,
                None => {
                    self.report.error(format!(
                        "row {row} of `{name}` references instance {i}, out of range"
                    ));
                    ""
                }
            },
        }
    }

    fn nets(&mut self, nets: &Table, scopes: &[String]) {
        let (Some(ids), Some(names)) = (nets.strings("id"), nets.strings("name")) else {
            return;
        };
        let mut seen = HashSet::new();
        for (row, (id, name)) in ids.iter().zip(names).enumerate() {
            let scope = self.scope(nets, "nets", row, scopes);
            if *id != format!("net/{scope}{}", encode_id_segment(name)) {
                self.report.error(format!(
                    "net ID `{id}` is not the encoded ID of net `{name}`"
                ));
            }
            if !seen.insert(id) {
                self.report.error(format!("net ID `{id}` is not unique"));
            }
        }
    }

    fn components(&mut self, board: &Board, components: &Table, scopes: &[String]) {
        let Some(group) = self.root.scenes.first().and_then(|_| {
            let board_node = self
                .root
                .nodes
                .iter()
                .position(|n| n.name.as_deref() == Some("board"))?;
            let index = *self.root.nodes[board_node].children.get(2)?;
            self.root.nodes.get(index as usize)
        }) else {
            return;
        };
        let _ = board;
        let empty = Vec::new();
        let ids = components.strings("id").unwrap_or(&empty);
        let ref_des = components.strings("refDes").unwrap_or(&empty);
        let parts = components.strings("part");
        let packages = components.strings("package");
        let sides = components.numbers("side").unwrap_or(&[]);
        let mounts = components.numbers("mount");
        let nodes = components.numbers("node").unwrap_or(&[]);
        let mut seen = HashSet::new();
        let mut node_rows = HashMap::new();
        for row in 0..components
            .count
            .min(ids.len())
            .min(ref_des.len())
            .min(nodes.len())
            .min(sides.len())
        {
            let id = &ids[row];
            let scope = self.scope(components, "components", row, scopes);
            if *id != format!("cmp/{scope}{}", encode_id_segment(&ref_des[row])) {
                self.report.error(format!(
                    "component ID `{id}` is not the encoded ID of `{}`",
                    ref_des[row]
                ));
            }
            if !seen.insert(id) {
                self.report
                    .error(format!("component ID `{id}` is not unique"));
            }
            let side = match Side::from_value(sides[row] as u8) {
                Some(side @ (Side::Top | Side::Bottom)) => side,
                _ => {
                    self.report
                        .error(format!("component `{id}` has side {}", sides[row]));
                    continue;
                }
            };
            let mount = mounts.map(|m| Mount::from_value(m[row] as u8));
            if mount == Some(None) {
                self.report
                    .error(format!("component `{id}` has an invalid mount"));
            }
            let node = nodes[row];
            if !group.children.contains(&node) {
                self.report.error(format!(
                    "component `{id}`: node {node} is not a child of `components`"
                ));
                continue;
            }
            node_rows.insert(node, row);
            let n = &self.root.nodes[node as usize];
            let name = format!("{}{}", decode_id_segment(scope), ref_des[row]);
            if n.name.as_deref() != Some(name.as_str()) {
                self.report.error(format!(
                    "the node of `{id}` must be named by its instance and refDes"
                ));
            }
            let extras: Option<ComponentExtras> = n
                .extras
                .as_ref()
                .and_then(|e| serde_json::from_value(e.clone()).ok());
            let Some(extras) = extras else {
                self.report.error(format!(
                    "the node of `{id}` has no valid extras.boardui (spec §8.4)"
                ));
                continue;
            };
            let info = extras.boardui;
            let text = |column: Option<&[String]>| {
                column.map(|c| c[row].clone()).filter(|s| !s.is_empty())
            };
            let instance =
                (!scope.is_empty()).then(|| format!("inst/{}", &scope[..scope.len() - 1]));
            let matches = info.id == *id
                && info.instance == instance
                && info.row as usize == row
                && info.ref_des == ref_des[row]
                && info.part == text(parts)
                && info.package == text(packages)
                && info.side == side
                && info.mount.unwrap_or(Mount::Other) == mount.flatten().unwrap_or(Mount::Other);
            if !matches {
                self.report.error(format!(
                    "extras.boardui of `{id}` do not match the components table"
                ));
            }
        }
        for &child in &group.children {
            if !node_rows.contains_key(&child) {
                self.report.error(format!(
                    "node {child} under `components` is not in the components table"
                ));
            }
        }
    }

    fn pins(&mut self, pins: &Table, components: &Table, nets: &Table, scopes: &[String]) {
        let empty = Vec::new();
        let ids = pins.strings("id").unwrap_or(&empty);
        let numbers = pins.strings("number").unwrap_or(&empty);
        let owners = pins.numbers("component").unwrap_or(&[]);
        let ref_des = components.strings("refDes").unwrap_or(&empty);
        let mut seen = HashSet::new();
        for row in 0..pins
            .count
            .min(ids.len())
            .min(numbers.len())
            .min(owners.len())
        {
            let id = &ids[row];
            let owner = owners[row] as usize;
            let Some(component) = ref_des.get(owner) else {
                self.report.error(format!(
                    "pin `{id}` references component row {owner}, out of range"
                ));
                continue;
            };
            let scope = self.scope(components, "components", owner, scopes);
            let expected = format!(
                "pin/{scope}{}/{}",
                encode_id_segment(component),
                encode_id_segment(&numbers[row])
            );
            if *id != expected {
                self.report
                    .error(format!("pin ID `{id}` should be `{expected}`"));
            }
            if !seen.insert(id) {
                self.report.error(format!("pin ID `{id}` is not unique"));
            }
        }
        self.references(pins, "pins", "net", nets.count);
    }

    /// Checks that a reference column holds rows of a table with `count` rows, or none.
    fn references(&mut self, table: &Table, name: &str, column: &str, count: usize) {
        if let Some(values) = table.numbers(column) {
            let bad = values
                .iter()
                .filter(|&&v| v != NO_ROW && v as usize >= count)
                .count();
            if bad > 0 {
                self.report.error(format!(
                    "{bad} rows of `{name}` have `{column}` out of range"
                ));
            }
        }
    }

    fn layers(
        &mut self,
        board: &Board,
        tables: &[Option<Table>],
        nets: &Table,
        components: &Table,
        pins: &Table,
        instances: &Table,
    ) {
        let metadata = self
            .root
            .extensions
            .structural_metadata
            .as_ref()
            .expect("checked");
        let entries = board
            .layers
            .iter()
            .map(|l| (l.id.as_str(), l.node, l.feature_table, Some(l)))
            .chain(
                board
                    .drills
                    .iter()
                    .map(|d| (d.id.as_str(), d.node, d.feature_table, None)),
            );
        let mut used_tables = HashSet::new();
        for (id, node, table_index, layer) in entries {
            let Some(table_index) = table_index else {
                // No features: no table and no geometry.
                if self
                    .root
                    .nodes
                    .get(node as usize)
                    .is_some_and(|n| n.mesh.is_some())
                {
                    self.report
                        .error(format!("`{id}` has a mesh but no feature table"));
                }
                continue;
            };
            let Some(Some(table)) = tables.get(table_index as usize) else {
                self.report.error(format!(
                    "`{id}`: feature table {table_index} does not exist"
                ));
                continue;
            };
            if !used_tables.insert(table_index) {
                self.report
                    .error(format!("`{id}`: feature table {table_index} is shared"));
            }
            let property_table = &metadata.property_tables[table_index as usize];
            if property_table.class != "feature" {
                self.report.error(format!(
                    "`{id}`: feature table has class `{}`",
                    property_table.class
                ));
                continue;
            }
            if let Some(kinds) = table.numbers("kind")
                && kinds
                    .iter()
                    .any(|&k| FeatureKind::from_value(k as u8).is_none())
            {
                self.report.error(format!("`{id}`: invalid feature kinds"));
            }
            if let Some(kinds) = table.numbers("kind") {
                // Fiducials, and only they, have a fiducial type (§8.2).
                let fiducials = table.numbers("fiducial");
                let wrong = (0..table.count).any(|row| {
                    let fiducial = fiducials.map_or(255, |f| f[row]);
                    let typed = fiducial != 255;
                    (typed && Fiducial::from_value(fiducial as u8).is_none())
                        || typed != (kinds[row] == u32::from(FeatureKind::Fiducial.value()))
                });
                if wrong {
                    self.report
                        .error(format!("`{id}`: invalid or missing fiducial types"));
                }
            }
            if let Some(sources) = table.numbers("source") {
                // Feature IDs (§5): the instance and the source.
                let instances = table.numbers("instance");
                let distinct: HashSet<_> = sources
                    .iter()
                    .enumerate()
                    .map(|(row, s)| (instances.map_or(NO_ROW, |i| i[row]), s))
                    .collect();
                if distinct.len() != sources.len() {
                    self.report
                        .error(format!("`{id}`: feature IDs are not unique"));
                }
            }
            self.references(table, id, "net", nets.count);
            self.references(table, id, "pin", pins.count);
            self.references(table, id, "component", components.count);
            self.references(table, id, "instance", instances.count);
            let Some(node) = self.root.nodes.get(node as usize) else {
                continue;
            };
            let Some(mesh) = node.mesh else { continue };
            let Some(mesh) = self.root.meshes.get(mesh as usize) else {
                self.report
                    .error(format!("`{id}`: mesh {mesh} does not exist"));
                continue;
            };
            let mut caps = Vec::new();
            let mut seen_features = HashSet::new();
            for (k, primitive) in mesh.primitives.iter().enumerate() {
                let what = format!("`{id}` primitive {k}");
                if let Some(cap) = self.primitive(
                    &what,
                    primitive,
                    table_index,
                    table.count,
                    layer,
                    &mut seen_features,
                ) {
                    caps.extend(cap);
                }
            }
            if let Some(layer) = layer
                && layer.role == Role::Copper
            {
                self.overlap(id, &caps);
            }
        }
    }

    /// Checks one primitive. Returns the top caps of its features when `layer` is copper.
    fn primitive(
        &mut self,
        what: &str,
        primitive: &boardui_gltf::json::Primitive,
        table_index: u32,
        rows: usize,
        layer: Option<&boardui_gltf::BoardLayer>,
        seen_features: &mut HashSet<u32>,
    ) -> Option<Vec<Cap>> {
        let features = primitive.extensions.mesh_features.as_ref();
        let Some(features) = features else {
            self.report
                .error(format!("{what} has no EXT_mesh_features"));
            return None;
        };
        let [set] = &features.feature_ids[..] else {
            self.report
                .error(format!("{what} must have exactly one featureIds entry"));
            return None;
        };
        if set.attribute != Some(0) || set.property_table != Some(table_index) {
            self.report.error(format!(
                "{what}: featureIds must use attribute 0 and the layer's feature table"
            ));
        }
        if set.null_feature_id.is_some() {
            self.report
                .error(format!("{what}: nullFeatureId must not be used"));
        }
        if primitive.mode.is_some_and(|m| m != 4) {
            self.report
                .error(format!("{what}: only triangles are allowed"));
            return None;
        }
        let (Some(&ids_accessor), Some(&positions), Some(indices)) = (
            primitive.attributes.get("_FEATURE_ID_0"),
            primitive.attributes.get("POSITION"),
            primitive.indices,
        ) else {
            self.report
                .error(format!("{what} needs POSITION, _FEATURE_ID_0 and indices"));
            return None;
        };
        let expected_type = if rows < 65_536 { UNSIGNED_SHORT } else { FLOAT };
        if self
            .root
            .accessors
            .get(ids_accessor as usize)
            .is_some_and(|a| a.component_type != expected_type)
        {
            self.report.error(format!(
                "{what}: _FEATURE_ID_0 must be {} for a table of {rows} rows",
                if expected_type == FLOAT {
                    "FLOAT"
                } else {
                    "UNSIGNED_SHORT"
                }
            ));
        }
        let read = (|| {
            Ok::<_, String>((
                read_u32s(self.root, self.bin, ids_accessor)?,
                read_vec3(self.root, self.bin, positions)?,
                read_u32s(self.root, self.bin, indices)?,
            ))
        })();
        let (ids, positions, indices) = match read {
            Ok(read) => read,
            Err(e) => {
                self.report.error(format!("{what}: {e}"));
                return None;
            }
        };
        if ids.len() != positions.len() {
            self.report.error(format!(
                "{what}: _FEATURE_ID_0 and POSITION differ in length"
            ));
            return None;
        }
        if positions.len() > 65_535 {
            let single = ids.first() == ids.last();
            if !single {
                self.report
                    .warn(format!("{what} has more than 65,535 vertices (spec §4)"));
            }
        }
        if indices.len() % 3 != 0 || indices.iter().any(|&i| i as usize >= positions.len()) {
            self.report.error(format!("{what}: indices are malformed"));
            return None;
        }
        if let Some(&id) = ids.iter().find(|&&id| id as usize >= rows) {
            self.report.error(format!(
                "{what}: feature ID {id} is not a row of the feature table"
            ));
            return None;
        }
        // Contiguity (spec §8.1).
        if ids.windows(2).any(|w| w[0] > w[1]) {
            self.report.error(format!(
                "{what}: feature IDs of vertices are not contiguous and ascending"
            ));
            return None;
        }
        let mut triangle_ids = Vec::with_capacity(indices.len() / 3);
        for t in indices.as_chunks::<3>().0 {
            let id = ids[t[0] as usize];
            if ids[t[1] as usize] != id || ids[t[2] as usize] != id {
                self.report
                    .error(format!("{what}: a triangle mixes features"));
                return None;
            }
            triangle_ids.push(id);
        }
        if triangle_ids.windows(2).any(|w| w[0] > w[1]) {
            self.report.error(format!(
                "{what}: feature IDs of triangles are not contiguous and ascending"
            ));
            return None;
        }
        let distinct: BTreeSet<u32> = ids.iter().copied().collect();
        if set.feature_count as usize != distinct.len() {
            self.report.error(format!(
                "{what}: featureCount is {}, but the primitive has {} features",
                set.feature_count,
                distinct.len()
            ));
        }
        let with_triangles: BTreeSet<u32> = triangle_ids.iter().copied().collect();
        if with_triangles != distinct {
            self.report.warn(format!(
                "{what}: some features have vertices but no triangles"
            ));
        }
        for &id in &distinct {
            if !seen_features.insert(id) {
                self.report.error(format!(
                    "{what}: feature {id} spans two primitives (spec §4)"
                ));
            }
        }
        if let Some(layer) = layer {
            let (lo, hi) = (layer.z_min as f32, layer.z_max as f32);
            if positions.iter().any(|p| p[1] < lo || p[1] > hi) {
                self.report
                    .error(format!("{what}: geometry lies outside the layer's Z range"));
            }
        }

        // Closed prisms (spec §6.1) and, for copper, top caps (spec §6.2).
        let copper_top = layer
            .filter(|l| l.role == Role::Copper)
            .map(|l| l.z_max as f32);
        let mut caps = Vec::new();
        let mut start = 0;
        let mut open = 0;
        while start < triangle_ids.len() {
            let id = triangle_ids[start];
            let end = start
                + triangle_ids[start..]
                    .iter()
                    .take_while(|&&t| t == id)
                    .count();
            let triangles = &indices[start * 3..end * 3];
            if !closed(triangles, &positions) {
                open += 1;
            }
            if let Some(top) = copper_top {
                caps.push(cap(id, triangles, &positions, top));
            }
            start = end;
        }
        if open > 0 {
            self.report
                .error(format!("{what}: {open} features are not closed prisms"));
        }
        copper_top.map(|_| caps)
    }

    /// Spec §6.2: features of a copper layer don't overlap.
    fn overlap(&mut self, id: &str, caps: &[Cap]) {
        let sum: f64 = caps.iter().map(|c| c.area).sum();
        let perimeter: f64 = caps.iter().map(|c| c.perimeter).sum();
        let max = caps
            .iter()
            .flat_map(|c| c.contours.iter().flatten())
            .fold(0.0f64, |m, p| m.max(p.x.abs()).max(p.y.abs()));
        let contours = caps
            .iter()
            .flat_map(|c| c.contours.iter().map(Vec::as_slice));
        let union = match Region::from_contours_nonzero(contours) {
            Ok(region) => region.area(),
            Err(e) => {
                self.report
                    .error(format!("`{id}`: cannot compute the copper union: {e}"));
                return;
            }
        };
        let delta = 2.0 * GRID_STEP + 2.0 * f32_spacing(max);
        let overlap = sum - union;
        if overlap > delta * perimeter {
            self.report.error(format!(
                "`{id}`: features overlap by {:.3e} m² (sum of areas {sum:.6e} m², union {union:.6e} m², allowed {:.3e} m²)",
                overlap,
                delta * perimeter
            ));
        }
    }
}

/// The spacing of float32 values near `x`.
fn f32_spacing(x: f64) -> f64 {
    let x = (x as f32).abs().max(f32::MIN_POSITIVE);
    f64::from(f32::from_bits(x.to_bits() + 1) - x)
}

/// An ID is well-formed if each segment after the prefix is percent-encoded (spec §5).
fn well_formed(id: &str) -> bool {
    let Some((prefix, rest)) = id.split_once('/') else {
        return false;
    };
    let rest = if prefix == "layer" {
        rest.strip_prefix('@').unwrap_or(rest)
    } else {
        rest
    };
    rest.split('/').all(|segment| {
        let mut chars = segment.chars();
        while let Some(c) = chars.next() {
            if c == '%' {
                let hex: String = chars.by_ref().take(2).collect();
                if hex.len() != 2 || !hex.chars().all(|h| h.is_ascii_hexdigit()) {
                    return false;
                }
            } else if matches!(c, '#' | '@') || c.is_whitespace() || c.is_control() {
                return false;
            }
        }
        !segment.is_empty()
    })
}

/// Decodes the `%XX` escapes of an ID segment (spec §5).
fn decode_id_segment(segment: &str) -> String {
    let bytes = segment.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes
            .get(i + 1..i + 3)
            .and_then(|h| std::str::from_utf8(h).ok());
        match hex
            .filter(|_| bytes[i] == b'%')
            .and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            Some(byte) => {
                out.push(byte);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Whether triangles form closed surfaces: every directed edge is matched by its reverse.
fn closed(triangles: &[u32], positions: &[[f32; 3]]) -> bool {
    let key = |i: u32| positions[i as usize].map(f32::to_bits);
    let mut edges: HashMap<([u32; 3], [u32; 3]), i32> = HashMap::with_capacity(triangles.len());
    for t in triangles.as_chunks::<3>().0 {
        for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            let (a, b) = (key(a), key(b));
            if a == b {
                continue;
            }
            if a < b {
                *edges.entry((a, b)).or_default() += 1;
            } else {
                *edges.entry((b, a)).or_default() -= 1;
            }
        }
    }
    edges.values().all(|&n| n == 0)
}

/// The top face of one copper feature, in board coordinates.
struct Cap {
    area: f64,
    perimeter: f64,
    contours: Vec<Vec<DVec2>>,
}

/// Extracts a feature's top cap: triangles at the layer top, facing up.
fn cap(_id: u32, triangles: &[u32], positions: &[[f32; 3]], top: f32) -> Cap {
    let board = |i: u32| {
        let p = positions[i as usize];
        DVec2::new(f64::from(p[0]), -f64::from(p[2]))
    };
    let mut area = 0.0;
    let mut directed: HashMap<(u32, u32), u32> = HashMap::new();
    let mut point_of: HashMap<u32, DVec2> = HashMap::new();
    for t in triangles.as_chunks::<3>().0 {
        if t.iter().any(|&i| positions[i as usize][1] != top) {
            continue;
        }
        let (a, b, c) = (board(t[0]), board(t[1]), board(t[2]));
        let twice = (b - a).perp_dot(c - a);
        if twice <= 0.0 {
            continue;
        }
        area += twice / 2.0;
        for (u, v) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            *directed.entry((u, v)).or_default() += 1;
            point_of.insert(u, board(u));
        }
    }
    // Boundary edges: no reverse edge within the cap.
    let mut next: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut perimeter = 0.0;
    for &(u, v) in directed.keys() {
        if !directed.contains_key(&(v, u)) {
            next.entry(u).or_default().push(v);
            perimeter += point_of[&u].distance(point_of[&v]);
        }
    }
    let mut contours = Vec::new();
    let mut starts: Vec<u32> = next.keys().copied().collect();
    starts.sort_unstable();
    for start in starts {
        while let Some(first) = next.get_mut(&start).and_then(Vec::pop) {
            let mut contour = vec![point_of[&start]];
            let mut at = first;
            let mut guard = 0;
            while at != start && guard <= directed.len() {
                contour.push(point_of[&at]);
                let Some(n) = next.get_mut(&at).and_then(Vec::pop) else {
                    break;
                };
                at = n;
                guard += 1;
            }
            contours.push(contour);
        }
    }
    Cap {
        area,
        perimeter,
        contours,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_checked_for_encoding() {
        assert!(well_formed("layer/TOP"));
        assert!(well_formed("layer/@core"));
        assert!(well_formed("net/A%2FB"));
        assert!(well_formed("feat/board-2/TOP/3"));
        assert_eq!(decode_id_segment("A%2FB%20%C3%A9-1"), "A/B é-1");
        assert_eq!(decode_id_segment("100%"), "100%");
        assert!(!well_formed("net/A B"));
        assert!(!well_formed("net/A%2"));
        assert!(!well_formed("layer/"));
        assert!(!well_formed("net/a@b"));
    }

    #[test]
    fn spacing_grows_with_magnitude() {
        assert!(f32_spacing(0.1) < 1e-8);
        assert!(f32_spacing(1.0) > 1e-7);
    }

    #[test]
    fn garbage_is_invalid() {
        let report = validate(b"definitely not a glb file");
        assert!(!report.is_valid());
        assert_eq!(report.errors(), 1);
    }

    /// A valid asset: the `minimal-2layer` sample.
    fn sample() -> (Root, Vec<u8>) {
        let xml =
            include_bytes!("../../../spec/samples/hand-written/minimal-2layer/minimal-2layer.xml");
        let glb = crate::convert(xml, &crate::Options::default()).unwrap().glb;
        let (root, bin) = glb::read(&glb).unwrap();
        (root, bin.to_vec())
    }

    fn check(root: &Root, bin: &[u8]) -> Vec<String> {
        let report = validate(&glb::write(root, bin));
        report
            .issues
            .iter()
            .filter(|i| i.severity == Severity::Error)
            .map(|i| i.message.clone())
            .collect()
    }

    fn assert_error(errors: &[String], needle: &str) {
        assert!(
            errors.iter().any(|e| e.contains(needle)),
            "expected an error containing {needle:?}, got {errors:#?}"
        );
    }

    fn board(root: &Root) -> Board {
        serde_json::from_value(root.extensions.board.clone().unwrap()).unwrap()
    }

    fn set_board(root: &mut Root, board: &Board) {
        root.extensions.board = Some(serde_json::to_value(board).unwrap());
    }

    /// The buffer view and byte offset of a primitive attribute or index accessor.
    fn accessor_bytes(root: &Root, accessor: u32) -> (usize, Option<u32>) {
        let a = &root.accessors[accessor as usize];
        let view = &root.buffer_views[a.buffer_view.unwrap() as usize];
        (view.byte_offset as usize, view.byte_stride)
    }

    #[test]
    fn the_sample_is_valid() {
        let (root, bin) = sample();
        assert_eq!(check(&root, &bin), Vec::<String>::new());
    }

    #[test]
    fn extensions_must_be_declared_but_not_required() {
        let (mut root, bin) = sample();
        root.extensions_used.retain(|e| e != "EXT_mesh_features");
        root.extensions_required.push("BOARDUI_board".into());
        let errors = check(&root, &bin);
        assert_error(&errors, "extensionsUsed does not list EXT_mesh_features");
        assert_error(&errors, "BOARDUI_board must not be in extensionsRequired");
    }

    #[test]
    fn scene_structure_is_checked() {
        let (mut root, bin) = sample();
        root.nodes[0].name = Some("pcb".into());
        let layer = board(&root).layers[2].node as usize;
        root.nodes[layer].translation = Some([0.0, 1.0, 0.0]);
        let errors = check(&root, &bin);
        assert_error(&errors, "root node must be named `board`");
        assert_error(&errors, "identity transform");
    }

    #[test]
    fn board_extension_follows_its_schema() {
        let (mut root, bin) = sample();
        let mut value = root.extensions.board.clone().unwrap();
        value["unexpected"] = serde_json::json!(1);
        root.extensions.board = Some(value);
        assert_error(&check(&root, &bin), "does not match its schema");
    }

    #[test]
    fn z_ranges_must_be_ordered() {
        let (mut root, bin) = sample();
        let mut b = board(&root);
        let core = b.layers.iter_mut().find(|l| l.name == "@core").unwrap();
        core.z_max = 1e-3;
        set_board(&mut root, &b);
        let errors = check(&root, &bin);
        assert_error(&errors, "out of order or overlap");
    }

    #[test]
    fn component_extras_must_match_the_table() {
        let (mut root, bin) = sample();
        let node = root
            .nodes
            .iter_mut()
            .find(|n| n.name.as_deref() == Some("R1"))
            .unwrap();
        node.extras.as_mut().unwrap()["boardui"]["part"] = serde_json::json!("other");
        assert_error(&check(&root, &bin), "do not match the components table");
    }

    #[test]
    fn references_must_be_in_range() {
        let (root, mut bin) = sample();
        let b = board(&root);
        let top = b.layers.iter().find(|l| l.name == "TOP").unwrap();
        let metadata = root.extensions.structural_metadata.as_ref().unwrap();
        let table = &metadata.property_tables[top.feature_table.unwrap() as usize];
        let view = &root.buffer_views[table.properties["net"].values as usize];
        let at = view.byte_offset as usize;
        bin[at..at + 4].copy_from_slice(&999u32.to_le_bytes());
        assert_error(&check(&root, &bin), "have `net` out of range");
    }

    #[test]
    fn fiducials_need_their_type() {
        let (root, mut bin) = sample();
        let b = board(&root);
        let top = b.layers.iter().find(|l| l.name == "TOP").unwrap();
        let metadata = root.extensions.structural_metadata.as_ref().unwrap();
        let table = &metadata.property_tables[top.feature_table.unwrap() as usize];
        assert!(!table.properties.contains_key("fiducial"));
        let view = &root.buffer_views[table.properties["kind"].values as usize];
        bin[view.byte_offset as usize] = FeatureKind::Fiducial.value();
        assert_error(&check(&root, &bin), "invalid or missing fiducial types");
    }

    #[test]
    fn feature_ids_must_be_contiguous() {
        let (root, mut bin) = sample();
        let b = board(&root);
        let top = b.layers.iter().find(|l| l.name == "TOP").unwrap();
        let mesh = root.nodes[top.node as usize].mesh.unwrap();
        let primitive = &root.meshes[mesh as usize].primitives[0];
        let (at, stride) = accessor_bytes(&root, primitive.attributes["_FEATURE_ID_0"]);
        assert_eq!(stride, Some(4));
        // Give the first vertex the last feature's ID.
        bin[at..at + 2].copy_from_slice(&3u16.to_le_bytes());
        let errors = check(&root, &bin);
        assert_error(&errors, "not contiguous and ascending");
    }

    #[test]
    fn prisms_must_be_closed() {
        let (root, mut bin) = sample();
        let b = board(&root);
        let top = b.layers.iter().find(|l| l.name == "TOP").unwrap();
        let mesh = root.nodes[top.node as usize].mesh.unwrap();
        let primitive = &root.meshes[mesh as usize].primitives[0];
        let (at, _) = accessor_bytes(&root, primitive.indices.unwrap());
        // Collapse the first triangle onto its first edge.
        let first = [bin[at], bin[at + 1]];
        bin[at + 4..at + 6].copy_from_slice(&first);
        assert_error(&check(&root, &bin), "not closed prisms");
    }

    #[test]
    fn overlapping_copper_is_reported() {
        use boardui_geom::{LayerMeshBuilder, Path, Shape};
        use boardui_gltf::{BoardAsset, FeatureRow, LayerAsset, ThicknessSource};
        let square = |x: f64| {
            Shape::Polygon {
                outline: Path::new(DVec2::new(x, 0.0))
                    .line_to(DVec2::new(x + 2e-3, 0.0))
                    .line_to(DVec2::new(x + 2e-3, 2e-3))
                    .line_to(DVec2::new(x, 2e-3)),
                holes: Vec::new(),
            }
            .to_region(boardui_geom::Tolerance::DEFAULT)
            .unwrap()
            .extrude(0.0, 35e-6)
            .unwrap()
        };
        let asset = |overlap: bool| {
            let mut mesh = LayerMeshBuilder::new();
            mesh.push(0, &square(0.0)).unwrap();
            mesh.push(1, &square(if overlap { 1e-3 } else { 2e-3 }))
                .unwrap();
            let row = |source| FeatureRow {
                kind: FeatureKind::Fill,
                source,
                net: None,
                pin: None,
                component: None,
                fiducial: None,
                instance: None,
            };
            BoardAsset {
                generator: "test".into(),
                source: boardui_gltf::Source {
                    format: "IPC-2581".into(),
                    revision: None,
                    step: None,
                    function_mode: None,
                    sha256: "0".repeat(64),
                },
                tolerance: 5e-6,
                plating_thickness: 25e-6,
                thickness: 35e-6,
                layers: vec![LayerAsset {
                    name: "TOP".into(),
                    role: Role::Copper,
                    ipc_function: Some("CONDUCTOR".into()),
                    side: Side::Top,
                    z_min: 0.0,
                    z_max: 35e-6,
                    thickness_source: ThicknessSource::Default,
                    synthesized: false,
                    visible: true,
                    color: None,
                    mesh: mesh.finish(),
                    features: vec![row(0), row(1)],
                }],
                drills: Vec::new(),
                nets: Vec::new(),
                components: Vec::new(),
                pins: Vec::new(),
                instances: Vec::new(),
                placeholders: Vec::new(),
                models: Vec::new(),
            }
            .to_glb()
        };
        assert!(validate(&asset(false)).is_valid());
        let report = validate(&asset(true));
        let errors: Vec<String> = report.issues.iter().map(|i| i.message.clone()).collect();
        assert_error(&errors, "features overlap by 2.000e-6 m²");
    }
}
