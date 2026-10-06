//! Conformance suite (`spec/samples/README.md`): converts every sample in `spec/samples`,
//! checks the result with [`validate`], and compares a summary with the expected output in
//! `spec/samples/expected/`.
//!
//! - `INSTA_UPDATE=always cargo test -p boardui-convert --test conformance` rewrites the
//!   expected summaries; `BOARDUI_BLESS=1` also rewrites the expected GLBs of the
//!   hand-written samples.
//! - `BOARDUI_CONFORMANCE_OUT=<dir>` writes every converted GLB to `<dir>`, for the Khronos
//!   validator step in CI.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use boardui_convert::{Conversion, ModelLibrary, Options, convert, validate};
use boardui_gltf::buffer::{read_u32s, read_vec3, view_bytes};
use boardui_gltf::metadata::NO_ROW;
use boardui_gltf::{Board, FeatureKind, Root, glb};

fn samples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spec/samples")
}

/// Every `.xml` sample under `spec/samples`, by name.
fn samples() -> Vec<(String, PathBuf)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).expect("samples directory") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "xml") {
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
        conversion.stats.pins_misplaced, 0,
        "{name}: component pins are not on their pads"
    );
    if let Ok(dir) = std::env::var("BOARDUI_CONFORMANCE_OUT") {
        std::fs::create_dir_all(&dir).expect("output directory");
        std::fs::write(Path::new(&dir).join(format!("{name}.glb")), &conversion.glb)
            .expect("write GLB");
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
    slots => "slots",
    bottom_placement => "bottom-placement",
    user_models => "user-models",
    testcase1 => "testcase1-RevC-Assembly",
    testcase3 => "testcase3-RevC-Assembly",
    testcase10 => "testcase10-RevC-Assembly",
    kicad_royalblue54l_feather => "royalblue54l-feather",
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
    let tables = &root
        .extensions
        .structural_metadata
        .as_ref()
        .expect("metadata")
        .property_tables;
    let column = |table: u32, name: &str| -> Vec<u32> {
        let t = &tables[table as usize];
        let Some(p) = t.properties.get(name) else {
            return vec![NO_ROW; t.count as usize];
        };
        let bytes = view_bytes(&root, bin, p.values).expect("column");
        if name == "kind" {
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
    };
    let entries = board
        .layers
        .iter()
        .map(|l| {
            (
                format!(
                    "layer {} {:?} {:?} z {:.4}..{:.4} mm {:?}{}{}",
                    l.id,
                    l.role,
                    l.side,
                    l.z_min * 1e3,
                    l.z_max * 1e3,
                    l.thickness_source,
                    if l.synthesized { " synthesized" } else { "" },
                    if l.visible { "" } else { " hidden" }
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
                writeln!(
                    out,
                    "    row {row}: {:?} net {net} area {:.4} mm²",
                    FeatureKind::from_value(*kind as u8).expect("kind"),
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
    let mut areas = BTreeMap::new();
    let Some(mesh) = root.nodes[node as usize].mesh else {
        return areas;
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
            let (ax, ay) = (f64::from(a[0]), -f64::from(a[2]));
            let (bx, by) = (f64::from(b[0]), -f64::from(b[2]));
            let (cx, cy) = (f64::from(c[0]), -f64::from(c[2]));
            let twice = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
            if twice > 0.0 {
                *areas.entry(ids[t[0] as usize]).or_default() += twice / 2.0;
            }
        }
    }
    areas
}
