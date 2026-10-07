//! Unit tests over small XML snippets, one module per element family.

use crate::{Diagnostic, DiagnosticKind, Document, Error, ErrorKind, RefKind, Step, parse_bytes};

/// Parses a document with the given `Content` children and `CadData` children.
fn doc(units: &str, content: &str, cad_data: &str) -> Result<Document, Error> {
    let xml = format!(
        r#"<?xml version="1.0"?>
<IPC-2581 revision="C" xmlns="http://webstds.ipc.org/2581">
<Content><FunctionMode mode="ASSEMBLY"/>{content}</Content>
<Ecad name="e"><CadHeader units="{units}"/><CadData>{cad_data}</CadData></Ecad>
</IPC-2581>"#
    );
    parse_bytes(xml.as_bytes())
}

/// Layers `TOP`, `BOTTOM` and `DRILL` (spanning both).
const LAYERS: &str = r#"
<Layer name="TOP" layerFunction="CONDUCTOR" side="TOP"/>
<Layer name="BOTTOM" layerFunction="CONDUCTOR" side="BOTTOM"/>
<Layer name="DRILL" layerFunction="DRILL" side="ALL"><Span fromLayer="TOP" toLayer="BOTTOM"/></Layer>"#;

/// Content defining line descriptor `L`, fill descriptor `F` and standard primitive `C`.
const DICTIONARIES: &str = r#"
<DictionaryLineDesc units="MILLIMETER">
  <EntryLineDesc id="L"><LineDesc lineWidth="0.2" lineEnd="ROUND"/></EntryLineDesc>
</DictionaryLineDesc>
<DictionaryFillDesc units="MILLIMETER">
  <EntryFillDesc id="F"><FillDesc fillProperty="FILL"/></EntryFillDesc>
</DictionaryFillDesc>
<DictionaryStandard units="MILLIMETER">
  <EntryStandard id="C"><Circle diameter="1"/></EntryStandard>
</DictionaryStandard>"#;

/// Parses a document with [`LAYERS`], [`DICTIONARIES`] and one step `S` in millimetres.
fn step_doc(step: &str) -> Result<Document, Error> {
    doc(
        "MILLIMETER",
        DICTIONARIES,
        &format!(r#"{LAYERS}<Step name="S">{step}</Step>"#),
    )
}

/// Parses with [`step_doc`] and returns step `S`, asserting there are no warnings.
fn step(step: &str) -> Step {
    let d = step_doc(step).unwrap();
    assert_eq!(d.diagnostics, [], "unexpected warnings");
    d.ecad.steps.get("S").unwrap().clone()
}

fn kinds(diagnostics: &[Diagnostic]) -> Vec<&DiagnosticKind> {
    diagnostics.iter().map(|d| &d.kind).collect()
}

fn dangling(kind: RefKind, key: &str) -> DiagnosticKind {
    DiagnosticKind::DanglingReference {
        kind,
        key: key.to_owned(),
    }
}

/// Millimetres to metres, as the parser converts them.
fn mm(value: f64) -> f64 {
    value * crate::Units::Millimeter.metres()
}

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= 1e-12 * expected.abs().max(1.0),
        "{actual} != {expected}"
    );
}

mod document {
    use super::*;

    #[test]
    fn reads_header_and_content_references() {
        let d = doc(
            "INCH",
            r#"<StepRef name="S"/><LayerRef name="TOP"/>"#,
            &format!(r#"{LAYERS}<Step name="S"/>"#),
        )
        .unwrap();
        assert_eq!(d.revision, "C");
        assert_eq!(d.content.function_mode.as_deref(), Some("ASSEMBLY"));
        assert_eq!(d.content.step_refs, ["S"]);
        assert_eq!(d.content.layer_refs, ["TOP"]);
        assert_eq!(d.ecad.name, "e");
        assert_eq!(d.ecad.units, crate::Units::Inch);
        assert_eq!(d.diagnostics, []);
    }

    #[test]
    fn tolerates_namespace_prefixes() {
        let xml = r#"<?xml version="1.0"?>
<ipc:IPC-2581 xmlns:ipc="http://webstds.ipc.org/2581"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://webstds.ipc.org/2581 IPC-2581C.xsd" revision="C">
  <ipc:Content><ipc:FunctionMode mode="FABRICATION"/></ipc:Content>
  <ipc:Ecad name="e"><ipc:CadHeader units="MICRON"/><ipc:CadData>
    <ipc:Layer name="TOP" layerFunction="CONDUCTOR"/>
  </ipc:CadData></ipc:Ecad>
</ipc:IPC-2581>"#;
        let d = parse_bytes(xml.as_bytes()).unwrap();
        assert_eq!(d.content.function_mode.as_deref(), Some("FABRICATION"));
        assert_eq!(d.ecad.layers.len(), 1);
        assert_eq!(d.diagnostics, []);
    }

    #[test]
    fn rejects_other_roots_and_empty_input() {
        let e = parse_bytes(b"<?xml version=\"1.0\"?><ODB/>").unwrap_err();
        assert_eq!(
            e.kind(),
            &ErrorKind::NotIpc2581 {
                root: "ODB".to_owned()
            }
        );
        let e = parse_bytes(b"").unwrap_err();
        assert_eq!(
            e.kind(),
            &ErrorKind::NotIpc2581 {
                root: String::new()
            }
        );
    }

    #[test]
    fn reports_malformed_xml_with_position() {
        let e = parse_bytes(b"<IPC-2581 revision=\"C\">\n<Content></Ecad>").unwrap_err();
        assert!(matches!(e.kind(), ErrorKind::Xml { .. }), "{e}");
        assert_eq!(e.position().line, 2);
    }

    #[test]
    fn reports_truncated_input() {
        let e = parse_bytes(b"<IPC-2581 revision=\"C\"><Content>").unwrap_err();
        assert!(
            matches!(
                e.kind(),
                ErrorKind::UnexpectedEof { .. } | ErrorKind::Xml { .. }
            ),
            "{e}"
        );
    }

    #[test]
    fn requires_content_ecad_and_units() {
        let missing = |xml: &str, expected: &str| {
            let e = parse_bytes(xml.as_bytes()).unwrap_err();
            match e.kind() {
                ErrorKind::MissingElement { expected: e, .. } => assert_eq!(e, expected),
                other => panic!("{other:?}"),
            }
        };
        missing(r#"<IPC-2581 revision="C"/>"#, "`Content`");
        missing(r#"<IPC-2581 revision="C"><Content/></IPC-2581>"#, "`Ecad`");
        missing(
            r#"<IPC-2581 revision="C"><Content/><Ecad name="e"><CadData/></Ecad></IPC-2581>"#,
            "`CadHeader` before `CadData`",
        );
        missing(
            r#"<IPC-2581 revision="C"><Content/><Ecad name="e"><CadHeader units="INCH"/></Ecad></IPC-2581>"#,
            "`CadData`",
        );
    }

    #[test]
    fn requires_revision_and_warns_about_unknown_ones() {
        let e = parse_bytes(b"<IPC-2581><Content/></IPC-2581>").unwrap_err();
        assert!(
            matches!(e.kind(), ErrorKind::MissingAttribute { attribute, .. } if attribute == "revision")
        );

        let xml = r#"<IPC-2581 revision="A"><Content/><Ecad name="e"><CadHeader units="INCH"/><CadData/></Ecad></IPC-2581>"#;
        let d = parse_bytes(xml.as_bytes()).unwrap();
        assert_eq!(
            kinds(&d.diagnostics),
            [&DiagnosticKind::UnsupportedRevision {
                revision: "A".to_owned()
            }]
        );
        let b = xml.replace("\"A\"", "\"B\"");
        assert_eq!(parse_bytes(b.as_bytes()).unwrap().diagnostics, []);
    }

    #[test]
    fn warns_about_repeated_singletons() {
        let d = doc(
            "INCH",
            r#"<FunctionMode mode="TEST"/>"#,
            r#"<Layer name="TOP" layerFunction="CONDUCTOR"><Span fromLayer="TOP" toLayer="TOP"/><Span fromLayer="TOP" toLayer="TOP"/></Layer>"#,
        )
        .unwrap();
        assert_eq!(d.content.function_mode.as_deref(), Some("ASSEMBLY"));
        assert_eq!(
            kinds(&d.diagnostics),
            [
                &DiagnosticKind::DuplicateElement {
                    element: "FunctionMode".to_owned(),
                    parent: "Content".to_owned()
                },
                &DiagnosticKind::DuplicateElement {
                    element: "Span".to_owned(),
                    parent: "Layer".to_owned()
                },
            ]
        );
    }
}

mod units {
    use super::*;
    use crate::FeatureElement;

    fn hole_diameter(units: &str, value: &str) -> f64 {
        let cad = format!(
            r#"{LAYERS}<Step name="S"><LayerFeature layerRef="DRILL"><Set>
            <Hole name="H" diameter="{value}" platingStatus="PLATED" plusTol="0" minusTol="0" x="{value}" y="0"/>
            </Set></LayerFeature></Step>"#
        );
        let d = doc(units, "", &cad).unwrap();
        let step = d.ecad.steps.get("S").unwrap();
        let (_, feature) = step
            .layer_features
            .get("DRILL")
            .unwrap()
            .features()
            .next()
            .unwrap();
        let FeatureElement::Hole(hole) = &feature.element else {
            panic!("not a hole")
        };
        assert_eq!(hole.diameter, hole.position.x);
        hole.diameter
    }

    #[test]
    fn converts_all_units_to_metres() {
        assert_close(hole_diameter("INCH", "0.04"), 0.04 * 0.0254);
        assert_close(hole_diameter("MILLIMETER", "1.5"), 1.5e-3);
        assert_close(hole_diameter("MICRON", "250"), 250e-6);
    }

    #[test]
    fn rejects_other_units() {
        let e = doc("FOOT", "", "").unwrap_err();
        assert_eq!(
            e.kind(),
            &ErrorKind::InvalidValue {
                element: "CadHeader".to_owned(),
                attribute: "units".to_owned(),
                value: "FOOT".to_owned(),
                expected: "one of INCH MILLIMETER MICRON".to_owned(),
            }
        );
    }

    #[test]
    fn dictionaries_use_their_own_units() {
        let d = doc(
            "INCH",
            r#"<DictionaryStandard units="MICRON"><EntryStandard id="C"><Circle diameter="100"/></EntryStandard></DictionaryStandard>
            <DictionaryLineDesc units="INCH"><EntryLineDesc id="L"><LineDesc lineWidth="0.01" lineEnd="ROUND"/></EntryLineDesc></DictionaryLineDesc>"#,
            "",
        )
        .unwrap();
        let crate::PrimitiveKind::Circle { diameter } =
            d.content.standard_primitives.get("C").unwrap().kind
        else {
            panic!("not a circle")
        };
        assert_close(diameter, 100e-6);
        assert_close(d.content.line_descs.get("L").unwrap().width, 0.01 * 0.0254);
    }

    #[test]
    fn lengths_need_units() {
        let e = doc(
            "INCH",
            r#"<DictionaryStandard><EntryStandard id="C"><Circle diameter="1"/></EntryStandard></DictionaryStandard>"#,
            "",
        )
        .unwrap_err();
        assert_eq!(
            e.kind(),
            &ErrorKind::UnitsUnknown {
                element: "Circle".to_owned()
            }
        );
    }

    #[test]
    fn angles_stay_in_degrees() {
        let s = step(
            r#"<Component refDes="R1" packageRef="P" layerRef="TOP"><Xform rotation="90" xOffset="1"/></Component>
            <Package name="P"/>"#,
        );
        let xform = s.components.get("R1").unwrap().xform;
        assert_eq!(xform.rotation, 90.0);
        assert_close(xform.offset.x, mm(1.0));
    }
}

mod diagnostics {
    use super::*;

    #[test]
    fn unknown_elements_are_skipped_with_position_and_count() {
        let xml = "<IPC-2581 revision=\"C\">\n<Content>\n  <Foo a=\"1\"><Bar/></Foo>\n  <Foo/>\n</Content>\n<Ecad name=\"e\"><CadHeader units=\"INCH\"/><CadData/></Ecad></IPC-2581>";
        let d = parse_bytes(xml.as_bytes()).unwrap();
        assert_eq!(
            d.diagnostics,
            [Diagnostic {
                kind: DiagnosticKind::UnknownElement {
                    element: "Foo".to_owned(),
                    parent: "Content".to_owned()
                },
                position: crate::Position {
                    offset: xml.find("<Foo").unwrap() as u64,
                    line: 3
                },
                occurrences: 2,
            }]
        );
        assert_eq!(
            d.diagnostics[0].to_string(),
            "line 3 (byte 36): skipped unknown element `Foo` in `Content` (2 occurrences)"
        );
    }

    #[test]
    fn unknown_attributes_are_reported() {
        let d = doc(
            "INCH",
            "",
            r#"<Layer name="TOP" layerFunction="CONDUCTOR" color="red"/>"#,
        )
        .unwrap();
        assert_eq!(
            kinds(&d.diagnostics),
            [&DiagnosticKind::UnknownAttribute {
                element: "Layer".to_owned(),
                attribute: "color".to_owned()
            }]
        );
    }

    #[test]
    fn text_content_is_reported() {
        let d = doc("INCH", "hello", "").unwrap();
        assert_eq!(
            kinds(&d.diagnostics),
            [&DiagnosticKind::UnexpectedText {
                element: "Content".to_owned()
            }]
        );
    }

    #[test]
    fn positions_count_lines_across_multi_line_tags() {
        let cad = "<Layer\n name=\"TOP\"\n layerFunction=\"CONDUCTOR\"/>\n<!-- a\ncomment -->\n<Layer name=\"X\" layerFunction=\"DRILL\"><Span fromLayer=\"TOP\" toLayer=\"NOPE\"/></Layer>";
        let d = doc("INCH", "", cad).unwrap();
        let [diagnostic] = d.diagnostics.as_slice() else {
            panic!("{:?}", d.diagnostics)
        };
        assert_eq!(diagnostic.kind, dangling(RefKind::Layer, "NOPE"));
        // Header lines 1-3, then the CadData lines.
        assert_eq!(diagnostic.position.line, 4 + 5);
    }

    #[test]
    fn malformed_values_are_errors_with_position() {
        let e = doc(
            "INCH",
            "",
            "\n\n<Layer name=\"TOP\" layerFunction=\"CONDUCTOR\" polarity=\"PLUS\"/>",
        )
        .unwrap_err();
        assert_eq!(e.position().line, 6);
        assert_eq!(
            e.to_string(),
            format!(
                "line 6 (byte {}): attribute `polarity` of `Layer` is \"PLUS\", expected one of POSITIVE NEGATIVE",
                e.position().offset
            )
        );
        let e = step_doc(r#"<Datum x="1,5" y="0"/>"#).unwrap_err();
        assert!(matches!(e.kind(), ErrorKind::InvalidValue { attribute, .. } if attribute == "x"));
    }

    #[test]
    fn missing_attributes_and_empty_references_are_errors() {
        let e = step_doc(r#"<Datum x="1"/>"#).unwrap_err();
        assert_eq!(
            e.kind(),
            &ErrorKind::MissingAttribute {
                element: "Datum".to_owned(),
                attribute: "y".to_owned()
            }
        );
        let e = step_doc(r#"<LayerFeature layerRef=""/>"#).unwrap_err();
        assert!(
            matches!(e.kind(), ErrorKind::InvalidValue { expected, .. } if expected == "a non-empty reference")
        );
    }
}

mod dictionaries {
    use super::*;
    use crate::{
        ButterflyShape, Color, Corners, FillDesc, FillProperty, FillStyle, LineDesc, LineEnd,
        LineProperty, LineStyle, Moire, Point, PrimitiveKind, RingShape, Shape, Xform,
    };

    fn standard(entries: &str) -> Document {
        doc(
            "INCH",
            &format!(r#"<DictionaryStandard units="MILLIMETER">{entries}</DictionaryStandard>"#),
            "",
        )
        .unwrap()
    }

    fn primitive(xml: &str) -> PrimitiveKind {
        let d = standard(&format!(r#"<EntryStandard id="X">{xml}</EntryStandard>"#));
        assert_eq!(d.diagnostics, []);
        d.content.standard_primitives.get("X").unwrap().kind.clone()
    }

    #[test]
    fn reads_standard_primitives() {
        use PrimitiveKind as K;
        let all = Corners {
            upper_right: true,
            upper_left: true,
            lower_right: true,
            lower_left: true,
        };
        assert_eq!(
            primitive(r#"<Circle diameter="2"/>"#),
            K::Circle { diameter: mm(2.0) }
        );
        assert_eq!(
            primitive(r#"<RectCenter width="2" height="1"/>"#),
            K::RectCenter {
                width: mm(2.0),
                height: mm(1.0)
            }
        );
        assert_eq!(
            primitive(
                r#"<RectCorner lowerLeftX="-1" lowerLeftY="-2" upperRightX="3" upperRightY="4"/>"#
            ),
            K::RectCorner {
                lower_left: Point {
                    x: -mm(1.0),
                    y: -mm(2.0)
                },
                upper_right: Point {
                    x: mm(3.0),
                    y: mm(4.0)
                }
            }
        );
        assert_eq!(
            primitive(r#"<RectRound width="2" height="1" radius="0.25"/>"#),
            K::RectRound {
                width: mm(2.0),
                height: mm(1.0),
                radius: mm(0.25),
                corners: all
            }
        );
        assert_eq!(
            primitive(
                r#"<RectCham width="2" height="1" chamfer="0.5" upperLeft="false" lowerRight="0"/>"#
            ),
            K::RectCham {
                width: mm(2.0),
                height: mm(1.0),
                chamfer: mm(0.5),
                corners: Corners {
                    upper_left: false,
                    lower_right: false,
                    ..all
                }
            }
        );
        assert_eq!(
            primitive(r#"<Oval width="2" height="1"/>"#),
            K::Oval {
                width: mm(2.0),
                height: mm(1.0)
            }
        );
        assert_eq!(
            primitive(r#"<Ellipse width="2" height="1"/>"#),
            K::Ellipse {
                width: mm(2.0),
                height: mm(1.0)
            }
        );
        assert_eq!(
            primitive(r#"<Diamond width="2" height="1"/>"#),
            K::Diamond {
                width: mm(2.0),
                height: mm(1.0)
            }
        );
        assert_eq!(
            primitive(r#"<Octagon length="2"/>"#),
            K::Octagon { length: mm(2.0) }
        );
        assert_eq!(
            primitive(r#"<Hexagon length="2"/>"#),
            K::Hexagon { length: mm(2.0) }
        );
        assert_eq!(
            primitive(
                r#"<Moire diameter="8.4" ringWidth="0.3" ringGap="0.6" ringNumber="5" lineWidth="0.3" lineLength="8.2" lineAngle="30"/>"#
            ),
            K::Moire(Moire {
                diameter: mm(8.4),
                ring_width: mm(0.3),
                ring_gap: mm(0.6),
                ring_number: 5,
                line_width: mm(0.3),
                line_length: Some(mm(8.2)),
                line_angle: 30.0,
            })
        );
        assert_eq!(
            primitive(r#"<Moire diameter="4" ringWidth="0.2" ringGap="0.5" ringNumber="3"/>"#),
            K::Moire(Moire {
                diameter: mm(4.0),
                ring_width: mm(0.2),
                ring_gap: mm(0.5),
                ring_number: 3,
                line_width: 0.0,
                line_length: None,
                line_angle: 0.0,
            })
        );
        assert_eq!(
            primitive(r#"<Triangle base="2" height="1"/>"#),
            K::Triangle {
                base: mm(2.0),
                height: mm(1.0)
            }
        );
        assert_eq!(
            primitive(r#"<Donut shape="SQUARE" outerDiameter="2" innerDiameter="1"/>"#),
            K::Donut {
                shape: RingShape::Square,
                outer_diameter: mm(2.0),
                inner_diameter: mm(1.0)
            }
        );
        assert_eq!(
            primitive(
                r#"<Thermal shape="ROUND" outerDiameter="2" innerDiameter="1" spokeCount="4" gap="0.25" spokeStartAngle="45"/>"#
            ),
            K::Thermal {
                shape: RingShape::Round,
                outer_diameter: mm(2.0),
                inner_diameter: mm(1.0),
                spoke_count: Some(4),
                gap: Some(mm(0.25)),
                spoke_start_angle: Some(45.0)
            }
        );
        assert_eq!(
            primitive(r#"<Butterfly shape="ROUND" diameter="2"/>"#),
            K::Butterfly {
                shape: ButterflyShape::Round,
                size: mm(2.0)
            }
        );
        assert_eq!(
            primitive(r#"<Butterfly shape="SQUARE" side="1"/>"#),
            K::Butterfly {
                shape: ButterflyShape::Square,
                size: mm(1.0)
            }
        );
        let K::Contour(contour) = primitive(
            r#"<Contour><Polygon><PolyBegin x="0" y="0"/><PolyStepSegment x="1" y="0"/><PolyStepSegment x="0" y="0"/></Polygon>
            <Cutout><PolyBegin x="0.1" y="0.1"/><PolyStepSegment x="0.2" y="0.1"/><PolyStepSegment x="0.1" y="0.1"/></Cutout></Contour>"#,
        ) else {
            panic!("not a contour")
        };
        assert_eq!(contour.polygon.path.steps.len(), 2);
        assert_eq!(contour.cutouts.len(), 1);
        assert_eq!(
            contour.cutouts[0].path.start,
            Point {
                x: mm(0.1),
                y: mm(0.1)
            }
        );
    }

    #[test]
    fn keeps_unsupported_primitives() {
        let d = standard(r#"<EntryStandard id="H"><Star points="5"/></EntryStandard>"#);
        assert_eq!(
            d.content.standard_primitives.get("H").unwrap().kind,
            PrimitiveKind::Unsupported {
                element: "Star".to_owned()
            }
        );
        assert_eq!(
            kinds(&d.diagnostics),
            [&DiagnosticKind::UnsupportedShape {
                element: "Star".to_owned()
            }]
        );
    }

    #[test]
    fn primitives_carry_line_and_fill() {
        let d = doc(
            "INCH",
            &format!(
                r#"{DICTIONARIES}<DictionaryStandard units="MILLIMETER"><EntryStandard id="X">
                <Circle diameter="1"><LineDescRef id="L"/><FillDesc fillProperty="HATCH" lineWidth="0.1" pitch1="0.5" angle1="45"/></Circle>
                </EntryStandard></DictionaryStandard>"#
            ),
            "",
        )
        .unwrap();
        assert_eq!(d.diagnostics, []);
        let x = d.content.standard_primitives.get("X").unwrap();
        let line = x.line.as_ref().unwrap();
        assert_eq!(line, &LineStyle::Ref("L".to_owned()));
        assert_eq!(
            d.content.line_desc(line),
            Some(&LineDesc {
                width: mm(0.2),
                end: LineEnd::Round,
                property: LineProperty::Solid,
            })
        );
        let fill = x.fill.as_ref().unwrap();
        assert_eq!(
            d.content.fill_desc(fill),
            Some(&FillDesc {
                property: FillProperty::Hatch,
                line_width: Some(mm(0.1)),
                pitch1: Some(mm(0.5)),
                pitch2: None,
                angle1: Some(45.0),
                angle2: None,
            })
        );
        assert!(matches!(fill, FillStyle::Desc(_)));
        assert_eq!(
            d.content
                .fill_desc(&FillStyle::Ref("F".to_owned()))
                .unwrap()
                .property,
            FillProperty::Fill
        );
        assert_eq!(
            d.content.line_desc(&LineStyle::Ref("nope".to_owned())),
            None
        );
    }

    #[test]
    fn primitives_carry_an_xform() {
        // Rev B allows an `Xform` in a standard primitive; Allegro 17.4 writes it in rev C
        // files. Its offset is in the dictionary's units.
        let d = doc(
            "INCH",
            &format!(
                r#"{DICTIONARIES}<DictionaryStandard units="MILLIMETER">
                <EntryStandard id="R"><RectCenter width="2" height="1"><Xform rotation="90"/><FillDescRef id="F"/></RectCenter></EntryStandard>
                <EntryStandard id="O"><Oval width="2" height="1"><LineDescRef id="L"/><Xform rotation="270" mirror="true" xOffset="0.5" yOffset="-0.25" scale="2"/></Oval></EntryStandard>
                <EntryStandard id="D"><Diamond width="2" height="1"><Xform rotation="45"/><Xform rotation="90"/></Diamond></EntryStandard>
                <EntryStandard id="P"><Circle diameter="1"/></EntryStandard>
                </DictionaryStandard>"#
            ),
            "",
        )
        .unwrap();
        let get = |id: &str| d.content.standard_primitives.get(id).unwrap();
        let r = get("R");
        assert_eq!(
            r.xform,
            Xform {
                rotation: 90.0,
                ..Xform::default()
            }
        );
        assert_eq!(r.fill, Some(FillStyle::Ref("F".to_owned())));
        let o = get("O");
        assert_eq!(
            o.xform,
            Xform {
                offset: Point {
                    x: mm(0.5),
                    y: -mm(0.25)
                },
                rotation: 270.0,
                mirror: true,
                scale: 2.0,
            }
        );
        assert_eq!(o.line, Some(LineStyle::Ref("L".to_owned())));
        // The first of two `Xform`s counts.
        assert_eq!(get("D").xform.rotation, 45.0);
        assert_eq!(get("P").xform, Xform::default());
        assert_eq!(
            kinds(&d.diagnostics),
            [&DiagnosticKind::DuplicateElement {
                element: "Xform".to_owned(),
                parent: "Diamond".to_owned()
            }]
        );
    }

    #[test]
    fn reads_user_primitives() {
        let d = doc(
            "INCH",
            &format!(
                r#"{DICTIONARIES}<DictionaryUser units="MILLIMETER">
                <EntryUser id="U"><UserSpecial>
                  <Line startX="0" startY="0" endX="1" endY="0"><LineDescRef id="L"/></Line>
                  <Arc startX="1" startY="0" endX="0" endY="1" centerX="0" centerY="0" clockwise="false"><LineDescRef id="L"/></Arc>
                  <Polyline><PolyBegin x="0" y="0"/><PolyStepSegment x="1" y="1"/><LineDescRef id="L"/></Polyline>
                  <Polygon><PolyBegin x="0" y="0"/><PolyStepSegment x="1" y="0"/><PolyStepSegment x="0" y="0"/><FillDescRef id="F"/></Polygon>
                  <Outline><Polygon><PolyBegin x="0" y="0"/><PolyStepSegment x="0" y="0"/></Polygon><LineDesc lineWidth="0.1" lineEnd="SQUARE" lineProperty="DASHED"/></Outline>
                  <Circle diameter="0.5"/>
                  <UserSpecial><StandardPrimitiveRef id="C"/></UserSpecial>
                </UserSpecial></EntryUser>
                <EntryUser id="V"><Line startX="0" startY="0" endX="1" endY="0"><LineDescRef id="L"/></Line></EntryUser>
                </DictionaryUser>"#
            ),
            "",
        )
        .unwrap();
        assert_eq!(d.diagnostics, []);
        let Some(Shape::UserSpecial(shapes)) = d.content.user_primitives.get("U") else {
            panic!("not a UserSpecial")
        };
        let names: Vec<_> = shapes
            .iter()
            .map(|s| match s {
                Shape::Line(_) => "Line",
                Shape::Arc(_) => "Arc",
                Shape::Polyline(_) => "Polyline",
                Shape::Polygon(_) => "Polygon",
                Shape::Outline(_) => "Outline",
                Shape::Standard(_) => "Standard",
                Shape::UserSpecial(_) => "UserSpecial",
                _ => "other",
            })
            .collect();
        assert_eq!(
            names,
            [
                "Line",
                "Arc",
                "Polyline",
                "Polygon",
                "Outline",
                "Standard",
                "UserSpecial"
            ]
        );
        let Shape::Outline(outline) = &shapes[4] else {
            unreachable!()
        };
        assert_eq!(
            outline.line,
            LineStyle::Desc(LineDesc {
                width: mm(0.1),
                end: LineEnd::Square,
                property: LineProperty::Dashed,
            })
        );
        assert!(matches!(
            d.content.user_primitives.get("V"),
            Some(Shape::Line(_))
        ));
    }

    #[test]
    fn reads_colors() {
        let d = doc(
            "INCH",
            r#"<DictionaryColor><EntryColor id="RED"><Color r="255" g="0" b="10"/></EntryColor></DictionaryColor>"#,
            "",
        )
        .unwrap();
        assert_eq!(
            d.content.colors.get("RED"),
            Some(&Color {
                r: 255,
                g: 0,
                b: 10
            })
        );
        let e = doc(
            "INCH",
            r#"<DictionaryColor><EntryColor id="X"><Color r="256" g="0" b="0"/></EntryColor></DictionaryColor>"#,
            "",
        )
        .unwrap_err();
        assert!(matches!(e.kind(), ErrorKind::InvalidValue { attribute, .. } if attribute == "r"));
    }

    #[test]
    fn duplicate_ids_keep_the_first_entry() {
        let d = standard(
            r#"<EntryStandard id="A"><Circle diameter="1"/></EntryStandard>
            <EntryStandard id="A"><Circle diameter="2"/></EntryStandard>"#,
        );
        assert_eq!(d.content.standard_primitives.len(), 2);
        assert_eq!(
            d.content.standard_primitives.get("A").unwrap().kind,
            PrimitiveKind::Circle { diameter: mm(1.0) }
        );
        assert_eq!(
            kinds(&d.diagnostics),
            [&DiagnosticKind::DuplicateKey {
                kind: RefKind::StandardPrimitive,
                key: "A".to_owned()
            }]
        );
    }

    #[test]
    fn entries_need_a_value() {
        let e = doc(
            "INCH",
            r#"<DictionaryLineDesc units="INCH"><EntryLineDesc id="L"/></DictionaryLineDesc>"#,
            "",
        )
        .unwrap_err();
        assert_eq!(
            e.kind(),
            &ErrorKind::MissingElement {
                element: "EntryLineDesc".to_owned(),
                expected: "`LineDesc`".to_owned()
            }
        );
    }

    #[test]
    fn forward_references_resolve() {
        let d = doc(
            "INCH",
            r#"<DictionaryStandard units="INCH"><EntryStandard id="C"><Circle diameter="1"><FillDescRef id="F"/></Circle></EntryStandard></DictionaryStandard>
            <DictionaryFillDesc units="INCH"><EntryFillDesc id="F"><FillDesc fillProperty="FILL"/></EntryFillDesc></DictionaryFillDesc>"#,
            "",
        )
        .unwrap();
        assert_eq!(d.diagnostics, []);
    }

    #[test]
    fn dangling_dictionary_references_are_warnings() {
        let d = doc(
            "INCH",
            r#"<DictionaryStandard units="INCH"><EntryStandard id="C"><Circle diameter="1"><FillDescRef id="NOPE"/></Circle></EntryStandard></DictionaryStandard>"#,
            "",
        )
        .unwrap();
        assert_eq!(
            kinds(&d.diagnostics),
            [&dangling(RefKind::FillDesc, "NOPE")]
        );
    }

    #[test]
    fn user_special_nesting_is_bounded() {
        let deep = format!(
            "{}{}",
            "<UserSpecial>".repeat(40),
            "</UserSpecial>".repeat(40)
        );
        let e = doc(
            "INCH",
            &format!(r#"<DictionaryUser units="INCH"><EntryUser id="U">{deep}</EntryUser></DictionaryUser>"#),
            "",
        )
        .unwrap_err();
        assert!(matches!(
            e.kind(),
            ErrorKind::NestingTooDeep { limit: 32, .. }
        ));
    }
}

mod layers {
    use super::*;
    use crate::{Polarity, Side, WhereMeasured};

    #[test]
    fn reads_layers() {
        let d = doc(
            "INCH",
            "",
            &format!(
                r#"{LAYERS}<Layer name="PLANE" layerFunction="PLANE" side="INTERNAL" polarity="NEGATIVE"/>"#
            ),
        )
        .unwrap();
        assert_eq!(d.diagnostics, []);
        let names: Vec<_> = d.ecad.layers.iter().map(|(name, _)| name).collect();
        assert_eq!(names, ["TOP", "BOTTOM", "DRILL", "PLANE"]);
        let top = d.ecad.layers.get("TOP").unwrap();
        assert_eq!(top.function, "CONDUCTOR");
        assert_eq!(top.side, Some(Side::Top));
        assert_eq!(top.polarity, Polarity::Positive);
        assert_eq!(top.span, None);
        let drill = d.ecad.layers.get("DRILL").unwrap();
        let span = drill.span.as_ref().unwrap();
        assert_eq!(
            (span.from_layer.as_str(), span.to_layer.as_str()),
            ("TOP", "BOTTOM")
        );
        let plane = d.ecad.layers.get("PLANE").unwrap();
        assert_eq!(plane.side, Some(Side::Internal));
        assert_eq!(plane.polarity, Polarity::Negative);
    }

    #[test]
    fn reports_duplicate_layer_names() {
        let d = doc(
            "INCH",
            "",
            r#"<Layer name="A" layerFunction="SIGNAL"/><Layer name="A" layerFunction="PLANE"/>"#,
        )
        .unwrap();
        assert_eq!(d.ecad.layers.get("A").unwrap().function, "SIGNAL");
        assert_eq!(
            kinds(&d.diagnostics),
            [&DiagnosticKind::DuplicateKey {
                kind: RefKind::Layer,
                key: "A".to_owned()
            }]
        );
    }

    #[test]
    fn reads_stackups() {
        let d = doc(
            "MILLIMETER",
            "",
            &format!(
                r#"{LAYERS}<Layer name="CORE" layerFunction="DIELCORE"/>
                <Stackup name="PRIMARY" overallThickness="1.6" tolPlus="0.1" tolMinus="0.1" whereMeasured="METAL">
                  <StackupGroup name="G" thickness="1.6">
                    <StackupLayer layerOrGroupRef="TOP" thickness="0.035" sequence="1"/>
                    <StackupLayer layerOrGroupRef="CORE" thickness="1.53" sequence="2" tolPlus="0.05" tolMinus="0.05"/>
                    <StackupLayer layerOrGroupRef="BOTTOM" thickness="0.035" sequence="3"/>
                  </StackupGroup>
                  <StackupGroup name="OUTER"><StackupLayer layerOrGroupRef="G"/></StackupGroup>
                </Stackup>"#
            ),
        )
        .unwrap();
        assert_eq!(d.diagnostics, []);
        let [stackup] = d.ecad.stackups.as_slice() else {
            panic!()
        };
        assert_eq!(stackup.name, "PRIMARY");
        assert_close(stackup.overall_thickness.unwrap(), mm(1.6));
        assert_close(stackup.tol_plus.unwrap(), mm(0.1));
        assert_eq!(stackup.where_measured, Some(WhereMeasured::Metal));
        let group = &stackup.groups[0];
        assert_eq!(group.name, "G");
        assert_close(group.thickness.unwrap(), mm(1.6));
        let refs: Vec<_> = group
            .layers
            .iter()
            .map(|l| (l.layer_or_group_ref.as_str(), l.sequence))
            .collect();
        assert_eq!(
            refs,
            [("TOP", Some(1)), ("CORE", Some(2)), ("BOTTOM", Some(3))]
        );
        assert_close(group.layers[1].thickness.unwrap(), mm(1.53));
        assert_close(group.layers[1].tol_minus.unwrap(), mm(0.05));
        assert_eq!(stackup.groups[1].layers[0].thickness, None);
    }

    #[test]
    fn stackup_references_are_checked() {
        let d = doc(
            "INCH",
            "",
            r#"<Stackup name="S"><StackupGroup name="G"><StackupLayer layerOrGroupRef="NOPE"/></StackupGroup></Stackup>"#,
        )
        .unwrap();
        assert_eq!(
            kinds(&d.diagnostics),
            [&dangling(RefKind::LayerOrGroup, "NOPE")]
        );
    }

    /// Polar Speedstack and Altium write `<Stackup>` without `name`.
    #[test]
    fn stackup_without_name_gets_a_default() {
        let d = doc(
            "INCH",
            "",
            r#"<Stackup overallThickness="0.0632"><StackupGroup name="G"/></Stackup>"#,
        )
        .unwrap();
        let stackup = &d.ecad.stackups[0];
        assert_eq!(stackup.name, "(unnamed)");
        assert_eq!(stackup.groups.len(), 1);
        assert_eq!(
            kinds(&d.diagnostics),
            [&DiagnosticKind::MissingAttribute {
                element: "Stackup".to_owned(),
                attribute: "name".to_owned(),
                default: "(unnamed)".to_owned(),
            }]
        );
        assert_eq!(
            d.diagnostics[0].kind.to_string(),
            "element `Stackup` is missing attribute `name`; using `(unnamed)`"
        );
    }

    /// Revision A (Altium) names each stack-up layer's material.
    #[test]
    fn reads_stackup_material_types() {
        let d = doc(
            "MILLIMETER",
            "",
            &format!(
                r#"{LAYERS}<Stackup><StackupGroup name="G">
                  <StackupLayer layerOrGroupRef="TOP" materialType="Copper" thickness="0.035"/>
                  <StackupLayer layerOrGroupRef="BOTTOM"/>
                </StackupGroup></Stackup>"#
            ),
        )
        .unwrap();
        let layers = &d.ecad.stackups[0].groups[0].layers;
        assert_eq!(layers[0].material_type.as_deref(), Some("Copper"));
        assert_eq!(layers[1].material_type, None);
        // Only the missing stack-up name is reported, not `materialType`.
        assert_eq!(d.diagnostics.len(), 1);
    }

    #[test]
    fn content_layer_and_step_references_are_checked() {
        let d = doc("INCH", r#"<StepRef name="X"/><LayerRef name="Y"/>"#, "").unwrap();
        assert_eq!(
            kinds(&d.diagnostics),
            [
                &dangling(RefKind::Step, "X"),
                &dangling(RefKind::Layer, "Y")
            ]
        );
    }
}

mod step {
    use super::*;
    use crate::{
        FeatureElement, FillStyle, LineStyle, MountType, PadUse, PlatingStatus, Point, PolyStep,
        PrimitiveKind, Shape, Xform,
    };

    #[test]
    fn reads_datum_and_profile() {
        let s = step(
            r#"<Datum x="1" y="2"/>
            <Profile><Polygon><PolyBegin x="0" y="0"/><PolyStepSegment x="10" y="0"/>
              <PolyStepCurve x="10" y="10" centerX="10" centerY="5" clockwise="true"/><PolyStepSegment x="0" y="0"/></Polygon>
              <Cutout><PolyBegin x="1" y="1"/><PolyStepSegment x="2" y="1"/><PolyStepSegment x="1" y="1"/></Cutout>
              <Cutout><PolyBegin x="5" y="5"/><PolyStepSegment x="6" y="5"/><PolyStepSegment x="5" y="5"/></Cutout></Profile>"#,
        );
        assert_eq!(
            s.datum,
            Some(Point {
                x: mm(1.0),
                y: mm(2.0)
            })
        );
        let profile = s.profile.unwrap();
        assert_eq!(profile.polygon.path.start, Point::default());
        assert_eq!(
            profile.polygon.path.steps[1],
            PolyStep::Curve {
                to: Point {
                    x: mm(10.0),
                    y: mm(10.0)
                },
                center: Point {
                    x: mm(10.0),
                    y: mm(5.0)
                },
                clockwise: true
            }
        );
        assert_eq!(profile.cutouts.len(), 2);
    }

    #[test]
    fn polygons_carry_an_xform() {
        // Rev B and C allow an `Xform` after the steps of a `Polygon` and of a `Cutout` (also
        // a `PolygonType`), wherever they are: a profile, a contour, an outline, a feature.
        let square = r#"<PolyBegin x="0" y="0"/><PolyStepSegment x="1" y="0"/><PolyStepSegment x="1" y="1"/><PolyStepSegment x="0" y="0"/>"#;
        let d = step_doc(&format!(
            r#"<Profile><Polygon>{square}<Xform rotation="90" xOffset="0.5"/><LineDescRef id="L"/></Polygon>
              <Cutout>{square}<Xform mirror="true" yOffset="-0.25" scale="2"/><FillDescRef id="F"/></Cutout>
              <Cutout>{square}<Xform rotation="45"/><Xform rotation="90"/></Cutout></Profile>
            <Package name="P"><Outline><Polygon>{square}<Xform rotation="30"/></Polygon><LineDescRef id="L"/></Outline></Package>
            <LayerFeature layerRef="TOP"><Set><Features><Polygon>{square}<Xform rotation="270"/></Polygon></Features>
              <Features><Contour><Polygon>{square}</Polygon><Cutout>{square}<Xform rotation="180"/></Cutout></Contour></Features></Set></LayerFeature>"#
        ))
        .unwrap();
        // The first of two `Xform`s counts.
        assert_eq!(
            kinds(&d.diagnostics),
            [&DiagnosticKind::DuplicateElement {
                element: "Xform".to_owned(),
                parent: "Cutout".to_owned()
            }]
        );
        let s = d.ecad.steps.get("S").unwrap();
        let profile = s.profile.as_ref().unwrap();
        assert_eq!(
            profile.polygon.xform,
            Xform {
                offset: Point { x: mm(0.5), y: 0.0 },
                rotation: 90.0,
                ..Xform::default()
            }
        );
        assert_eq!(profile.polygon.line, Some(LineStyle::Ref("L".to_owned())));
        assert_eq!(
            profile.cutouts[0].xform,
            Xform {
                offset: Point {
                    x: 0.0,
                    y: -mm(0.25)
                },
                mirror: true,
                scale: 2.0,
                ..Xform::default()
            }
        );
        // A cutout may have a stroke and a fill like any polygon.
        assert_eq!(
            profile.cutouts[0].fill,
            Some(FillStyle::Ref("F".to_owned()))
        );
        assert_eq!(profile.cutouts[1].xform.rotation, 45.0);
        let outline = s.packages.get("P").unwrap().outline.as_ref().unwrap();
        assert_eq!(outline.polygon.xform.rotation, 30.0);
        let features = &s.layer_features.get("TOP").unwrap().sets[0].features;
        let shape = |i: usize| match &features[i].element {
            FeatureElement::Features(f) => &f.shape,
            _ => panic!("not Features"),
        };
        let Shape::Polygon(polygon) = shape(0) else {
            panic!("not a polygon")
        };
        assert_eq!(polygon.xform.rotation, 270.0);
        let Shape::Standard(p) = shape(1) else {
            panic!("not a primitive")
        };
        let PrimitiveKind::Contour(contour) = &p.kind else {
            panic!("not a contour")
        };
        assert_eq!(contour.polygon.xform, Xform::default());
        assert_eq!(contour.cutouts[0].xform.rotation, 180.0);
    }

    #[test]
    fn reads_padstack_definitions() {
        let s = step(
            r#"<PadStackDef name="VIA1">
              <PadstackHoleDef name="H" diameter="0.3" platingStatus="VIA" plusTol="0.01" minusTol="0.02" x="0" y="0"/>
              <PadstackPadDef layerRef="TOP" padUse="REGULAR"><Location x="0" y="0"/><StandardPrimitiveRef id="C"/></PadstackPadDef>
              <PadstackPadDef layerRef="BOTTOM" padUse="ANTIPAD"><Xform rotation="45"/><Location x="0.5" y="0"/><Circle diameter="0.8"/></PadstackPadDef>
            </PadStackDef>"#,
        );
        let def = s.padstack_defs.get("VIA1").unwrap();
        let hole = def.hole.as_ref().unwrap();
        assert_eq!(hole.plating, PlatingStatus::Via);
        assert_close(hole.diameter, mm(0.3));
        assert_close(hole.plus_tol, mm(0.01));
        assert_close(hole.minus_tol, mm(0.02));
        assert_eq!(def.pads.len(), 2);
        assert_eq!(def.pads[0].layer_ref, "TOP");
        assert_eq!(def.pads[0].pad_use, PadUse::Regular);
        assert_eq!(def.pads[0].shape, Some(Shape::StandardRef("C".to_owned())));
        assert_eq!(def.pads[1].pad_use, PadUse::Antipad);
        assert_eq!(def.pads[1].xform.rotation, 45.0);
        assert_eq!(def.pads[1].location, Point { x: mm(0.5), y: 0.0 });
        assert!(matches!(
            &def.pads[1].shape,
            Some(Shape::Standard(p)) if p.kind == PrimitiveKind::Circle { diameter: mm(0.8) }
        ));
    }

    /// Revision A and B `PadStack`s, as Altium writes them: a via with its hole and a
    /// component pad on several layers.
    #[test]
    fn reads_pad_stacks() {
        let s = step(
            r#"<PadStack net="GND">
              <LayerHole name="Via_1" diameter="0.7" platingStatus="VIA" plusTol="0" minusTol="0" x="1" y="2">
                <Span fromLayer="TOP" toLayer="BOTTOM"/>
              </LayerHole>
              <LayerPad layerRef="TOP"><Location x="1" y="2"/><StandardPrimitiveRef id="C"/></LayerPad>
              <LayerPad layerRef="BOTTOM"><Location x="1" y="2"/><Circle diameter="0.8"/></LayerPad>
            </PadStack>
            <PadStack>
              <LayerPad layerRef="TOP"><Xform rotation="270"/><Location x="3" y="4"/><StandardPrimitiveRef id="C"/><PinRef componentRef="U1" pin="1"/></LayerPad>
            </PadStack>
            <Package name="P"><Pin number="1"/></Package>
            <Component refDes="U1" packageRef="P" layerRef="TOP"/>"#,
        );
        let [via, pad] = s.pad_stacks.as_slice() else {
            panic!()
        };
        assert_eq!(via.net.as_deref(), Some("GND"));
        let hole = via.hole.as_ref().unwrap();
        assert_eq!(hole.hole.name, "Via_1");
        assert_eq!(hole.hole.plating, PlatingStatus::Via);
        assert_close(hole.hole.diameter, mm(0.7));
        assert_eq!(
            hole.hole.position,
            Point {
                x: mm(1.0),
                y: mm(2.0)
            }
        );
        let span = hole.span.as_ref().unwrap();
        assert_eq!(
            (span.from_layer.as_str(), span.to_layer.as_str()),
            ("TOP", "BOTTOM")
        );
        let layers: Vec<_> = via.pads.iter().map(|p| p.layer_ref.as_str()).collect();
        assert_eq!(layers, ["TOP", "BOTTOM"]);
        assert_eq!(via.pads[0].shape, Shape::StandardRef("C".to_owned()));
        assert!(via.pads.iter().all(|p| p.pin_ref.is_none()));
        assert_eq!(pad.net, None);
        assert_eq!(pad.hole, None);
        let [pad] = pad.pads.as_slice() else { panic!() };
        assert_eq!(pad.xform.rotation, 270.0);
        assert_eq!(
            pad.location,
            Point {
                x: mm(3.0),
                y: mm(4.0)
            }
        );
        let pin = pad.pin_ref.as_ref().unwrap();
        assert_eq!(
            (pin.component_ref.as_deref(), pin.pin.as_str()),
            (Some("U1"), "1")
        );
    }

    #[test]
    fn checks_pad_stack_references() {
        let d = step_doc(
            r#"<PadStack>
              <LayerHole name="H" diameter="0.3" platingStatus="PLATED" plusTol="0" minusTol="0" x="0" y="0"><Span fromLayer="TOP" toLayer="L9"/></LayerHole>
              <LayerHole name="H2" diameter="0.3" platingStatus="PLATED" plusTol="0" minusTol="0" x="0" y="0"/>
              <LayerPad layerRef="NOPE"><Location x="0" y="0"/><StandardPrimitiveRef id="C"/><PinRef componentRef="U1" pin="1"/><PinRef componentRef="U1" pin="2"/></LayerPad>
            </PadStack>"#,
        )
        .unwrap();
        assert_eq!(
            kinds(&d.diagnostics),
            [
                &DiagnosticKind::DuplicateElement {
                    element: "LayerHole".to_owned(),
                    parent: "PadStack".to_owned()
                },
                &DiagnosticKind::DuplicateElement {
                    element: "PinRef".to_owned(),
                    parent: "LayerPad".to_owned()
                },
                &dangling(RefKind::Component, "U1"),
                &dangling(RefKind::Layer, "L9"),
                &dangling(RefKind::Layer, "NOPE"),
            ]
        );
        let s = d.ecad.steps.get("S").unwrap();
        assert_eq!(s.pad_stacks[0].pads[0].pin_ref.as_ref().unwrap().pin, "1");
    }

    #[test]
    fn a_layer_pad_needs_a_shape() {
        let e = step_doc(
            r#"<PadStack><LayerPad layerRef="TOP"><Location x="0" y="0"/></LayerPad></PadStack>"#,
        )
        .unwrap_err();
        assert_eq!(
            e.kind(),
            &ErrorKind::MissingElement {
                element: "LayerPad".to_owned(),
                expected: "a shape".to_owned()
            }
        );
    }

    const PACKAGE: &str = r#"<Package name="SOIC8" type="SOIC" pinOne="1" height="1.75">
      <Outline><Polygon><PolyBegin x="-2" y="-2"/><PolyStepSegment x="2" y="-2"/><PolyStepSegment x="-2" y="-2"/></Polygon><LineDescRef id="L"/></Outline>
      <Pin number="1" name="VCC"><Location x="-1.9" y="1.27"/><StandardPrimitiveRef id="C"/></Pin>
      <Pin number="2"><Xform rotation="90" mirror="true"/><Location x="-1.9" y="0.635"/></Pin>
      <SilkScreen>
        <Outline><Polygon><PolyBegin x="0" y="0"/><PolyStepSegment x="0" y="0"/></Polygon><LineDescRef id="L"/></Outline>
        <Marking markingUsage="POLARITY_MARKING"><Location x="-2.5" y="1.5"/><Circle diameter="0.3"/></Marking>
      </SilkScreen>
      <AssemblyDrawing>
        <Outline><Polygon><PolyBegin x="0" y="0"/><PolyStepSegment x="0" y="0"/></Polygon><LineDescRef id="L"/></Outline>
      </AssemblyDrawing>
    </Package>"#;

    #[test]
    fn reads_packages() {
        let s = step(PACKAGE);
        let p = s.packages.get("SOIC8").unwrap();
        assert_eq!(p.package_type.as_deref(), Some("SOIC"));
        assert_eq!(p.pin_one.as_deref(), Some("1"));
        assert_close(p.height.unwrap(), mm(1.75));
        let outline = p.outline.as_ref().unwrap();
        assert_eq!(outline.line, LineStyle::Ref("L".to_owned()));
        assert_eq!(
            outline.polygon.path.start,
            Point {
                x: -mm(2.0),
                y: -mm(2.0)
            }
        );
        let pin1 = p.pins.get("1").unwrap();
        assert_eq!(pin1.name.as_deref(), Some("VCC"));
        assert_eq!(
            pin1.location,
            Point {
                x: -mm(1.9),
                y: mm(1.27)
            }
        );
        assert_eq!(pin1.xform, Xform::default());
        assert_eq!(pin1.shape, Some(Shape::StandardRef("C".to_owned())));
        let pin2 = p.pins.get("2").unwrap();
        assert_eq!(pin2.name, None);
        assert!(pin2.xform.mirror);
        assert_eq!(pin2.shape, None);
        let silk = p.silkscreen.as_ref().unwrap();
        assert_eq!(silk.outlines.len(), 1);
        assert_eq!(silk.markings[0].usage.as_deref(), Some("POLARITY_MARKING"));
        assert_eq!(
            silk.markings[0].location,
            Point {
                x: -mm(2.5),
                y: mm(1.5)
            }
        );
        assert!(matches!(silk.markings[0].shape, Shape::Standard(_)));
        assert_eq!(p.assembly_drawing.as_ref().unwrap().outlines.len(), 1);
    }

    #[test]
    fn checks_pin_one() {
        let d = step_doc(r#"<Package name="P" pinOne="9"><Pin number="1"/></Package>"#).unwrap();
        assert_eq!(kinds(&d.diagnostics), [&dangling(RefKind::Pin, "P/9")]);
        // KiCad says `pinOne="UNKNOWN"` when no pad is numbered like a pin 1: in pin-less
        // footprints (logos) and in mounting holes, fiducials, USB-C sockets. Not given, unless
        // a pin is numbered so. Only KiCad's exact spelling: `unknown` is a pin number.
        let d = step_doc(
            r#"<Package name="LOGO" pinOne="UNKNOWN"/>
            <Package name="NPTH" pinOne="UNKNOWN"><Pin number="NPTH0"/></Package>
            <Package name="ODD" pinOne="UNKNOWN"><Pin number="UNKNOWN"/><Pin number="2"/></Package>
            <Package name="LOWER" pinOne="unknown"><Pin number="1"/></Package>"#,
        )
        .unwrap();
        assert_eq!(
            kinds(&d.diagnostics),
            [&dangling(RefKind::Pin, "LOWER/unknown")]
        );
        let packages = &d.ecad.steps.get("S").unwrap().packages;
        let pin_one = |name: &str| packages.get(name).unwrap().pin_one.as_deref();
        assert_eq!(pin_one("LOGO"), None);
        assert_eq!(pin_one("NPTH"), None);
        assert_eq!(pin_one("ODD"), Some("UNKNOWN"));
        assert_eq!(pin_one("LOWER"), Some("unknown"));
    }

    #[test]
    fn reads_components() {
        let s = step(&format!(
            r#"{PACKAGE}<Component refDes="U1" packageRef="SOIC8" layerRef="BOTTOM" part="LM358" mountType="SMT" standoff="0.1" height="1.75">
              <Xform rotation="180" mirror="true" xOffset="0.5" yOffset="-0.5" scale="2"/><Location x="10" y="20"/>
            </Component>
            <Component refDes="J1" packageRef="SOIC8" layerRef="TOP" mountType="THMT"/>"#
        ));
        let names: Vec<_> = s.components.iter().map(|(k, _)| k).collect();
        assert_eq!(names, ["U1", "J1"]);
        let u1 = s.components.get("U1").unwrap();
        assert_eq!(u1.package_ref, "SOIC8");
        assert_eq!(u1.layer_ref, "BOTTOM");
        assert_eq!(u1.part.as_deref(), Some("LM358"));
        assert_eq!(u1.mount_type, Some(MountType::Smt));
        assert_close(u1.standoff.unwrap(), mm(0.1));
        assert_close(u1.height.unwrap(), mm(1.75));
        assert_eq!(
            u1.location,
            Point {
                x: mm(10.0),
                y: mm(20.0)
            }
        );
        assert_eq!(
            u1.xform,
            Xform {
                offset: Point {
                    x: mm(0.5),
                    y: -mm(0.5)
                },
                rotation: 180.0,
                mirror: true,
                scale: 2.0
            }
        );
        let j1 = s.components.get("J1").unwrap();
        assert_eq!(j1.mount_type, Some(MountType::Thmt));
        assert_eq!(j1.location, Point::default());
        assert_eq!(j1.part, None);
    }

    #[test]
    fn checks_component_references() {
        let d = step_doc(
            r#"<Component refDes="U1" packageRef="NOPE" layerRef="INNER"/>
            <Component refDes="U1" packageRef="LATE" layerRef="TOP"/>
            <Package name="LATE"/>"#,
        )
        .unwrap();
        assert_eq!(
            kinds(&d.diagnostics),
            [
                &DiagnosticKind::DuplicateKey {
                    kind: RefKind::Component,
                    key: "U1".to_owned()
                },
                &dangling(RefKind::Package, "NOPE"),
                &dangling(RefKind::Layer, "INNER"),
            ]
        );
    }

    #[test]
    fn rejects_unknown_enum_values() {
        let e =
            step_doc(r#"<Component refDes="U1" packageRef="P" layerRef="TOP" mountType="GLUE"/>"#)
                .unwrap_err();
        assert!(matches!(e.kind(), ErrorKind::InvalidValue { value, .. } if value == "GLUE"));
    }
}

mod step_repeat {
    use super::*;
    use crate::{Point, StepRepeat};

    /// Parses steps `B` (a board) and `P` (a panel with `repeats`), in inches.
    fn panel(repeats: &str) -> Document {
        doc(
            "INCH",
            "",
            &format!(
                r#"{LAYERS}<Step name="B"/><Step name="P"><Datum x="0" y="0"/>{repeats}</Step>"#
            ),
        )
        .unwrap()
    }

    #[test]
    fn reads_all_attributes_in_metres() {
        let d = panel(
            r#"<StepRepeat stepRef="B" x="1" y="2" nx="2" ny="3" dx="1.5" dy="-0.5" angle="90.00" mirror="true"/>"#,
        );
        assert_eq!(d.diagnostics, []);
        let p = d.ecad.steps.get("P").unwrap();
        assert_eq!(
            p.step_repeats,
            [StepRepeat {
                step_ref: "B".into(),
                location: Point {
                    x: 0.0254,
                    y: 0.0508
                },
                nx: 2,
                ny: 3,
                dx: 1.5 * 0.0254,
                dy: -0.5 * 0.0254,
                angle: 90.0,
                mirror: true,
            }]
        );
        assert!(d.ecad.steps.get("B").unwrap().step_repeats.is_empty());
    }

    #[test]
    fn optional_attributes_default_to_a_single_unrotated_copy() {
        let d = panel(
            r#"<StepRepeat stepRef="B" x="0" y="0"/><StepRepeat stepRef="B" x="3" y="0" angle="180"/>"#,
        );
        let repeats = &d.ecad.steps.get("P").unwrap().step_repeats;
        assert_eq!(repeats.len(), 2, "kept in document order");
        let r = &repeats[0];
        assert_eq!(
            (r.nx, r.ny, r.dx, r.dy, r.angle, r.mirror),
            (1, 1, 0.0, 0.0, 0.0, false)
        );
        assert_eq!(repeats[1].angle, 180.0);
    }

    #[test]
    fn references_to_later_steps_resolve_and_unknown_steps_are_reported() {
        let d = doc(
            "MILLIMETER",
            "",
            &format!(
                r#"{LAYERS}<Step name="P"><StepRepeat stepRef="B" x="0" y="0"/><StepRepeat stepRef="NOPE" x="0" y="0"/></Step><Step name="B"/>"#
            ),
        )
        .unwrap();
        assert_eq!(kinds(&d.diagnostics), [&dangling(RefKind::Step, "NOPE")]);
        assert_eq!(d.ecad.steps.get("P").unwrap().step_repeats.len(), 2);
    }

    #[test]
    fn requires_step_ref_and_position() {
        let e = panel_err(r#"<StepRepeat x="0" y="0"/>"#);
        assert!(
            matches!(e.kind(), ErrorKind::MissingAttribute { attribute, .. } if attribute == "stepRef")
        );
        let e = panel_err(r#"<StepRepeat stepRef="B" x="0"/>"#);
        assert!(
            matches!(e.kind(), ErrorKind::MissingAttribute { attribute, .. } if attribute == "y")
        );
        let e = panel_err(r#"<StepRepeat stepRef="B" x="0" y="0" nx="-1"/>"#);
        assert!(matches!(e.kind(), ErrorKind::InvalidValue { value, .. } if value == "-1"));
    }

    fn panel_err(repeats: &str) -> Error {
        doc(
            "MILLIMETER",
            "",
            &format!(r#"{LAYERS}<Step name="B"/><Step name="P">{repeats}</Step>"#),
        )
        .unwrap_err()
    }
}

mod features {
    use super::*;
    use crate::{
        Feature, FeatureElement, FiducialKind, LineEnd, PadUsage, PinRef, PlatingStatus, Point,
        Polarity, PolyStep, PrimitiveKind, Shape,
    };

    /// Features of one set on layer `TOP`, in a step with component `U1` (package `P`, pin 1).
    fn layer(features: &str) -> Vec<Feature> {
        let s = step(&format!(
            r#"<Package name="P"><Pin number="1"/></Package><Component refDes="U1" packageRef="P" layerRef="TOP"/>
            <LayerFeature layerRef="TOP"><Set>{features}</Set></LayerFeature>"#
        ));
        s.layer_features.get("TOP").unwrap().sets[0]
            .features
            .clone()
    }

    fn shape(xml: &str) -> Shape {
        let [feature] = layer(&format!(
            r#"<Features><Location x="1" y="2"/>{xml}</Features>"#
        ))
        .try_into()
        .unwrap();
        let FeatureElement::Features(features) = feature.element else {
            panic!("not Features")
        };
        assert_eq!(
            features.location,
            Point {
                x: mm(1.0),
                y: mm(2.0)
            }
        );
        features.shape
    }

    #[test]
    fn reads_set_attributes() {
        let s = step(
            r#"<Package name="P"/><Component refDes="U1" packageRef="P" layerRef="TOP"/>
            <LayerFeature layerRef="TOP">
              <Set net="GND" polarity="NEGATIVE" padUsage="TERMINATION" testPoint="true" geometry="PAD1" geometryUsage="TEXT" plate="true" componentRef="U1"/>
              <Set/>
            </LayerFeature>"#,
        );
        let lf = s.layer_features.get("TOP").unwrap();
        let set = &lf.sets[0];
        assert_eq!(set.net.as_deref(), Some("GND"));
        assert_eq!(set.polarity, Polarity::Negative);
        assert_eq!(set.pad_usage, Some(PadUsage::Termination));
        assert!(set.test_point);
        assert_eq!(set.geometry.as_deref(), Some("PAD1"));
        assert_eq!(set.geometry_usage.as_deref(), Some("TEXT"));
        assert!(set.plate);
        assert_eq!(set.component_ref.as_deref(), Some("U1"));
        let empty = &lf.sets[1];
        assert_eq!(empty.polarity, Polarity::Positive);
        assert!(!empty.test_point && !empty.plate);
        assert_eq!(empty.pad_usage, None);
    }

    #[test]
    fn reads_set_colors() {
        let d = doc(
            "INCH",
            r#"<DictionaryColor><EntryColor id="RED"><Color r="255" g="0" b="0"/></EntryColor></DictionaryColor>"#,
            &format!(
                r#"{LAYERS}<Step name="S"><LayerFeature layerRef="TOP"><Set><ColorRef id="RED"/></Set><Set><ColorRef id="BLUE"/></Set></LayerFeature></Step>"#
            ),
        )
        .unwrap();
        let lf = d
            .ecad
            .steps
            .get("S")
            .unwrap()
            .layer_features
            .get("TOP")
            .unwrap();
        assert_eq!(lf.sets[0].color_ref.as_deref(), Some("RED"));
        assert_eq!(lf.feature_count(), 0);
        assert_eq!(kinds(&d.diagnostics), [&dangling(RefKind::Color, "BLUE")]);
    }

    #[test]
    fn numbers_features_in_document_order_per_layer() {
        let d = step_doc(
            r#"<LayerFeature layerRef="TOP">
              <Set><ColorRef id="X"/><Pad><StandardPrimitiveRef id="C"/></Pad><NonstandardAttribute name="a" value="b" type="STRING"/>
                <Features><Circle diameter="1"/></Features><Pad><StandardPrimitiveRef id="C"/></Pad></Set>
              <Set><Hole name="H" diameter="1" platingStatus="PLATED" plusTol="0" minusTol="0" x="0" y="0"/>
                <SlotCavity name="S" platingStatus="NONPLATED" plusTol="0" minusTol="0"><Circle diameter="1"/></SlotCavity>
                <GlobalFiducial><Location x="0" y="0"/><StandardPrimitiveRef id="C"/></GlobalFiducial></Set>
            </LayerFeature>
            <LayerFeature layerRef="BOTTOM"><Set><Pad><StandardPrimitiveRef id="C"/></Pad></Set></LayerFeature>
            <LayerFeature layerRef="TOP"><Set><Features><Circle diameter="1"/></Features></Set></LayerFeature>"#,
        )
        .unwrap();
        let s = d.ecad.steps.get("S").unwrap();
        let top = s.layer_features.get("TOP").unwrap();
        assert_eq!(s.layer_features.len(), 2, "repeated LayerFeature merges");
        let sources: Vec<_> = top
            .features()
            .map(|(_, f)| {
                let kind = match f.element {
                    FeatureElement::Pad(_) => "Pad",
                    FeatureElement::Features(_) => "Features",
                    FeatureElement::Fiducial(_) => "Fiducial",
                    FeatureElement::Hole(_) => "Hole",
                    FeatureElement::SlotCavity(_) => "SlotCavity",
                };
                (f.source, kind)
            })
            .collect();
        assert_eq!(
            sources,
            [
                (0, "Pad"),
                (1, "Features"),
                (2, "Pad"),
                (3, "Hole"),
                (4, "SlotCavity"),
                (5, "Fiducial"),
                (6, "Features")
            ]
        );
        assert_eq!(top.feature_count(), 7);
        let bottom = s.layer_features.get("BOTTOM").unwrap();
        assert_eq!(bottom.features().next().unwrap().1.source, 0);
    }

    #[test]
    fn reads_fiducials() {
        let features = layer(
            r#"<GlobalFiducial><Xform rotation="45"/><Location x="1" y="2"/><Circle diameter="1"/></GlobalFiducial>
            <LocalFiducial><Location x="3" y="4"/><StandardPrimitiveRef id="C"/></LocalFiducial>
            <BadBoardMark><Location x="0" y="0"/><Hexagon length="2"/></BadBoardMark>
            <GoodPanelMark><StandardPrimitiveRef id="C"/></GoodPanelMark>"#,
        );
        let fiducials: Vec<_> = features
            .iter()
            .map(|f| match &f.element {
                FeatureElement::Fiducial(fiducial) => fiducial,
                other => panic!("not a fiducial: {other:?}"),
            })
            .collect();
        assert_eq!(
            fiducials.iter().map(|f| f.kind).collect::<Vec<_>>(),
            [
                FiducialKind::Global,
                FiducialKind::Local,
                FiducialKind::BadBoard,
                FiducialKind::GoodPanel
            ]
        );
        assert_eq!(
            fiducials[0].location,
            Point {
                x: mm(1.0),
                y: mm(2.0)
            }
        );
        assert_eq!(fiducials[0].xform.rotation, 45.0);
        assert!(matches!(
            &fiducials[0].shape,
            Shape::Standard(p) if p.kind == PrimitiveKind::Circle { diameter: mm(1.0) }
        ));
        assert_eq!(fiducials[1].shape, Shape::StandardRef("C".to_owned()));
        assert!(matches!(
            &fiducials[2].shape,
            Shape::Standard(p) if p.kind == PrimitiveKind::Hexagon { length: mm(2.0) }
        ));
        assert_eq!(fiducials[3].location, Point::default());
        let e = step_doc(
            r#"<LayerFeature layerRef="TOP"><Set><LocalFiducial><Location x="0" y="0"/></LocalFiducial></Set></LayerFeature>"#,
        )
        .unwrap_err();
        assert!(matches!(e.kind(), ErrorKind::MissingElement { .. }), "{e}");
    }

    #[test]
    fn reads_feature_shapes() {
        let Shape::Line(line) = shape(
            r#"<Line startX="0" startY="0" endX="1" endY="0"><LineDesc lineWidth="0.1" lineEnd="NONE"/></Line>"#,
        ) else {
            panic!()
        };
        assert_eq!(line.end, Point { x: mm(1.0), y: 0.0 });
        let Shape::Arc(arc) = shape(
            r#"<Arc startX="1" startY="0" endX="-1" endY="0" centerX="0" centerY="0" clockwise="true"><LineDescRef id="L"/></Arc>"#,
        ) else {
            panic!()
        };
        assert!(arc.clockwise);
        assert_eq!(arc.center, Point::default());
        let Shape::Polyline(polyline) = shape(
            r#"<Polyline><PolyBegin x="0" y="0"/><PolyStepSegment x="1" y="0"/>
            <PolyStepCurve x="1" y="2" centerX="1" centerY="1" clockwise="false"/><LineDescRef id="L"/></Polyline>"#,
        ) else {
            panic!()
        };
        assert_eq!(
            polyline.path.steps,
            [
                PolyStep::Segment {
                    to: Point { x: mm(1.0), y: 0.0 }
                },
                PolyStep::Curve {
                    to: Point {
                        x: mm(1.0),
                        y: mm(2.0)
                    },
                    center: Point {
                        x: mm(1.0),
                        y: mm(1.0)
                    },
                    clockwise: false
                }
            ]
        );
        let Shape::Polygon(polygon) = shape(
            r#"<Polygon><PolyBegin x="0" y="0"/><PolyStepSegment x="1" y="0"/><PolyStepSegment x="0" y="0"/><FillDescRef id="F"/></Polygon>"#,
        ) else {
            panic!()
        };
        assert!(polygon.fill.is_some() && polygon.line.is_none());
        assert!(matches!(
            shape(r#"<Contour><Polygon><PolyBegin x="0" y="0"/><PolyStepSegment x="0" y="0"/></Polygon></Contour>"#),
            Shape::Standard(p) if matches!(p.kind, PrimitiveKind::Contour(_))
        ));
        assert_eq!(
            shape(r#"<StandardPrimitiveRef id="C"/>"#),
            Shape::StandardRef("C".to_owned())
        );
        assert!(matches!(
            shape(r#"<RectCenter width="1" height="2"/>"#),
            Shape::Standard(_)
        ));
    }

    #[test]
    fn keeps_features_with_unsupported_shapes() {
        let d = step_doc(
            r#"<LayerFeature layerRef="TOP"><Set><Features><Squiggle/></Features></Set></LayerFeature>"#,
        )
        .unwrap();
        let lf = d
            .ecad
            .steps
            .get("S")
            .unwrap()
            .layer_features
            .get("TOP")
            .unwrap();
        let FeatureElement::Features(f) = &lf.sets[0].features[0].element else {
            panic!()
        };
        assert_eq!(
            f.shape,
            Shape::Unsupported {
                element: "Squiggle".to_owned()
            }
        );
        assert_eq!(
            kinds(&d.diagnostics),
            [&DiagnosticKind::UnsupportedShape {
                element: "Squiggle".to_owned()
            }]
        );
    }

    #[test]
    fn shape_slots_take_one_shape() {
        let d = step_doc(
            r#"<LayerFeature layerRef="TOP"><Set><Features><Foo/><StandardPrimitiveRef id="C"/><Circle diameter="1"/></Features></Set></LayerFeature>"#,
        )
        .unwrap();
        let lf = d
            .ecad
            .steps
            .get("S")
            .unwrap()
            .layer_features
            .get("TOP")
            .unwrap();
        let FeatureElement::Features(f) = &lf.sets[0].features[0].element else {
            panic!()
        };
        assert_eq!(f.shape, Shape::StandardRef("C".to_owned()));
        assert_eq!(
            kinds(&d.diagnostics),
            [
                &DiagnosticKind::UnsupportedShape {
                    element: "Foo".to_owned()
                },
                &DiagnosticKind::DuplicateElement {
                    element: "Circle".to_owned(),
                    parent: "Features".to_owned()
                }
            ]
        );
    }

    #[test]
    fn structural_errors() {
        let missing = |features: &str, expected: &str| {
            let e = step_doc(&format!(
                r#"<LayerFeature layerRef="TOP"><Set>{features}</Set></LayerFeature>"#
            ))
            .unwrap_err();
            match e.kind() {
                ErrorKind::MissingElement { expected: e, .. } => assert_eq!(e, expected),
                other => panic!("{other:?}"),
            }
        };
        missing(
            "<Features><Location x=\"0\" y=\"0\"/></Features>",
            "a shape",
        );
        missing(
            "<Features><Polygon><PolyStepSegment x=\"0\" y=\"0\"/></Polygon></Features>",
            "`PolyBegin` before its first step",
        );
        missing("<Features><Polygon/></Features>", "`PolyBegin`");
        missing(
            "<Features><Line startX=\"0\" startY=\"0\" endX=\"1\" endY=\"1\"/></Features>",
            "`LineDesc` or `LineDescRef`",
        );
        missing("<Features><Contour/></Features>", "`Polygon`");
    }

    #[test]
    fn reads_pads() {
        let [feature] = layer(
            r#"<Pad padstackDefRef="P1"><Xform rotation="90"/><Location x="1" y="2"/><StandardPrimitiveRef id="C"/>
            <PinRef componentRef="U1" pin="1"/><PinRef pin="2" title="B"/></Pad>"#,
        )
        .try_into()
        .unwrap_or_else(|_| panic!());
        let FeatureElement::Pad(pad) = feature.element else {
            panic!()
        };
        assert_eq!(pad.padstack_def_ref.as_deref(), Some("P1"));
        assert_eq!(
            pad.location,
            Point {
                x: mm(1.0),
                y: mm(2.0)
            }
        );
        assert_eq!(pad.xform.rotation, 90.0);
        assert_eq!(pad.shape, Some(Shape::StandardRef("C".to_owned())));
        assert_eq!(
            pad.pin_refs,
            [
                PinRef {
                    component_ref: Some("U1".to_owned()),
                    pin: "1".to_owned(),
                    title: None
                },
                PinRef {
                    component_ref: None,
                    pin: "2".to_owned(),
                    title: Some("B".to_owned())
                }
            ]
        );
    }

    #[test]
    fn checks_pad_references() {
        let d = step_doc(
            r#"<PadStackDef name="P1"/>
            <Package name="P"><Pin number="1"/></Package>
            <Component refDes="U1" packageRef="P" layerRef="TOP"/>
            <LayerFeature layerRef="TOP"><Set componentRef="U9">
              <Pad padstackDefRef="P2"><StandardPrimitiveRef id="C"/><PinRef componentRef="U1" pin="1"/><PinRef componentRef="U1" pin="7"/></Pad>
              <Pad padstackDefRef="P1"><StandardPrimitiveRef id="X"/><PinRef componentRef="U2" pin="1"/></Pad>
            </Set></LayerFeature>"#,
        )
        .unwrap();
        assert_eq!(
            kinds(&d.diagnostics),
            [
                &dangling(RefKind::Component, "U9"),
                &dangling(RefKind::PadstackDef, "P2"),
                &dangling(RefKind::Pin, "U1/7"),
                &dangling(RefKind::Component, "U2"),
                &dangling(RefKind::StandardPrimitive, "X"),
            ]
        );
    }

    #[test]
    fn ignores_padstack_references_without_definitions() {
        let d = step_doc(
            r#"<LayerFeature layerRef="TOP"><Set><Pad padstackDefRef="P2"><StandardPrimitiveRef id="C"/></Pad></Set></LayerFeature>"#,
        )
        .unwrap();
        assert_eq!(d.diagnostics, []);
    }

    #[test]
    fn reads_holes() {
        let features = layer(
            r#"<Hole name="H1" diameter="0.3" platingStatus="PLATED" plusTol="0.05" minusTol="0.01" x="1" y="2"/>
            <Hole name="H2" diameter="3" platingStatus="NONPLATED" plusTol="0" minusTol="0" x="0" y="0"/>
            <Hole name="H3" diameter="0.2" platingStatus="VIA" plusTol="0" minusTol="0" x="0" y="0"/>"#,
        );
        let holes: Vec<_> = features
            .iter()
            .map(|f| match &f.element {
                FeatureElement::Hole(h) => h,
                _ => panic!(),
            })
            .collect();
        assert_eq!(holes[0].name, "H1");
        assert_close(holes[0].diameter, mm(0.3));
        assert_close(holes[0].plus_tol, mm(0.05));
        assert_close(holes[0].minus_tol, mm(0.01));
        assert_eq!(
            holes[0].position,
            Point {
                x: mm(1.0),
                y: mm(2.0)
            }
        );
        let plating: Vec<_> = holes.iter().map(|h| h.plating).collect();
        assert_eq!(
            plating,
            [
                PlatingStatus::Plated,
                PlatingStatus::NonPlated,
                PlatingStatus::Via
            ]
        );
    }

    #[test]
    fn reads_slot_cavities() {
        let [feature] = layer(
            r#"<SlotCavity name="S1" platingStatus="PLATED" plusTol="0.1" minusTol="0"><Location x="5" y="0"/>
            <Oval width="3" height="1"><LineDesc lineWidth="0" lineEnd="ROUND"/></Oval></SlotCavity>"#,
        )
        .try_into()
        .unwrap_or_else(|_| panic!());
        let FeatureElement::SlotCavity(slot) = feature.element else {
            panic!()
        };
        assert_eq!(slot.name, "S1");
        assert_eq!(slot.plating, PlatingStatus::Plated);
        assert_close(slot.plus_tol, mm(0.1));
        assert_eq!(slot.location, Point { x: mm(5.0), y: 0.0 });
        let Shape::Standard(oval) = slot.shape else {
            panic!()
        };
        assert_eq!(
            oval.kind,
            PrimitiveKind::Oval {
                width: mm(3.0),
                height: mm(1.0)
            }
        );
        assert!(matches!(
            oval.line,
            Some(crate::LineStyle::Desc(d)) if d.end == LineEnd::Round
        ));
    }

    #[test]
    fn lists_nets_in_order_of_appearance() {
        let s = step(
            r#"<LayerFeature layerRef="TOP"><Set net="B"/><Set net="A"/><Set/><Set net="B"/></LayerFeature>
            <LayerFeature layerRef="BOTTOM"><Set net="C"/><Set net="A"/></LayerFeature>"#,
        );
        assert_eq!(s.nets(), ["B", "A", "C"]);
    }
}

mod text {
    use super::*;
    use crate::{
        EmbeddedFont, FeatureElement, Font, LineDesc, LineEnd, LineProperty, LineStyle, Point,
        Shape, SpecColor, Text, Xform,
    };

    /// A font dictionary in millimetres: embedded font `E` with glyphs `A` and `é`, external
    /// font `X`.
    const FONTS: &str = r#"
<DictionaryFont units="MILLIMETER">
  <EntryFont id="E"><FontDefEmbedded name="plotter">
    <LineDesc lineWidth="0.1" lineEnd="ROUND"/>
    <Glyph charCode="41" lowerLeftX="0" lowerLeftY="-0.25" upperRightX="0.75" upperRightY="1">
      <Line startX="0" startY="0" endX="0.3" endY="1"><LineDesc lineWidth="0.1" lineEnd="ROUND"/></Line>
      <Polyline><PolyBegin x="0.3" y="1"/><PolyStepSegment x="0.6" y="0"/><LineDesc lineWidth="0.1" lineEnd="ROUND"/></Polyline>
    </Glyph>
    <Glyph charCode="00E9" lowerLeftX="0" lowerLeftY="-0.25" upperRightX="0.7" upperRightY="1">
      <Arc startX="0.6" startY="0.3" endX="0.6" endY="0.29" centerX="0.3" centerY="0.3" clockwise="false"><LineDesc lineWidth="0.1" lineEnd="ROUND"/></Arc>
    </Glyph>
  </FontDefEmbedded></EntryFont>
  <EntryFont id="X"><FontDefExternal name="Arial" urn="urn:font:arial"/></EntryFont>
</DictionaryFont>"#;

    fn text(xml: &str) -> (Text, Vec<DiagnosticKind>) {
        let d = doc(
            "INCH",
            FONTS,
            &format!(
                r#"<Layer name="TOP" layerFunction="SILKSCREEN" side="TOP"/><Step name="S">
                <LayerFeature layerRef="TOP"><Set><Features>{xml}</Features></Set></LayerFeature>
                </Step>"#
            ),
        )
        .unwrap();
        let lf = d.ecad.steps.get("S").unwrap().layer_features.get("TOP");
        let FeatureElement::Features(f) = &lf.unwrap().sets[0].features[0].element else {
            panic!("not Features")
        };
        let Shape::Text(text) = &f.shape else {
            panic!("not Text: {:?}", f.shape)
        };
        let kinds = kinds(&d.diagnostics).into_iter().cloned().collect();
        ((**text).clone(), kinds)
    }

    #[test]
    fn reads_text() {
        let (t, warnings) = text(
            r#"<Text textString="R&#xE9;1 &amp; C" fontSize="12">
              <Xform rotation="90" mirror="true" xOffset="0.5"/>
              <BoundingBox lowerLeftX="0" lowerLeftY="0" upperRightX="2" upperRightY="0.5"/>
              <FontRef id="E"/>
              <ColorTerm name="WHITE"/>
            </Text>"#,
        );
        assert_eq!(warnings, []);
        assert_eq!(
            t,
            Text {
                string: "Ré1 & C".to_owned(),
                font_size: Some(12),
                xform: Xform {
                    offset: Point {
                        x: 0.5 * 25.4e-3,
                        y: 0.0
                    },
                    rotation: 90.0,
                    mirror: true,
                    scale: 1.0,
                },
                lower_left: Point::default(),
                upper_right: Point {
                    x: 2.0 * 25.4e-3,
                    y: 0.5 * 25.4e-3
                },
                font_ref: Some("E".to_owned()),
                line: None,
                color: Some(SpecColor::Term {
                    name: "WHITE".to_owned(),
                    comment: None
                }),
            }
        );
        // Not in the rev C schema, but read: a stroke for text in the bundled font.
        let (t, warnings) = text(
            r#"<Text textString="X"><BoundingBox lowerLeftX="0" lowerLeftY="0" upperRightX="1" upperRightY="1"/><LineDescRef id="L"/></Text>"#,
        );
        assert_eq!(warnings, [dangling(RefKind::LineDesc, "L")]);
        assert_eq!((t.font_size, t.font_ref), (None, None));
        assert_eq!(t.line, Some(LineStyle::Ref("L".to_owned())));
        assert_eq!(t.xform, Xform::default());
    }

    #[test]
    fn reads_fonts() {
        let d = doc("INCH", FONTS, "").unwrap();
        assert_eq!(d.diagnostics, []);
        let Some(Font::Embedded(font)) = d.content.fonts.get("E") else {
            panic!("not an embedded font")
        };
        let EmbeddedFont { name, line, glyphs } = font;
        assert_eq!(name, "plotter");
        assert_eq!(
            line,
            &Some(LineStyle::Desc(LineDesc {
                width: mm(0.1),
                end: LineEnd::Round,
                property: LineProperty::Solid
            }))
        );
        assert_eq!(glyphs.len(), 2);
        let a = font.glyph('A').unwrap();
        assert_eq!(a.char_code, 0x41);
        assert_eq!(
            (a.lower_left, a.upper_right),
            (
                Point {
                    x: 0.0,
                    y: mm(-0.25)
                },
                Point {
                    x: mm(0.75),
                    y: mm(1.0)
                }
            )
        );
        assert!(matches!(a.shapes[..], [Shape::Line(_), Shape::Polyline(_)]));
        assert!(matches!(
            font.glyph('é').unwrap().shapes[..],
            [Shape::Arc(_)]
        ));
        assert_eq!(font.glyph('B'), None);
        assert_eq!(
            d.content.fonts.get("X"),
            Some(&Font::External {
                name: "Arial".to_owned(),
                urn: "urn:font:arial".to_owned()
            })
        );
    }

    #[test]
    fn text_in_user_primitives_and_markings() {
        let d = doc(
            "MILLIMETER",
            r#"<DictionaryUser units="MILLIMETER"><EntryUser id="U"><UserSpecial>
              <Text textString="A"><BoundingBox lowerLeftX="0" lowerLeftY="0" upperRightX="1" upperRightY="1"/></Text>
            </UserSpecial></EntryUser></DictionaryUser>"#,
            r#"<Step name="S"><Package name="P" type="OTHER">
              <SilkScreen><Marking markingUsage="REFDES"><Location x="0" y="1"/>
                <Text textString="R?"><BoundingBox lowerLeftX="0" lowerLeftY="0" upperRightX="1" upperRightY="1"/></Text>
              </Marking></SilkScreen>
            </Package></Step>"#,
        )
        .unwrap();
        assert_eq!(d.diagnostics, []);
        let Some(Shape::UserSpecial(shapes)) = d.content.user_primitives.get("U") else {
            panic!("not a UserSpecial")
        };
        assert!(matches!(&shapes[..], [Shape::Text(t)] if t.string == "A"));
        let package = d.ecad.steps.get("S").unwrap().packages.get("P").unwrap();
        let marking = &package.silkscreen.as_ref().unwrap().markings[0];
        assert!(matches!(&marking.shape, Shape::Text(t) if t.string == "R?"));
    }

    #[test]
    fn malformed_text_and_fonts() {
        let e = doc(
            "MILLIMETER",
            "",
            r#"<Step name="S"><LayerFeature layerRef="TOP"><Set><Features><Text textString="A"/></Features></Set></LayerFeature></Step>"#,
        )
        .unwrap_err();
        assert!(e.to_string().contains("`BoundingBox`"), "{e}");
        for code in ["4", "XY", "123456789A", ""] {
            let e = doc(
                "MILLIMETER",
                &format!(
                    r#"<DictionaryFont units="MILLIMETER"><EntryFont id="E"><FontDefEmbedded name="f">
                    <Glyph charCode="{code}" lowerLeftX="0" lowerLeftY="0" upperRightX="1" upperRightY="1"/>
                    </FontDefEmbedded></EntryFont></DictionaryFont>"#
                ),
                "",
            )
            .unwrap_err();
            assert!(
                matches!(e.kind(), ErrorKind::InvalidValue { attribute, .. } if attribute == "charCode"),
                "{code}: {e}"
            );
        }
        let (_, warnings) = text(
            r#"<Text textString="A"><BoundingBox lowerLeftX="0" lowerLeftY="0" upperRightX="1" upperRightY="1"/><FontRef id="nope"/></Text>"#,
        );
        assert_eq!(warnings, [dangling(RefKind::Font, "nope")]);
    }
}

mod specs {
    use super::*;
    use crate::{Color, SpecColor, SpecProperty};

    /// Parses a document with the given `CadHeader` children, [`LAYERS`] and `cad_data`.
    fn header_doc(content: &str, header: &str, cad_data: &str) -> Document {
        let xml = format!(
            r#"<IPC-2581 revision="C"><Content>{content}</Content>
<Ecad name="e"><CadHeader units="MILLIMETER">{header}</CadHeader><CadData>{LAYERS}{cad_data}</CadData></Ecad>
</IPC-2581>"#
        );
        parse_bytes(xml.as_bytes()).unwrap()
    }

    fn text(text: &str) -> SpecProperty {
        SpecProperty {
            text: Some(text.to_owned()),
            ..SpecProperty::default()
        }
    }

    #[test]
    fn reads_specs_with_properties_and_colours() {
        let d = header_doc(
            r#"<DictionaryColor><EntryColor id="BLUE"><Color r="0" g="0" b="128"/></EntryColor></DictionaryColor>"#,
            r#"<Spec name="MASK">
                 <General type="MATERIAL">
                   <Property text="SOLDERMASK"/><Property text="Color : Blue"/>
                 </General>
                 <Dielectric type="DIELECTRIC_CONSTANT"><Property value="3.8"/></Dielectric>
               </Spec>
               <Spec name="RGB"><General type="OTHER"><Property value="1" unit="MM"/><Color r="1" g="2" b="3"/></General></Spec>
               <Spec name="REF"><General type="MATERIAL"><ColorRef id="BLUE"/></General></Spec>
               <Spec name="TERM"><General type="MATERIAL"><ColorTerm name="OTHER" comment="Matte Black"/></General></Spec>"#,
            "",
        );
        assert_eq!(
            kinds(&d.diagnostics),
            [&DiagnosticKind::UnknownElement {
                element: "Dielectric".to_owned(),
                parent: "Spec".to_owned()
            }]
        );
        let names: Vec<_> = d.ecad.specs.iter().map(|(k, _)| k).collect();
        assert_eq!(names, ["MASK", "RGB", "REF", "TERM"]);
        let mask = &d.ecad.specs.get("MASK").unwrap().general[0];
        assert_eq!(mask.general_type, "MATERIAL");
        assert_eq!(mask.properties, [text("SOLDERMASK"), text("Color : Blue")]);
        assert_eq!(mask.color, None);
        let rgb = &d.ecad.specs.get("RGB").unwrap().general[0];
        assert_eq!(
            rgb.properties,
            [SpecProperty {
                text: None,
                value: Some("1".to_owned()),
                unit: Some("MM".to_owned())
            }]
        );
        assert_eq!(rgb.color, Some(SpecColor::Rgb(Color { r: 1, g: 2, b: 3 })));
        let colour = |name: &str| d.ecad.specs.get(name).unwrap().general[0].color.clone();
        assert_eq!(colour("REF"), Some(SpecColor::Ref("BLUE".to_owned())));
        assert_eq!(
            colour("TERM"),
            Some(SpecColor::Term {
                name: "OTHER".to_owned(),
                comment: Some("Matte Black".to_owned())
            })
        );
    }

    #[test]
    fn layers_and_stackup_layers_refer_to_specs() {
        let d = header_doc(
            "",
            r#"<Spec name="A"/><Spec name="B"/>"#,
            r#"<Layer name="MASK" layerFunction="SOLDERMASK" side="TOP"><SpecRef id="A"/></Layer>
               <Stackup name="S"><StackupGroup name="G">
                 <StackupLayer layerOrGroupRef="MASK"><SpecRef id="B"/><SpecRef id="SPEC_MASK"/></StackupLayer>
                 <StackupLayer layerOrGroupRef="TOP"/>
               </StackupGroup></Stackup>"#,
        );
        assert_eq!(
            kinds(&d.diagnostics),
            [&dangling(RefKind::Spec, "SPEC_MASK")]
        );
        assert_eq!(d.ecad.layers.get("MASK").unwrap().spec_refs, ["A"]);
        assert!(d.ecad.layers.get("TOP").unwrap().spec_refs.is_empty());
        let layers = &d.ecad.stackups[0].groups[0].layers;
        assert_eq!(layers[0].spec_refs, ["B", "SPEC_MASK"]);
        assert!(layers[1].spec_refs.is_empty());
    }

    #[test]
    fn spec_colours_are_checked() {
        let d = header_doc(
            "",
            r#"<Spec name="A"><General type="MATERIAL"><ColorRef id="NOPE"/><Color r="1" g="1" b="1"/></General></Spec>
               <Spec name="A"/>"#,
            "",
        );
        assert_eq!(
            kinds(&d.diagnostics),
            [
                &DiagnosticKind::DuplicateElement {
                    element: "Color".to_owned(),
                    parent: "General".to_owned()
                },
                &DiagnosticKind::DuplicateKey {
                    kind: RefKind::Spec,
                    key: "A".to_owned()
                },
                &dangling(RefKind::Color, "NOPE"),
            ]
        );
        let spec = d.ecad.specs.get("A").unwrap();
        assert_eq!(
            spec.general[0].color,
            Some(SpecColor::Ref("NOPE".to_owned()))
        );
    }
}
