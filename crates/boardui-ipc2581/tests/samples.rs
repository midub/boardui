//! Parses the IPC consortium test cases in `spec/samples/ipc-testcases`.
//!
//! The expected counts were derived from the XML independently of this crate, with `grep -c`
//! and a Python `xml.etree` script (see the M1 pull request).
//!
//! The repository only links to the test cases: `python3 spec/samples/ipc-testcases/fetch.py`
//! fetches them. A test whose file is missing is skipped with a message, or fails if
//! `BOARDUI_REQUIRE_IPC_TESTCASES` is set (CI sets it).

use std::collections::BTreeMap;
use std::fmt::Write;
use std::fs::File;
use std::io::{BufReader, Write as _};
use std::path::Path;

use boardui_ipc2581::{Document, FeatureElement, PlatingStatus, PrimitiveKind, Shape, Step};

struct Expected {
    file: &'static str,
    step: &'static str,
    layers: usize,
    components: usize,
    packages: usize,
    pins: usize,
    standard_primitives: usize,
    line_descs: usize,
    /// Source features (`Pad`, `Features`, `Hole`, `SlotCavity`) per layer.
    features: &'static [(&'static str, usize)],
    /// Holes by `platingStatus`: plated, non-plated, via.
    holes: [usize; 3],
    nets: usize,
    pin_refs: usize,
    profile_cutouts: usize,
}

const TESTCASE3: Expected = Expected {
    file: "testcase3-RevC-Assembly.xml",
    step: "test-3_r2.-17_4",
    layers: 3,
    components: 42,
    packages: 8,
    pins: 95,
    standard_primitives: 8,
    line_descs: 5,
    features: &[("TOP", 884), ("BOTTOM", 483), ("DRILL_1-6", 174)],
    holes: [63, 3, 108],
    nets: 261,
    pin_refs: 542,
    profile_cutouts: 11,
};

const TESTCASE10: Expected = Expected {
    file: "testcase10-RevC-Assembly.xml",
    step: "testcase10-RevC",
    layers: 5,
    components: 56,
    packages: 5,
    pins: 1164,
    standard_primitives: 8,
    line_descs: 6,
    features: &[
        ("TOP", 5010),
        ("BOTTOM", 1946),
        ("DRILL_1-18", 1859),
        ("SS_TOP", 137),
        ("SS_BOT", 207),
    ],
    holes: [100, 0, 1759],
    nets: 514,
    pin_refs: 1844,
    profile_cutouts: 0,
};

const TESTCASE1: Expected = Expected {
    file: "testcase1-RevC-Assembly.xml",
    step: "testcase1-v174-RevC",
    layers: 5,
    components: 1656,
    packages: 105,
    pins: 3233,
    standard_primitives: 75,
    line_descs: 14,
    features: &[
        ("TOP", 13853),
        ("BOTTOM", 13697),
        ("DRILL_1-12", 5819),
        ("silkscreen_top.art", 1509),
        ("silkscreen_bottom.art", 754),
    ],
    holes: [266, 37, 5516],
    nets: 2436,
    pin_refs: 8377,
    profile_cutouts: 0,
};

/// The parsed test case `file`, or `None` if it isn't fetched (see the module docs).
fn parse(file: &str) -> Option<Document> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/samples/ipc-testcases")
        .join(file);
    if !path.exists() {
        let message =
            format!("{file} is not fetched: run `python3 spec/samples/ipc-testcases/fetch.py`");
        let required = std::env::var_os("BOARDUI_REQUIRE_IPC_TESTCASES");
        assert!(required.is_none_or(|v| v.is_empty()), "{message}");
        // Not `eprintln!`: the test harness hides what that prints in a passing test.
        writeln!(std::io::stderr(), "skipped: {message}").expect("stderr");
        return None;
    }
    let reader = BufReader::new(File::open(&path).expect("sample exists"));
    Some(boardui_ipc2581::parse(reader).unwrap_or_else(|e| panic!("{file}: {e}")))
}

fn check(expected: &Expected) -> Option<Document> {
    let doc = parse(expected.file)?;
    assert_eq!(doc.revision, "C");
    assert_eq!(doc.content.function_mode.as_deref(), Some("ASSEMBLY"));
    assert_eq!(doc.ecad.layers.len(), expected.layers);
    assert_eq!(
        doc.content.standard_primitives.len(),
        expected.standard_primitives
    );
    assert_eq!(doc.content.line_descs.len(), expected.line_descs);
    assert_eq!(doc.ecad.steps.len(), 1);
    let step = doc.ecad.steps.get(expected.step).expect("step");
    assert_eq!(step.components.len(), expected.components);
    assert_eq!(step.packages.len(), expected.packages);
    assert_eq!(
        step.packages.values().map(|p| p.pins.len()).sum::<usize>(),
        expected.pins
    );
    let features: Vec<_> = step
        .layer_features
        .values()
        .map(|lf| (lf.layer_ref.as_str(), lf.feature_count()))
        .collect();
    assert_eq!(features, expected.features);
    assert_eq!(holes_by_plating(step), expected.holes);
    assert_eq!(step.nets().len(), expected.nets);
    let pin_refs = step
        .layer_features
        .values()
        .flat_map(|lf| lf.features())
        .map(|(_, f)| match &f.element {
            FeatureElement::Pad(pad) => pad.pin_refs.len(),
            _ => 0,
        })
        .sum::<usize>();
    assert_eq!(pin_refs, expected.pin_refs);
    let profile = step.profile.as_ref().expect("profile");
    assert_eq!(profile.cutouts.len(), expected.profile_cutouts);
    for lf in step.layer_features.values() {
        let sources: Vec<_> = lf.features().map(|(_, f)| f.source).collect();
        assert!(
            sources.iter().copied().eq(0..sources.len()),
            "source indices of {} are 0..n in order",
            lf.layer_ref
        );
    }
    Some(doc)
}

fn holes_by_plating(step: &Step) -> [usize; 3] {
    let mut counts = [0; 3];
    for lf in step.layer_features.values() {
        for (_, f) in lf.features() {
            if let FeatureElement::Hole(hole) = &f.element {
                counts[match hole.plating {
                    PlatingStatus::Plated => 0,
                    PlatingStatus::NonPlated => 1,
                    PlatingStatus::Via => 2,
                }] += 1;
            }
        }
    }
    counts
}

fn shape_name(shape: &Shape) -> &'static str {
    match shape {
        Shape::StandardRef(_) => "StandardPrimitiveRef",
        Shape::UserRef(_) => "UserPrimitiveRef",
        Shape::Standard(p) => match p.kind {
            PrimitiveKind::Contour(_) => "Contour",
            _ => "standard primitive",
        },
        Shape::UserSpecial(_) => "UserSpecial",
        Shape::Line(_) => "Line",
        Shape::Arc(_) => "Arc",
        Shape::Polyline(_) => "Polyline",
        Shape::Polygon(_) => "Polygon",
        Shape::Outline(_) => "Outline",
        _ => "unsupported",
    }
}

/// A readable summary of what was read, for snapshots.
fn summary(doc: &Document) -> String {
    let mut s = String::new();
    let ecad = &doc.ecad;
    writeln!(s, "units: {:?}", ecad.units).unwrap();
    writeln!(s, "layers:").unwrap();
    for layer in ecad.layers.values() {
        write!(
            s,
            "  {} {} {:?} {:?}",
            layer.name, layer.function, layer.side, layer.polarity
        )
        .unwrap();
        if let Some(span) = &layer.span {
            write!(s, " span {}..{}", span.from_layer, span.to_layer).unwrap();
        }
        writeln!(s).unwrap();
    }
    for step in ecad.steps.values() {
        writeln!(s, "step {}: datum {:?}", step.name, step.datum).unwrap();
        for lf in step.layer_features.values() {
            let mut kinds = BTreeMap::new();
            for (set, f) in lf.features() {
                let kind = match &f.element {
                    FeatureElement::Pad(_) => "Pad".to_owned(),
                    FeatureElement::Features(features) => {
                        format!("Features/{}", shape_name(&features.shape))
                    }
                    FeatureElement::Fiducial(fiducial) => {
                        format!("Fiducial/{}", shape_name(&fiducial.shape))
                    }
                    FeatureElement::Hole(_) => "Hole".to_owned(),
                    FeatureElement::SlotCavity(_) => "SlotCavity".to_owned(),
                };
                *kinds.entry(kind).or_insert(0) += 1;
                if set.component_ref.is_some() {
                    *kinds.entry("(with componentRef)".to_owned()).or_insert(0) += 1;
                }
            }
            writeln!(s, "  {}: {kinds:?}", lf.layer_ref).unwrap();
        }
        let first = step.components.values().next().expect("components");
        writeln!(s, "  first component: {first:?}").unwrap();
    }
    let software = doc
        .history
        .as_ref()
        .and_then(|h| h.software_package.as_ref());
    writeln!(s, "software: {software:?}").unwrap();
    let items: Vec<_> = doc.boms.iter().flat_map(|b| &b.items).collect();
    writeln!(
        s,
        "bom: {} items, {} refdes ({} not populated), {} characteristics",
        items.len(),
        items.iter().map(|i| i.ref_des.len()).sum::<usize>(),
        items
            .iter()
            .flat_map(|i| &i.ref_des)
            .filter(|r| r.populate == Some(false))
            .count(),
        items.iter().map(|i| i.characteristics.len()).sum::<usize>()
    )
    .unwrap();
    if let Some(item) = items.first() {
        writeln!(s, "  first item: {item:?}").unwrap();
    }
    if let Some(avl) = &doc.avl {
        writeln!(
            s,
            "avl: {} items, {} vendor part numbers",
            avl.items.len(),
            avl.items.values().map(|i| i.vmpns.len()).sum::<usize>()
        )
        .unwrap();
    }
    writeln!(s, "diagnostics:").unwrap();
    for d in &doc.diagnostics {
        writeln!(s, "  {d}").unwrap();
    }
    s
}

#[test]
fn testcase3() {
    if let Some(doc) = check(&TESTCASE3) {
        insta::assert_snapshot!(summary(&doc));
    }
}

#[test]
fn testcase10() {
    if let Some(doc) = check(&TESTCASE10) {
        insta::assert_snapshot!(summary(&doc));
    }
}

#[test]
fn testcase1() {
    if let Some(doc) = check(&TESTCASE1) {
        insta::assert_snapshot!(summary(&doc));
    }
}
