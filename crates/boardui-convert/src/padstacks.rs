//! The `PadStack`s of revision A and B files (spec §6.3), as Altium writes them: lowered to
//! the layer features and drill holes that a revision C file has, so that pads, pins, nets,
//! holes and barrels take the same path.

use std::borrow::Cow;

use boardui_gltf::Role;
use boardui_ipc2581 as ipc;

use crate::Warnings;
use crate::stackup::{self, Stack};

/// The document with the `PadStack`s of every step lowered (spec §5, §6.3); borrowed if it
/// has none. `tolerance` is in metres.
///
/// - Each `LayerPad` becomes a `Pad` on its layer, in a `Set` with the padstack's net
///   (`padUsage` `VIA` if its hole is a via), after the layer's own features.
/// - Each `LayerHole` becomes a `Hole` of the first `DRILL` layer with the same span, after
///   its own features, or of a synthesized `@drill-<from>-<to>` if there is none. If that
///   layer already has a hole of the same diameter at the same centre (Altium writes its
///   holes on a `Drill Guide` layer too), the drill layer's hole stays the only one and takes
///   the padstack's net if its `Set` has none.
pub(crate) fn lower(doc: &ipc::Document, tolerance: f64) -> Cow<'_, ipc::Document> {
    if doc.ecad.steps.values().all(|s| s.pad_stacks.is_empty()) {
        return Cow::Borrowed(doc);
    }
    // Only to compare spans; the pipeline reports the stack-up's warnings.
    let Ok(stack) = stackup::build(&doc.ecad, &mut Warnings::default()) else {
        return Cow::Borrowed(doc);
    };
    let mut doc = doc.clone();
    let ecad = &mut doc.ecad;
    for step in ecad.steps.values_mut() {
        lower_step(step, &mut ecad.layers, &stack, tolerance);
    }
    Cow::Owned(doc)
}

fn lower_step(
    step: &mut ipc::Step,
    layers: &mut ipc::Table<ipc::Layer>,
    stack: &Stack,
    tolerance: f64,
) {
    let pad_stacks = std::mem::take(&mut step.pad_stacks);
    for pad_stack in &pad_stacks {
        let via = pad_stack
            .hole
            .as_ref()
            .is_some_and(|h| h.hole.plating == ipc::PlatingStatus::Via);
        for pad in &pad_stack.pads {
            let element = ipc::FeatureElement::Pad(ipc::Pad {
                padstack_def_ref: None,
                location: pad.location,
                xform: pad.xform,
                shape: Some(pad.shape.clone()),
                pin_refs: pad.pin_ref.iter().cloned().collect(),
            });
            let set = ipc::Set {
                net: pad_stack.net.clone(),
                pad_usage: via.then_some(ipc::PadUsage::Via),
                ..ipc::Set::default()
            };
            push(step, &pad.layer_ref, set, element);
        }
    }
    for pad_stack in &pad_stacks {
        let Some(hole) = &pad_stack.hole else {
            continue;
        };
        let span = copper_span(stack, hole.span.as_ref());
        let drill = layers
            .values()
            .find(|l| {
                l.function.eq_ignore_ascii_case("DRILL")
                    && copper_span(stack, l.span.as_ref()) == span
            })
            .map(|l| l.name.clone());
        let drill = drill.unwrap_or_else(|| synthesize(layers, stack, span));
        let duplicate = |f: &ipc::Feature| matches!(&f.element, ipc::FeatureElement::Hole(h) if same(h, &hole.hole, tolerance));
        let existing = step.layer_features.get_mut(&drill).and_then(|lf| {
            lf.sets
                .iter_mut()
                .find(|set| set.features.iter().any(duplicate))
        });
        match existing {
            Some(set) => {
                if set.net.is_none() && set.features.len() == 1 {
                    set.net.clone_from(&pad_stack.net);
                }
            }
            None => {
                let set = ipc::Set {
                    net: pad_stack.net.clone(),
                    ..ipc::Set::default()
                };
                push(
                    step,
                    &drill,
                    set,
                    ipc::FeatureElement::Hole(hole.hole.clone()),
                );
            }
        }
    }
}

/// Adds a set with one feature to a layer, numbered on from the layer's features.
fn push(step: &mut ipc::Step, layer: &str, mut set: ipc::Set, element: ipc::FeatureElement) {
    if step.layer_features.get(layer).is_none() {
        step.layer_features.insert(
            layer.to_owned(),
            ipc::LayerFeature {
                layer_ref: layer.to_owned(),
                sets: Vec::new(),
            },
        );
    }
    let lf = step.layer_features.get_mut(layer).expect("inserted");
    set.features.push(ipc::Feature {
        source: lf.feature_count(),
        element,
    });
    lf.sets.push(set);
}

/// The stack indices of a span's upper and lower copper layer; all copper layers if the span
/// is absent or doesn't name copper layers (as for drill layers, spec §6.3).
fn copper_span(stack: &Stack, span: Option<&ipc::Span>) -> (usize, usize) {
    let copper = stack.copper();
    let all = (copper[0], *copper.last().expect("copper"));
    let Some(span) = span else {
        return all;
    };
    let copper_index = |name: &str| {
        stack
            .index(name)
            .filter(|&i| stack.layers[i].role == Role::Copper)
    };
    match (copper_index(&span.from_layer), copper_index(&span.to_layer)) {
        (Some(a), Some(b)) => (a.min(b), a.max(b)),
        _ => all,
    }
}

/// Adds a drill layer `@drill-<from>-<to>` for a span without one and returns its name.
fn synthesize(
    layers: &mut ipc::Table<ipc::Layer>,
    stack: &Stack,
    (a, b): (usize, usize),
) -> String {
    let (from, to) = (&stack.layers[a].name, &stack.layers[b].name);
    let mut name = format!("@drill-{from}-{to}");
    while layers.get(&name).is_some() {
        name.push('\'');
    }
    layers.insert(
        name.clone(),
        ipc::Layer {
            name: name.clone(),
            function: "DRILL".into(),
            side: None,
            polarity: ipc::Polarity::Positive,
            span: Some(ipc::Span {
                from_layer: from.clone(),
                to_layer: to.clone(),
            }),
            spec_refs: Vec::new(),
        },
    );
    name
}

/// Whether two holes are the same: equal diameters at the same centre, within `tolerance`.
fn same(a: &ipc::Hole, b: &ipc::Hole, tolerance: f64) -> bool {
    let (dx, dy) = (a.position.x - b.position.x, a.position.y - b.position.y);
    dx.hypot(dy) <= tolerance && (a.diameter - b.diameter).abs() <= tolerance
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(layers: &str, step: &str) -> ipc::Document {
        let xml = format!(
            r#"<IPC-2581 revision="B"><Content><FunctionMode mode="FABRICATION"/>
            <DictionaryStandard units="MILLIMETER"><EntryStandard id="C"><Circle diameter="1"/></EntryStandard></DictionaryStandard></Content>
            <Ecad name="b"><CadHeader units="MILLIMETER"/><CadData>
            <Layer name="TOP" layerFunction="SIGNAL" side="TOP"/>
            <Layer name="BOTTOM" layerFunction="SIGNAL" side="BOTTOM"/>
            {layers}<Step name="s">{step}</Step></CadData></Ecad></IPC-2581>"#
        );
        let d = ipc::parse_bytes(xml.as_bytes()).unwrap();
        assert_eq!(d.diagnostics, []);
        d
    }

    /// A via in net `GND` at (1, 2) mm and a pad of pin `U1/1` in net `N1`.
    const PAD_STACKS: &str = r#"<PadStack net="GND">
      <LayerHole name="V" diameter="0.3" platingStatus="VIA" plusTol="0" minusTol="0" x="1" y="2"><Span fromLayer="BOTTOM" toLayer="TOP"/></LayerHole>
      <LayerPad layerRef="TOP"><Location x="1" y="2"/><StandardPrimitiveRef id="C"/></LayerPad>
    </PadStack>
    <PadStack net="N1">
      <LayerPad layerRef="TOP"><Location x="5" y="0"/><StandardPrimitiveRef id="C"/><PinRef componentRef="U1" pin="1"/></LayerPad>
    </PadStack>
    <Package name="P"><Pin number="1"/></Package>
    <Component refDes="U1" packageRef="P" layerRef="TOP"/>"#;

    fn features<'a>(step: &'a ipc::Step, layer: &str) -> Vec<(&'a ipc::Set, &'a ipc::Feature)> {
        step.layer_features.get(layer).unwrap().features().collect()
    }

    #[test]
    fn pads_follow_the_layer_features() {
        let d = doc(
            "",
            &format!(
                r#"{PAD_STACKS}<LayerFeature layerRef="TOP"><Set net="N2"><Features><Location x="0" y="0"/><StandardPrimitiveRef id="C"/></Features></Set></LayerFeature>"#
            ),
        );
        let lowered = lower(&d, 1e-9);
        let step = lowered.ecad.steps.get("s").unwrap();
        assert!(step.pad_stacks.is_empty());
        let top = features(step, "TOP");
        let sources: Vec<usize> = top.iter().map(|(_, f)| f.source).collect();
        assert_eq!(sources, [0, 1, 2]);
        let (via, _) = top[1];
        assert_eq!(via.net.as_deref(), Some("GND"));
        assert_eq!(via.pad_usage, Some(ipc::PadUsage::Via));
        let (set, pad) = top[2];
        assert_eq!(set.pad_usage, None);
        let ipc::FeatureElement::Pad(pad) = &pad.element else {
            panic!()
        };
        assert_eq!(pad.pin_refs[0].component_ref.as_deref(), Some("U1"));
        assert_eq!(pad.shape, Some(ipc::Shape::StandardRef("C".into())));
        assert_eq!(step.nets(), ["N2", "GND", "N1"]);
    }

    #[test]
    fn holes_without_a_drill_layer_get_one() {
        let d = doc("", PAD_STACKS);
        let lowered = lower(&d, 1e-9);
        let layer = lowered.ecad.layers.get("@drill-TOP-BOTTOM").unwrap();
        assert_eq!(layer.function, "DRILL");
        let span = layer.span.as_ref().unwrap();
        assert_eq!(
            (span.from_layer.as_str(), span.to_layer.as_str()),
            ("TOP", "BOTTOM")
        );
        let step = lowered.ecad.steps.get("s").unwrap();
        let [(set, hole)] = features(step, "@drill-TOP-BOTTOM")[..] else {
            panic!()
        };
        assert_eq!(set.net.as_deref(), Some("GND"));
        assert!(matches!(&hole.element, ipc::FeatureElement::Hole(h) if h.name == "V"));
        // The source document is left alone.
        assert!(d.ecad.layers.get("@drill-TOP-BOTTOM").is_none());
    }

    /// Altium writes its holes on a `Drill Guide` layer too: those win.
    #[test]
    fn a_drill_layer_with_the_hole_keeps_it() {
        let drill = r#"<Layer name="Drill Guide" layerFunction="DRILL" side="INTERNAL"/>
            <Layer name="Blind" layerFunction="DRILL"><Span fromLayer="TOP" toLayer="TOP"/></Layer>"#;
        let guide = r#"<LayerFeature layerRef="Drill Guide">
            <Set><Hole name="G0" diameter="0.3" platingStatus="VIA" plusTol="0" minusTol="0" x="1" y="2"/></Set>
            <Set><Hole name="G1" diameter="0.3" platingStatus="VIA" plusTol="0" minusTol="0" x="1" y="3"/></Set>
        </LayerFeature>"#;
        let d = doc(drill, &format!("{PAD_STACKS}{guide}"));
        let lowered = lower(&d, 1e-6);
        let step = lowered.ecad.steps.get("s").unwrap();
        let holes = features(step, "Drill Guide");
        assert_eq!(holes.len(), 2);
        assert_eq!(holes[0].0.net.as_deref(), Some("GND"));
        assert_eq!(holes[1].0.net, None);
        assert_eq!(lowered.ecad.layers.len(), d.ecad.layers.len());
        assert!(step.layer_features.get("Blind").is_none());

        // A hole of another diameter is another hole, numbered on.
        let d = doc(
            drill,
            &format!("{PAD_STACKS}{}", guide.replace("0.3", "0.4")),
        );
        let lowered = lower(&d, 1e-6);
        let step = lowered.ecad.steps.get("s").unwrap();
        let holes = features(step, "Drill Guide");
        let sources: Vec<usize> = holes.iter().map(|(_, f)| f.source).collect();
        assert_eq!(sources, [0, 1, 2]);
        assert_eq!(holes[2].0.net.as_deref(), Some("GND"));
    }

    #[test]
    fn documents_without_pad_stacks_are_borrowed() {
        let d = doc("", "");
        assert!(matches!(lower(&d, 1e-9), Cow::Borrowed(_)));
    }
}
