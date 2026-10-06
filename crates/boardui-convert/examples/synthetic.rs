//! Writes a synthetic two-layer IPC-2581 board for performance measurements.
//!
//! ```text
//! cargo run --release -p boardui-convert --example synthetic -- 230 > synthetic.xml
//! boardui -v convert synthetic.xml -o synthetic.glb
//! ```
//!
//! The board is a grid of `n × n` cells at 1 mm pitch on both copper layers. Each cell has
//! a pad and a trace that leaves it with an arc towards the next cell; every tenth cell has
//! a plated via, whose antipad clears a ground pour that covers each layer. With `n = 230`
//! that is about 212,000 features. Every 20th cell row gets a resistor whose pads are two of
//! the cell pads.

use std::fmt::Write as _;

fn main() {
    let n: usize = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(230);
    print!("{}", board(n));
}

fn board(n: usize) -> String {
    let size = n as f64;
    let mut out = String::new();
    let w = |out: &mut String, s: &str| out.push_str(s);
    w(
        &mut out,
        r#"<?xml version="1.0" encoding="UTF-8"?>
<IPC-2581 revision="C" xmlns="http://webstds.ipc.org/2581">
<Content><FunctionMode mode="FABRICATION"/><StepRef name="board"/>
<DictionaryLineDesc units="MILLIMETER"><EntryLineDesc id="T"><LineDesc lineWidth="0.12" lineEnd="ROUND"/></EntryLineDesc></DictionaryLineDesc>
<DictionaryStandard units="MILLIMETER">
<EntryStandard id="ROUND"><Circle diameter="0.4"/></EntryStandard>
<EntryStandard id="RECT"><RectCenter width="0.4" height="0.3"/></EntryStandard>
<EntryStandard id="VIA"><Circle diameter="0.45"/></EntryStandard>
<EntryStandard id="ANTI"><Circle diameter="0.6"/></EntryStandard>
</DictionaryStandard></Content>
<Ecad name="synthetic"><CadHeader units="MILLIMETER"/><CadData>
<Layer name="TOP" layerFunction="CONDUCTOR" side="TOP"/>
<Layer name="BOTTOM" layerFunction="CONDUCTOR" side="BOTTOM"/>
<Layer name="DRILL" layerFunction="DRILL" side="ALL"><Span fromLayer="TOP" toLayer="BOTTOM"/></Layer>
<Step name="board">
"#,
    );
    let (lo, hi) = (-1.0, size);
    writeln!(
        out,
        r#"<Profile><Polygon><PolyBegin x="{lo}" y="{lo}"/><PolyStepSegment x="{hi}" y="{lo}"/><PolyStepSegment x="{hi}" y="{hi}"/><PolyStepSegment x="{lo}" y="{hi}"/><PolyStepSegment x="{lo}" y="{lo}"/></Polygon></Profile>"#
    )
    .unwrap();
    w(
        &mut out,
        r#"<Package name="R" pinOne="1" height="0.4"><Outline><Polygon><PolyBegin x="-0.3" y="-0.25"/><PolyStepSegment x="1.3" y="-0.25"/><PolyStepSegment x="1.3" y="0.25"/><PolyStepSegment x="-0.3" y="0.25"/><PolyStepSegment x="-0.3" y="-0.25"/></Polygon><LineDesc lineWidth="0.1" lineEnd="ROUND"/></Outline><Pin number="1"><Location x="0" y="0"/></Pin><Pin number="2"><Location x="1" y="0"/></Pin></Package>
"#,
    );
    let resistor = |row: usize, col: usize| row % 20 == 0 && col % 2 == 0 && col + 1 < n;
    for row in 0..n {
        for col in 0..n {
            if resistor(row, col) {
                writeln!(
                    out,
                    r#"<Component refDes="R{row}_{col}" packageRef="R" layerRef="TOP" mountType="SMT" height="0.4"><Location x="{col}" y="{row}"/></Component>"#
                )
                .unwrap();
            }
        }
    }
    let via = |row: usize, col: usize| (row * n + col).is_multiple_of(10);
    for layer in ["TOP", "BOTTOM"] {
        writeln!(out, r#"<LayerFeature layerRef="{layer}">"#).unwrap();
        // The pour under everything, then antipads around the vias.
        writeln!(
            out,
            r#"<Set net="GND"><Features><Location x="0" y="0"/><Contour><Polygon><PolyBegin x="-0.5" y="-0.5"/><PolyStepSegment x="{h}" y="-0.5"/><PolyStepSegment x="{h}" y="{h}"/><PolyStepSegment x="-0.5" y="{h}"/><PolyStepSegment x="-0.5" y="-0.5"/></Polygon></Contour></Features></Set>"#,
            h = size - 0.5
        )
        .unwrap();
        for row in 0..n {
            for col in (0..n).filter(|&col| via(row, col)) {
                writeln!(
                    out,
                    r#"<Set polarity="NEGATIVE"><Features><Location x="{col}" y="{y}"/><StandardPrimitiveRef id="ANTI"/></Features></Set>"#,
                    y = row as f64 + 0.3
                )
                .unwrap();
            }
        }
        for row in 0..n {
            for col in 0..n {
                let net = format!("N{row}_{col}");
                let shape = if (row + col).is_multiple_of(2) {
                    "ROUND"
                } else {
                    "RECT"
                };
                let pin = if layer == "TOP" && resistor(row, col) {
                    format!(r#"<PinRef componentRef="R{row}_{col}" pin="1"/>"#)
                } else if layer == "TOP" && col > 0 && resistor(row, col - 1) {
                    format!(
                        r#"<PinRef componentRef="R{row}_{c}" pin="2"/>"#,
                        c = col - 1
                    )
                } else {
                    String::new()
                };
                writeln!(
                    out,
                    r#"<Set net="{net}" padUsage="TERMINATION"><Pad><Location x="{col}" y="{row}"/><StandardPrimitiveRef id="{shape}"/>{pin}</Pad></Set>"#
                )
                .unwrap();
                let (x, y) = (col as f64, row as f64);
                writeln!(
                    out,
                    r#"<Set net="{net}"><Features><Location x="0" y="0"/><Polyline><PolyBegin x="{x}" y="{y}"/><PolyStepCurve x="{x3}" y="{y3}" centerX="{x}" centerY="{y3}" clockwise="false"/><PolyStepSegment x="{x1}" y="{y3}"/><LineDescRef id="T"/></Polyline></Features></Set>"#,
                    x3 = x + 0.3,
                    y3 = y + 0.3,
                    x1 = x + 1.0
                )
                .unwrap();
                if via(row, col) {
                    writeln!(
                        out,
                        r#"<Set net="{net}" padUsage="VIA"><Pad><Location x="{x}" y="{y3}"/><StandardPrimitiveRef id="VIA"/></Pad></Set>"#,
                        y3 = y + 0.3
                    )
                    .unwrap();
                }
            }
        }
        writeln!(out, "</LayerFeature>").unwrap();
    }
    writeln!(out, r#"<LayerFeature layerRef="DRILL">"#).unwrap();
    for row in 0..n {
        for col in (0..n).filter(|&col| via(row, col)) {
            writeln!(
                out,
                r#"<Set net="N{row}_{col}"><Hole name="H{row}_{col}" diameter="0.2" platingStatus="VIA" plusTol="0" minusTol="0" x="{col}" y="{y}"/></Set>"#,
                y = row as f64 + 0.3
            )
            .unwrap();
        }
    }
    w(
        &mut out,
        "</LayerFeature>\n</Step></CadData></Ecad></IPC-2581>\n",
    );
    out
}
