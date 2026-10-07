//! Conformance suite (`spec/samples/README.md`): converts every sample in `spec/samples`,
//! checks the result with [`validate`], and compares a summary with the expected output in
//! `spec/samples/expected/`.
//!
//! - `INSTA_UPDATE=always cargo test -p boardui-convert --test conformance` rewrites the
//!   expected summaries; `BOARDUI_BLESS=1` also rewrites the expected GLBs of the
//!   hand-written samples.
//! - `BOARDUI_CONFORMANCE_OUT=<dir>` writes every converted GLB to `<dir>` (relative to the
//!   workspace root), for the Khronos validator step in CI.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use boardui_convert::{Conversion, ModelLibrary, Options, convert, validate};
use boardui_gltf::buffer::{read_u32s, read_vec3, view_bytes};
use boardui_gltf::metadata::NO_ROW;
use boardui_gltf::{Board, FeatureKind, Fiducial, Root, Side, glb};

fn samples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spec/samples")
}

/// Every `.xml` or `.cvg` sample under `spec/samples`, by name.
fn samples() -> Vec<(String, PathBuf)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).expect("samples directory") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "xml" || e == "cvg") {
                out.push(path);
            }
        }
    }
    let mut paths = Vec::new();
    walk(&samples_dir(), &mut paths);
    paths.sort();
    paths
        .into_iter()
        .map(|p| {
            let name = p.file_stem().expect("stem").to_string_lossy().into_owned();
            (name, p)
        })
        .collect()
}

/// Samples whose source puts some component pins off their pads, with the number of such
/// pins: KiCad 9 writes a rotation 180° off for the bottom-side footprints at 0° or 180° of a
/// KiCad 5 board (`spec/samples/kicad-fomu-pvt/README.md`).
const KNOWN_MISPLACED_PINS: &[(&str, usize)] = &[("fomu-pvt", 74)];

fn run(path: &Path) -> Conversion {
    let xml = std::fs::read(path).expect("sample");
    let mapping = path.with_file_name("models.json");
    let options = Options {
        models: mapping
            .exists()
            .then(|| ModelLibrary::load(&mapping).expect("model mapping")),
        generator: "boardui (conformance)".into(),
        ..Options::default()
    };
    convert(&xml, &options).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn check(name: &str, path: &Path) {
    let conversion = run(path);
    let report = validate(&conversion.glb);
    let issues: Vec<String> = report.issues.iter().map(ToString::to_string).collect();
    assert!(report.issues.is_empty(), "{name}: {issues:#?}");
    assert_eq!(
        conversion.stats.pins_misplaced,
        KNOWN_MISPLACED_PINS
            .iter()
            .find(|(n, _)| *n == name)
            .map_or(0, |&(_, pins)| pins),
        "{name}: component pins are not on their pads"
    );
    if let Ok(dir) = std::env::var("BOARDUI_CONFORMANCE_OUT") {
        // Relative to the workspace root, not to this crate.
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(dir);
        std::fs::create_dir_all(&dir).expect("output directory");
        std::fs::write(dir.join(format!("{name}.glb")), &conversion.glb).expect("write GLB");
    }
    let hand_written = path.starts_with(samples_dir().join("hand-written"));
    if hand_written {
        let expected = path.with_extension("glb");
        if std::env::var_os("BOARDUI_BLESS").is_some() {
            std::fs::write(&expected, &conversion.glb).expect("write expected GLB");
        }
        let expected = std::fs::read(&expected)
            .unwrap_or_else(|_| panic!("{name}: no expected GLB (run with BOARDUI_BLESS=1)"));
        let json = |bytes: &[u8]| {
            let (root, _) = glb::read(bytes).expect("GLB");
            serde_json::to_value(root).expect("JSON")
        };
        assert_eq!(
            json(&conversion.glb),
            json(&expected),
            "{name}: the glTF JSON differs from the expected GLB (rerun with BOARDUI_BLESS=1 if intended)"
        );
    }
    let summary = summary(&conversion, hand_written);
    insta::with_settings!({
        snapshot_path => samples_dir().join("expected"),
        prepend_module_to_snapshot => false,
        omit_expression => true,
    }, {
        insta::assert_snapshot!(name.to_owned(), summary);
    });
}

macro_rules! samples {
    ($($test:ident => $name:literal),* $(,)?) => {
        $(
            #[test]
            fn $test() {
                let (_, path) = samples()
                    .into_iter()
                    .find(|(n, _)| n == $name)
                    .expect(concat!("sample ", $name));
                check($name, &path);
            }
        )*

        /// Every sample in `spec/samples` has a test above.
        #[test]
        fn all_samples_are_tested() {
            let tested = [$($name),*];
            for (name, _) in samples() {
                assert!(tested.contains(&name.as_str()), "sample {name} has no test");
            }
        }
    };
}

samples! {
    minimal_2layer => "minimal-2layer",
    units_inch => "units-inch",
    units_micron => "units-micron",
    overlap_priority => "overlap-priority",
    negative_polarity => "negative-polarity",
    zero_width_lines => "zero-width-lines",
    fiducials => "fiducials",
    hexagon_moire => "hexagon-moire",
    primitive_xform => "primitive-xform",
    hatch_fill => "hatch-fill",
    line_styles => "line-styles",
    slots => "slots",
    bottom_placement => "bottom-placement",
    paste_layer => "paste-layer",
    drawing_layers => "drawing-layers",
    assembly_drawing => "assembly-drawing",
    package_silkscreen => "package-silkscreen",
    user_models => "user-models",
    colours => "colours",
    panel => "panel",
    text => "text",
    testcase1 => "testcase1-RevC-Assembly",
    testcase3 => "testcase3-RevC-Assembly",
    testcase10 => "testcase10-RevC-Assembly",
    testcase11 => "testcase11-rdgflx-RevC-full",
    polar_speedstack => "IPC-2581-8-Layer-Design",
    kicad_royalblue54l_feather => "royalblue54l-feather",
    kicad_fomu_pvt => "fomu-pvt",
    kicad_miao => "miao",
    kicad_kikit_panel => "egg-ldo-panel",
    kicad_blind_buried_vias => "blind-buried-vias",
    kicad10_antenna => "antenna",
    altium_ldo_pcb => "LDO-PCB",
}

/// Spec §5, §6.14: an instance's IDs are those of its step converted alone, with the
/// instance segment; a flipped instance has its features on the counterpart layers. An
/// instance's features keep their `text`, and a text's top face is the one of the step alone
/// under the instance's placement: a flipped copy's text is turned over with the board, so
/// it reads correctly from its new side.
#[test]
fn panel_instances_keep_their_steps_ids() {
    let path = samples_dir().join("hand-written/panel/panel.xml");
    let xml = std::fs::read(&path).expect("sample");
    let convert_step = |step: Option<&str>| {
        let options = Options {
            step: step.map(str::to_owned),
            ..Options::default()
        };
        convert(&xml, &options).expect("conversion").glb
    };
    let (panel, frames) = elements(&convert_step(None));
    let (mut alone, _) = elements(&convert_step(Some("board")));
    // The sheets are the panel's.
    alone.retain(|id, _| !id.contains("/@core/") && !id.contains("/@soldermask-"));
    /// An ID in an instance: board-6 is flipped, so its features are on the counterpart
    /// layers.
    fn scoped(id: &str, instance: &str) -> String {
        let (kind, rest) = id.split_once('/').expect("ID");
        let rest = match rest.split_once('/') {
            Some((layer, n)) if kind == "feat" && instance == "board-6" => {
                let layer = match layer {
                    "TOP" => "BOTTOM",
                    "BOTTOM" => "TOP",
                    "TOP_SILK" => "BOT_SILK",
                    "BOT_SILK" => "TOP_SILK",
                    "TOP_PASTE" => "BOT_PASTE",
                    "BOT_PASTE" => "TOP_PASTE",
                    "@assembly-top" => "@assembly-bottom",
                    "@assembly-bottom" => "@assembly-top",
                    other => other,
                };
                format!("{layer}/{n}")
            }
            _ => rest.to_owned(),
        };
        format!("{kind}/{instance}/{rest}")
    }
    let mut texts = 0;
    for (id, (text, face)) in &alone {
        for instance in ["board-1", "board-5", "board-6"] {
            let scoped = scoped(id, instance);
            let Some((copy_text, copy_face)) = panel.get(&scoped) else {
                panic!("{scoped} is missing");
            };
            assert_eq!(copy_text, text, "{scoped}");
            if text.is_empty() {
                continue;
            }
            let (Some(face), Some(copy)) = (face, copy_face) else {
                panic!("{id} or {scoped} draws nothing");
            };
            let (x, y, angle, flipped) = frames[instance];
            let (sin, cos) = angle.to_radians().sin_cos();
            let place = |[u, v]: [f64; 2]| {
                let u = if flipped { -u } else { u };
                [x + cos * u - sin * v, y + sin * u + cos * v]
            };
            let corners = [
                [face.min[0], face.min[1]],
                [face.min[0], face.max[1]],
                [face.max[0], face.min[1]],
                [face.max[0], face.max[1]],
            ]
            .map(place);
            let min = corners
                .iter()
                .fold([f64::INFINITY; 2], |m, c| [m[0].min(c[0]), m[1].min(c[1])]);
            let max = corners.iter().fold([f64::NEG_INFINITY; 2], |m, c| {
                [m[0].max(c[0]), m[1].max(c[1])]
            });
            // Arcs are flattened after placement, within the tolerance.
            let tolerance = Options::default().tolerance;
            let close = |a: [f64; 2], b: [f64; 2]| (0..2).all(|k| (a[k] - b[k]).abs() <= tolerance);
            assert!(
                (copy.area - face.area).abs() <= 1e-4 * face.area,
                "{scoped}: area {} vs {}",
                copy.area,
                face.area
            );
            assert!(
                close(copy.min, min) && close(copy.max, max),
                "{scoped}: bounds {:?}..{:?} vs {min:?}..{max:?}",
                copy.min,
                copy.max
            );
            // The centroid tells a turned-over text from a mirror-reversed one in its box.
            assert!(
                close(copy.centroid, place(face.centroid)),
                "{scoped}: centroid {:?} vs {:?}",
                copy.centroid,
                place(face.centroid)
            );
        }
        texts += usize::from(!text.is_empty());
    }
    // The silkscreen `REV A` and the `1` of R1's and C1's assembly drawings.
    assert_eq!(texts, 3, "texts of the board alone");
    let count = |instance: &str| panel.keys().filter(|id| id.contains(instance)).count();
    assert_eq!(count("/board-6/"), count("/board-1/"));
    assert!(panel.contains_key("net/board-6/GND"));
    assert!(
        panel.contains_key("feat/TOP/0"),
        "the panel's own IDs have no instance"
    );
}

/// Spec §6.14: a layer without a counterpart is reported once per step, however many flipped
/// copies of the step the panel has.
#[test]
fn unpaired_layers_are_reported_once_per_step() {
    let xml = std::fs::read_to_string(samples_dir().join("hand-written/panel/panel.xml"))
        .expect("sample");
    // Flip the strips too, for five flipped boards, and drop the bottom paste layer.
    let strips = r#"dy="18" angle="0" mirror="false""#;
    assert!(xml.contains(strips), "the strips' StepRepeat");
    let xml = xml
        .replace(strips, r#"dy="18" angle="0" mirror="true""#)
        .lines()
        .filter(|l| !l.contains("BOT_PASTE"))
        .collect::<Vec<_>>()
        .join("\n");
    let conversion = convert(xml.as_bytes(), &Options::default()).expect("conversion");
    let unpaired: Vec<_> = conversion
        .warnings
        .iter()
        .filter(|w| w.message.contains("no counterpart"))
        .collect();
    assert_eq!(unpaired.len(), 1, "{unpaired:?}");
    let w = unpaired[0];
    assert!(
        w.message.starts_with("layer `TOP_PASTE`")
            && w.message.ends_with("step `board` were skipped"),
        "{w:?}"
    );
    assert_eq!(w.occurrences, 1, "{w:?}");
}

/// A converted file's elements by ID: its components, nets and pins, and its features with
/// their `text` and top face.
type Elements = BTreeMap<String, (String, Option<Face>)>;

/// The placement `(x, y, angle, flipped)` of each instance by name (spec §8.2).
type Frames = BTreeMap<String, (f64, f64, f64, bool)>;

/// The elements and instances of a converted file.
fn elements(glb: &[u8]) -> (Elements, Frames) {
    let (root, bin) = glb::read(glb).expect("GLB");
    let board: Board =
        serde_json::from_value(root.extensions.board.clone().expect("board")).expect("board");
    let t = &board.tables;
    let mut elements = Elements::new();
    for table in [t.components, t.nets, t.pins] {
        for id in strings(&root, bin, table, "id") {
            elements.insert(id, (String::new(), None));
        }
    }
    let mut frames = Frames::new();
    let mut names = Vec::new();
    if let Some(table) = t.instances {
        let [x, y, angle] = ["x", "y", "angle"].map(|c| floats(&root, bin, Some(table), c));
        let sides = column(&root, bin, Some(table), "side");
        for (row, id) in strings(&root, bin, Some(table), "id").iter().enumerate() {
            let name = id["inst/".len()..].to_owned();
            let flipped = Side::from_value(sides[row] as u8) == Some(Side::Bottom);
            frames.insert(name.clone(), (x[row], y[row], angle[row], flipped));
            names.push(name);
        }
    }
    let layers = board
        .layers
        .iter()
        .map(|l| (&l.id, l.node, l.feature_table));
    let drills = board
        .drills
        .iter()
        .map(|d| (&d.id, d.node, d.feature_table));
    for (layer, node, table) in layers.chain(drills) {
        let sources = column(&root, bin, table, "source");
        let instances = column(&root, bin, table, "instance");
        let texts = strings(&root, bin, table, "text");
        let mut faces = feature_faces(&root, bin, node);
        for (row, (source, text)) in sources.iter().zip(texts).enumerate() {
            let scope = names
                .get(instances[row] as usize)
                .map_or_else(String::new, |n| format!("{n}/"));
            let id = format!("feat/{scope}{}/{source}", &layer["layer/".len()..]);
            elements.insert(id, (text, faces.remove(&(row as u32))));
        }
    }
    (elements, frames)
}

/// Spec §3: the same board in inches, millimetres and microns gives the same geometry.
#[test]
fn units_give_the_same_board() {
    let geometry = |name: &str| {
        let (_, path) = samples().into_iter().find(|(n, _)| n == name).expect(name);
        let conversion = run(&path);
        let (root, bin) = glb::read(&conversion.glb).expect("GLB");
        let positions: Vec<Vec<[f32; 3]>> = root
            .meshes
            .iter()
            .flat_map(|m| &m.primitives)
            .map(|p| read_vec3(&root, bin, p.attributes["POSITION"]).expect("positions"))
            .collect();
        positions
    };
    let mm = geometry("minimal-2layer");
    for other in ["units-inch", "units-micron"] {
        let g = geometry(other);
        assert_eq!(g.len(), mm.len(), "{other}");
        for (a, b) in g.iter().zip(&mm) {
            assert_eq!(a.len(), b.len(), "{other}");
            for (p, q) in a.iter().zip(b) {
                for k in 0..3 {
                    assert!((p[k] - q[k]).abs() <= 2e-8, "{other}: {p:?} vs {q:?}");
                }
            }
        }
    }
}

/// Spec §6.13, §8.2: features from package drawings reference their component and are
/// numbered on after the layer's own features.
#[test]
fn package_drawings_belong_to_their_components() {
    /// Expected `(source, component refDes)` per row.
    type Rows = &'static [(u32, &'static str)];
    let cases: [(&str, &str, Rows); 3] = [
        (
            "package-silkscreen",
            "SST",
            &[(0, "R1"), (1, ""), (2, "R2")],
        ),
        ("package-silkscreen", "@silkscreen-bottom", &[(0, "R4")]),
        (
            "assembly-drawing",
            "@assembly-top",
            &[
                (0, "D1"),
                (1, "D1"),
                (2, "D1"),
                (3, "D2"),
                (4, "D2"),
                (5, "D2"),
            ],
        ),
    ];
    for (sample, layer, expected) in cases {
        let (_, path) = samples()
            .into_iter()
            .find(|(n, _)| n == sample)
            .expect(sample);
        let conversion = run(&path);
        let (root, bin) = glb::read(&conversion.glb).expect("GLB");
        let board: Board =
            serde_json::from_value(root.extensions.board.clone().expect("board")).expect("board");
        let refs = strings(&root, bin, board.tables.components, "refDes");
        let entry = board.layers.iter().find(|l| l.name == layer).expect(layer);
        let sources = column(&root, bin, entry.feature_table, "source");
        let components = column(&root, bin, entry.feature_table, "component");
        let refs_of = |row: u32| match row {
            NO_ROW => String::new(),
            r => refs[r as usize].clone(),
        };
        let actual: Vec<(u32, String)> = sources
            .iter()
            .zip(&components)
            .map(|(&s, &c)| (s, refs_of(c)))
            .collect();
        let expected: Vec<(u32, String)> =
            expected.iter().map(|&(s, r)| (s, r.to_owned())).collect();
        assert_eq!(actual, expected, "{sample} {layer}");
    }
}

/// Spec §6.13, §8.2: a `Text` in a package drawing's `Marking` is drawn with the drawing,
/// and its feature has the string as `text`.
#[test]
fn package_marking_text_is_drawn() {
    let (_, path) = samples()
        .into_iter()
        .find(|(n, _)| n == "text")
        .expect("text");
    let conversion = run(&path);
    let (root, bin) = glb::read(&conversion.glb).expect("GLB");
    let board: Board =
        serde_json::from_value(root.extensions.board.clone().expect("board")).expect("board");
    let entry = board
        .layers
        .iter()
        .find(|l| l.name == "@assembly-top")
        .expect("@assembly-top");
    // U1's assembly drawing: its outline, then its REFDES marking.
    let texts = strings(&root, bin, entry.feature_table, "text");
    assert_eq!(texts, ["", "U1"]);
    let kinds = column(&root, bin, entry.feature_table, "kind");
    let marking = u32::from(FeatureKind::Marking.value());
    assert!(kinds.iter().all(|&k| k == marking), "{kinds:?}");
    let areas = feature_areas(&root, bin, entry.node);
    assert!(areas.get(&1).is_some_and(|&a| a > 0.01e-6), "{areas:?}");
}

/// A `UINT32` or `ENUM` (`UINT8`) column of a property table. Missing columns read as
/// `NO_ROW`.
fn column(root: &Root, bin: &[u8], table: Option<u32>, name: &str) -> Vec<u32> {
    let tables = &root
        .extensions
        .structural_metadata
        .as_ref()
        .expect("metadata")
        .property_tables;
    let Some(table) = table else {
        return Vec::new();
    };
    let t = &tables[table as usize];
    let Some(p) = t.properties.get(name) else {
        return vec![NO_ROW; t.count as usize];
    };
    let bytes = view_bytes(root, bin, p.values).expect("column");
    if name == "kind" || name == "fiducial" || name == "side" {
        bytes[..t.count as usize]
            .iter()
            .map(|&b| u32::from(b))
            .collect()
    } else {
        bytes
            .as_chunks::<4>()
            .0
            .iter()
            .take(t.count as usize)
            .map(|&c| u32::from_le_bytes(c))
            .collect()
    }
}

/// A `FLOAT64` column of a property table.
fn floats(root: &Root, bin: &[u8], table: Option<u32>, name: &str) -> Vec<f64> {
    let tables = &root
        .extensions
        .structural_metadata
        .as_ref()
        .expect("metadata")
        .property_tables;
    let t = &tables[table.expect("table") as usize];
    let bytes = view_bytes(root, bin, t.properties[name].values).expect("values");
    bytes
        .as_chunks::<8>()
        .0
        .iter()
        .take(t.count as usize)
        .map(|&c| f64::from_le_bytes(c))
        .collect()
}

/// A `STRING` column of a property table. A missing column reads as empty strings.
fn strings(root: &Root, bin: &[u8], table: Option<u32>, name: &str) -> Vec<String> {
    let tables = &root
        .extensions
        .structural_metadata
        .as_ref()
        .expect("metadata")
        .property_tables;
    let Some(table) = table else {
        return Vec::new();
    };
    let t = &tables[table as usize];
    let Some(p) = t.properties.get(name) else {
        return vec![String::new(); t.count as usize];
    };
    assert_eq!(
        p.string_offset_type.as_deref().unwrap_or("UINT32"),
        "UINT32"
    );
    let bytes = view_bytes(root, bin, p.values).expect("values");
    let offsets = view_bytes(root, bin, p.string_offsets.expect("offsets")).expect("offsets");
    let offsets: Vec<usize> = offsets
        .as_chunks::<4>()
        .0
        .iter()
        .take(t.count as usize + 1)
        .map(|&c| u32::from_le_bytes(c) as usize)
        .collect();
    offsets
        .windows(2)
        .map(|w| String::from_utf8(bytes[w[0]..w[1]].to_vec()).expect("UTF-8"))
        .collect()
}

/// A readable description of a converted board.
fn summary(conversion: &Conversion, detailed: bool) -> String {
    let (root, bin) = glb::read(&conversion.glb).expect("GLB");
    let board: Board =
        serde_json::from_value(root.extensions.board.clone().expect("board")).expect("board");
    let mut out = String::new();
    let s = &board.source;
    writeln!(
        out,
        "source: IPC-2581 rev {}, step {}, {}",
        s.revision.as_deref().unwrap_or("?"),
        s.step.as_deref().unwrap_or("?"),
        s.function_mode.as_deref().unwrap_or("?")
    )
    .unwrap();
    writeln!(out, "thickness: {:.4} mm", board.thickness * 1e3).unwrap();
    let st = &conversion.stats;
    writeln!(
        out,
        "counts: {} features, {} vertices, {} triangles, {} nets, {} components, {} pins ({} checked against pads)",
        st.features, st.vertices, st.triangles, st.nets, st.components, st.pins, st.pins_checked
    )
    .unwrap();
    let converter_warnings: Vec<&str> = conversion
        .warnings
        .iter()
        .filter(|w| w.position.is_none())
        .map(|w| w.message.as_str())
        .collect();
    writeln!(
        out,
        "warnings: {} from the reader, {} from the converter",
        conversion.warnings.len() - converter_warnings.len(),
        converter_warnings.len()
    )
    .unwrap();
    for w in converter_warnings.iter().take(12) {
        writeln!(out, "  - {w}").unwrap();
    }
    let column = |table: Option<u32>, name: &str| column(&root, bin, table, name);
    if let Some(table) = board.tables.instances {
        // Spec §6.14: the placed copies of the panel's steps.
        let ids = strings(&root, bin, Some(table), "id");
        let steps = strings(&root, bin, Some(table), "step");
        let parents = column(Some(table), "parent");
        let sides = column(Some(table), "side");
        let [x, y, angle] = ["x", "y", "angle"].map(|c| floats(&root, bin, Some(table), c));
        writeln!(out, "instances: {}", ids.len()).unwrap();
        for row in 0..ids.len() {
            let parent = match parents[row] {
                NO_ROW => "the converted step",
                p => ids[p as usize].as_str(),
            };
            writeln!(
                out,
                "  {} of step {} in {parent} at ({:.4}, {:.4}) mm, {:.4}°, {:?}",
                ids[row],
                steps[row],
                x[row] * 1e3,
                y[row] * 1e3,
                angle[row],
                Side::from_value(sides[row] as u8).expect("side")
            )
            .unwrap();
        }
    }
    let strings = |table: Option<u32>, name: &str| strings(&root, bin, table, name);
    let entries = board
        .layers
        .iter()
        .map(|l| {
            (
                format!(
                    "layer {} {:?} {:?} z {:.4}..{:.4} mm {:?}{}{}{}",
                    l.id,
                    l.role,
                    l.side,
                    l.z_min * 1e3,
                    l.z_max * 1e3,
                    l.thickness_source,
                    if l.synthesized { " synthesized" } else { "" },
                    if l.visible { "" } else { " hidden" },
                    source_colors(&root, l.node)
                ),
                l.node,
                l.feature_table,
            )
        })
        .chain(board.drills.iter().map(|d| {
            (
                format!("drill {} {}..{}", d.id, d.from, d.to),
                d.node,
                d.feature_table,
            )
        }));
    for (title, node, table) in entries {
        let kinds = column(table, "kind");
        let nets = column(table, "net");
        let fiducials = column(table, "fiducial");
        let instances = column(table, "instance");
        let texts = strings(table, "text");
        let mut histogram: BTreeMap<String, usize> = BTreeMap::new();
        for &k in &kinds {
            *histogram
                .entry(format!(
                    "{:?}",
                    FeatureKind::from_value(k as u8).expect("kind")
                ))
                .or_default() += 1;
        }
        let areas = feature_areas(&root, bin, node);
        let (vertices, triangles) = mesh_size(&root, node);
        writeln!(out, "{title}").unwrap();
        writeln!(
            out,
            "  {} features {:?}, {vertices} vertices, {triangles} triangles, top area {:.4} mm²",
            kinds.len(),
            histogram,
            areas.values().sum::<f64>() * 1e6
        )
        .unwrap();
        if detailed {
            for (row, kind) in kinds.iter().enumerate() {
                let net = match nets[row] {
                    NO_ROW => "-".to_owned(),
                    n => n.to_string(),
                };
                let kind = match Fiducial::from_value(fiducials[row] as u8) {
                    Some(f) => format!("Fiducial({f:?})"),
                    None => format!("{:?}", FeatureKind::from_value(*kind as u8).expect("kind")),
                };
                let instance = match instances[row] {
                    NO_ROW => String::new(),
                    i => format!(" instance {i}"),
                };
                let text = match texts[row].as_str() {
                    "" => String::new(),
                    text => format!(" text {text:?}"),
                };
                writeln!(
                    out,
                    "    row {row}: {kind} net {net}{instance} area {:.4} mm²{text}",
                    areas.get(&(row as u32)).copied().unwrap_or(0.0) * 1e6
                )
                .unwrap();
            }
        }
    }
    let components = &root.nodes[root.nodes[0].children[2] as usize].children;
    writeln!(out, "components: {}", components.len()).unwrap();
    for &c in components
        .iter()
        .take(if detailed { usize::MAX } else { 5 })
    {
        let n = &root.nodes[c as usize];
        let t = n.translation.unwrap_or_default().map(|v| v * 1e3);
        let r = n.rotation.unwrap_or([0.0, 0.0, 0.0, 1.0]);
        let body = match (n.mesh, n.children.first()) {
            (Some(m), _) => format!(
                "placeholder {}",
                root.meshes[m as usize].name.as_deref().unwrap_or("?")
            ),
            (None, Some(&child)) => format!(
                "model {}",
                root.nodes[child as usize].name.as_deref().unwrap_or("?")
            ),
            (None, None) => "no body".into(),
        };
        writeln!(
            out,
            "  {} at ({:.4}, {:.4}, {:.4}) mm, rotation ({:.4}, {:.4}, {:.4}, {:.4}), {body}",
            n.name.as_deref().unwrap_or("?"),
            t[0],
            t[1],
            t[2],
            r[0],
            r[1],
            r[2],
            r[3]
        )
        .unwrap();
    }
    out
}

/// The node's materials with a colour from the source (spec §7), as ` material <name>…`.
fn source_colors(root: &Root, node: u32) -> String {
    let Some(mesh) = root.nodes[node as usize].mesh else {
        return String::new();
    };
    let mut names: Vec<&str> = root.meshes[mesh as usize]
        .primitives
        .iter()
        .filter_map(|p| root.materials[p.material? as usize].name.as_deref())
        .filter(|name| name.matches('/').count() > 1)
        .collect();
    names.dedup();
    names.iter().map(|n| format!(" material {n}")).collect()
}

fn mesh_size(root: &Root, node: u32) -> (u64, u64) {
    let Some(mesh) = root.nodes[node as usize].mesh else {
        return (0, 0);
    };
    root.meshes[mesh as usize]
        .primitives
        .iter()
        .map(|p| {
            (
                root.accessors[p.attributes["POSITION"] as usize].count,
                root.accessors[p.indices.expect("indices") as usize].count / 3,
            )
        })
        .fold((0, 0), |(v, t), (pv, pt)| (v + pv, t + pt))
}

/// Area of each feature's upward-facing triangles at the top of the mesh, in m².
fn feature_areas(root: &Root, bin: &[u8], node: u32) -> BTreeMap<u32, f64> {
    feature_faces(root, bin, node)
        .into_iter()
        .map(|(row, face)| (row, face.area))
        .collect()
}

/// A feature's upward-facing triangles at the top of the mesh: area (m²), centroid and
/// bounds in board coordinates (m).
#[derive(Debug)]
struct Face {
    area: f64,
    centroid: [f64; 2],
    min: [f64; 2],
    max: [f64; 2],
}

/// The top face of each feature of a node's mesh, by feature-table row.
fn feature_faces(root: &Root, bin: &[u8], node: u32) -> BTreeMap<u32, Face> {
    let mut faces: BTreeMap<u32, Face> = BTreeMap::new();
    let Some(mesh) = root.nodes[node as usize].mesh else {
        return faces;
    };
    for p in &root.meshes[mesh as usize].primitives {
        let positions = read_vec3(root, bin, p.attributes["POSITION"]).expect("positions");
        let ids = read_u32s(root, bin, p.attributes["_FEATURE_ID_0"]).expect("ids");
        let indices = read_u32s(root, bin, p.indices.expect("indices")).expect("indices");
        let top = positions.iter().map(|p| p[1]).fold(f32::MIN, f32::max);
        for t in indices.as_chunks::<3>().0 {
            let [a, b, c] = [t[0], t[1], t[2]].map(|i| positions[i as usize]);
            if a[1] != top || b[1] != top || c[1] != top {
                continue;
            }
            // Board coordinates (x, -z); counter-clockwise from above is positive.
            let [a, b, c] = [a, b, c].map(|p| [f64::from(p[0]), -f64::from(p[2])]);
            let twice = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
            if twice > 0.0 {
                let face = faces.entry(ids[t[0] as usize]).or_insert(Face {
                    area: 0.0,
                    centroid: [0.0; 2],
                    min: [f64::INFINITY; 2],
                    max: [f64::NEG_INFINITY; 2],
                });
                face.area += twice / 2.0;
                for k in 0..2 {
                    // The first moment; divided by the area below.
                    face.centroid[k] += twice / 2.0 * (a[k] + b[k] + c[k]) / 3.0;
                    face.min[k] = face.min[k].min(a[k]).min(b[k]).min(c[k]);
                    face.max[k] = face.max[k].max(a[k]).max(b[k]).max(c[k]);
                }
            }
        }
    }
    for face in faces.values_mut() {
        face.centroid = face.centroid.map(|m| m / face.area);
    }
    faces
}
