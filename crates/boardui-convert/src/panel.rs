//! Panels: the default step, the instances of `StepRepeat`s and the layers of flipped copies
//! (spec §6.14, ADR 0013).

use std::collections::{HashMap, HashSet};

use boardui_gltf::{InstanceAsset, Role, Side};
use boardui_ipc2581 as ipc;
use glam::{DAffine2, DVec2};

use crate::shapes::point;
use crate::stackup::{self, LayerClass, Stack};
use crate::{ConvertError, Options, Warnings};

/// At most this many instances are placed; the copies beyond are skipped with a warning.
pub(crate) const MAX_INSTANCES: usize = 10_000;

/// A step placed on the board: the converted step itself, or an instance of a `StepRepeat`.
pub(crate) struct Part<'a> {
    pub step: &'a ipc::Step,
    /// Maps the step's coordinates to board coordinates.
    pub frame: DAffine2,
    /// Whether the copy is turned over: its layers go to their counterparts (spec §6.14).
    pub flipped: bool,
    /// Row in the `instances` table; `None` for the converted step.
    pub instance: Option<u32>,
}

/// The step to convert: the one named in the options, else the root step, the first that
/// no `StepRepeat` references, preferring the order of `Content/StepRef`. Without
/// `StepRepeat`s, that is the first `StepRef`, else the first step.
pub(crate) fn select_step<'a>(
    doc: &'a ipc::Document,
    options: &Options,
) -> Result<&'a ipc::Step, ConvertError> {
    let steps = &doc.ecad.steps;
    if let Some(name) = &options.step {
        return steps
            .get(name)
            .ok_or_else(|| ConvertError::Input(format!("the file has no step `{name}`")));
    }
    let referenced: HashSet<&str> = steps
        .values()
        .flat_map(|s| &s.step_repeats)
        .map(|r| r.step_ref.as_str())
        .collect();
    let listed = || doc.content.step_refs.iter().filter_map(|n| steps.get(n));
    let is_root = |s: &&ipc::Step| !referenced.contains(s.name.as_str());
    listed()
        .find(is_root)
        .or_else(|| steps.values().find(is_root))
        // Every step is part of a cycle.
        .or_else(|| listed().next())
        .or_else(|| steps.values().next())
        .ok_or_else(|| ConvertError::Input("the file has no step".into()))
}

/// The parts of the board: `root` first, then every instance placed in it, depth first
/// (spec §6.14). Also returns the `instances` table.
pub(crate) fn expand<'a>(
    ecad: &'a ipc::Ecad,
    root: &'a ipc::Step,
    warnings: &mut Warnings,
) -> (Vec<Part<'a>>, Vec<InstanceAsset>) {
    let mut expansion = Expansion {
        ecad,
        parts: vec![Part {
            step: root,
            frame: DAffine2::IDENTITY,
            flipped: false,
            instance: None,
        }],
        instances: Vec::new(),
        counts: HashMap::new(),
        path: vec![root.name.as_str()],
        warnings,
    };
    expansion.visit(root, DAffine2::IDENTITY, false, None);
    (expansion.parts, expansion.instances)
}

struct Expansion<'a, 'w> {
    ecad: &'a ipc::Ecad,
    parts: Vec<Part<'a>>,
    instances: Vec<InstanceAsset>,
    /// Instances so far per step name, for numbering.
    counts: HashMap<&'a str, u32>,
    /// The steps from the root to the current one, to find cycles.
    path: Vec<&'a str>,
    warnings: &'w mut Warnings,
}

impl<'a> Expansion<'a, '_> {
    /// Places the copies of `step`'s repeats, which is itself placed with `frame`.
    fn visit(&mut self, step: &'a ipc::Step, frame: DAffine2, flipped: bool, parent: Option<u32>) {
        for repeat in &step.step_repeats {
            // The reader reports references to missing steps.
            let Some(child) = self.ecad.steps.get(&repeat.step_ref) else {
                continue;
            };
            if self.path.contains(&child.name.as_str()) {
                self.warnings.push(format!(
                    "step `{}` repeats step `{}`, which contains it; the repeat was skipped",
                    step.name, child.name
                ));
                continue;
            }
            let mirror = if repeat.mirror {
                DAffine2::from_scale(DVec2::new(-1.0, 1.0))
            } else {
                DAffine2::IDENTITY
            };
            let datum = child.datum.map_or(DVec2::ZERO, point);
            let linear = DAffine2::from_angle(repeat.angle.to_radians())
                * mirror
                * DAffine2::from_translation(-datum);
            for j in 0..repeat.ny {
                for i in 0..repeat.nx {
                    if self.instances.len() == MAX_INSTANCES {
                        self.warnings.push(format!(
                            "the panel has more than {MAX_INSTANCES} instances; the others were skipped"
                        ));
                        return;
                    }
                    let at = point(repeat.location)
                        + DVec2::new(f64::from(i) * repeat.dx, f64::from(j) * repeat.dy);
                    let frame = frame * DAffine2::from_translation(at) * linear;
                    let flipped = flipped != repeat.mirror;
                    let count = self.counts.entry(child.name.as_str()).or_default();
                    *count += 1;
                    let row = self.instances.len() as u32;
                    self.instances.push(InstanceAsset {
                        name: format!("{}-{count}", child.name),
                        step: child.name.clone(),
                        parent,
                        x: frame.translation.x,
                        y: frame.translation.y,
                        angle: angle(frame),
                        side: if flipped { Side::Bottom } else { Side::Top },
                    });
                    self.parts.push(Part {
                        step: child,
                        frame,
                        flipped,
                        instance: Some(row),
                    });
                    self.path.push(&child.name);
                    self.visit(child, frame, flipped, Some(row));
                    self.path.pop();
                }
            }
        }
    }
}

/// The counter-clockwise rotation of a frame in degrees, in `[0, 360)`, after undoing its
/// mirroring.
fn angle(frame: DAffine2) -> f64 {
    let x = frame.matrix2.x_axis;
    let x = if frame.matrix2.determinant() < 0.0 {
        -x
    } else {
        x
    };
    // Round away the noise of composed rotations, so that 90° stays 90°.
    let degrees = (x.y.atan2(x.x).to_degrees() * 1e9).round() / 1e9;
    let degrees = degrees.rem_euclid(360.0);
    if degrees == 360.0 { 0.0 } else { degrees }
}

/// Where the features of flipped copies go (spec §6.14): each layer's counterpart on the
/// other side of the board. It is symmetric: a layer and its counterpart swap.
#[derive(Debug, Default)]
pub(crate) struct Flip {
    /// Layers with a side and their counterparts; `None` for a layer without one. Layers
    /// that aren't listed (dielectrics, layers without a side) keep their features.
    layers: HashMap<String, Option<String>>,
    /// Drill layers and the drill layer with the mirrored span. Drill layers without one
    /// aren't listed and keep their holes.
    drills: HashMap<String, String>,
}

impl Flip {
    /// Pairs the layers of `ecad`: copper layer `k` of `n` (in `stack` order) with copper
    /// layer `n − 1 − k`; other layers with a side with the layer of the same role on the
    /// other side, the first with the first and so on, in document order; drill layers with
    /// the drill layer whose span is mirrored, likewise.
    pub fn new(ecad: &ipc::Ecad, stack: &Stack) -> Self {
        let copper: Vec<&str> = stack
            .copper()
            .into_iter()
            .map(|i| stack.layers[i].name.as_str())
            .collect();
        let n = copper.len();
        let mut flip = Self::default();
        let mut sided: Vec<((Role, Side), Vec<&str>)> = Vec::new();
        let mut spans: Vec<((usize, usize), Vec<&str>)> = Vec::new();
        for layer in ecad.layers.values() {
            match stackup::classify(&layer.function) {
                LayerClass::Layer(Role::Copper) => {
                    if let Some(k) = copper.iter().position(|c| *c == layer.name) {
                        let other = copper[n - 1 - k].to_owned();
                        flip.layers.insert(layer.name.clone(), Some(other));
                    }
                }
                LayerClass::Layer(Role::Dielectric) | LayerClass::Ignored => {}
                LayerClass::Layer(role) => {
                    let side = match stack.index(&layer.name) {
                        Some(i) => Some(stack.layers[i].side),
                        None => match layer.side {
                            Some(ipc::Side::Top) => Some(Side::Top),
                            Some(ipc::Side::Bottom) => Some(Side::Bottom),
                            _ => None,
                        },
                    };
                    if let Some(side @ (Side::Top | Side::Bottom)) = side {
                        group(&mut sided, (role, side), &layer.name);
                    }
                }
                LayerClass::Drill => {
                    let position = |name: &str| copper.iter().position(|c| *c == name);
                    let span = layer.span.as_ref().and_then(|s| {
                        let (a, b) = (position(&s.from_layer)?, position(&s.to_layer)?);
                        Some((a.min(b), a.max(b)))
                    });
                    group(&mut spans, span.unwrap_or((0, n - 1)), &layer.name);
                }
            }
        }
        for ((role, side), names) in &sided {
            let other = if *side == Side::Top {
                Side::Bottom
            } else {
                Side::Top
            };
            let others = sided.iter().find(|(key, _)| *key == (*role, other));
            for (k, name) in names.iter().enumerate() {
                let counterpart = others.and_then(|(_, o)| o.get(k)).map(|s| (*s).to_owned());
                flip.layers.insert((*name).to_owned(), counterpart);
            }
        }
        for ((a, b), names) in &spans {
            let mirrored = (n - 1 - b, n - 1 - a);
            let Some((_, others)) = spans.iter().find(|(span, _)| *span == mirrored) else {
                continue;
            };
            for (name, other) in names.iter().zip(others) {
                flip.drills.insert((*name).to_owned(), (*other).to_owned());
            }
        }
        flip
    }

    /// The counterpart of a layer, or `None` if it has a side but no counterpart.
    pub fn layer<'s>(&'s self, name: &'s str) -> Option<&'s str> {
        match self.layers.get(name) {
            Some(counterpart) => counterpart.as_deref(),
            None => Some(name),
        }
    }

    /// The counterpart of a drill layer: the one with the mirrored span, else itself.
    pub fn drill<'s>(&'s self, name: &'s str) -> &'s str {
        self.drills.get(name).map_or(name, String::as_str)
    }

    /// Whether a drill layer has a counterpart with the mirrored span.
    pub fn has_drill(&self, name: &str) -> bool {
        self.drills.contains_key(name)
    }
}

/// Appends `name` to the group with `key`, creating it in first-seen order.
fn group<'n, K: PartialEq>(groups: &mut Vec<(K, Vec<&'n str>)>, key: K, name: &'n str) {
    match groups.iter_mut().find(|(k, _)| *k == key) {
        Some((_, names)) => names.push(name),
        None => groups.push((key, vec![name])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(xml_steps: &str, layers: &str) -> ipc::Document {
        let xml = format!(
            r#"<?xml version="1.0"?>
<IPC-2581 revision="C"><Content><FunctionMode mode="ASSEMBLY"/><StepRef name="B"/><StepRef name="P"/></Content>
<Ecad name="e"><CadHeader units="MILLIMETER"/><CadData>{layers}{xml_steps}</CadData></Ecad></IPC-2581>"#
        );
        ipc::parse_bytes(xml.as_bytes()).unwrap()
    }

    const TWO_LAYERS: &str = r#"
<Layer name="TOP" layerFunction="CONDUCTOR" side="TOP"/>
<Layer name="BOTTOM" layerFunction="CONDUCTOR" side="BOTTOM"/>"#;

    fn options(step: Option<&str>) -> Options {
        Options {
            step: step.map(str::to_owned),
            ..Options::default()
        }
    }

    #[test]
    fn the_root_step_converts_by_default() {
        let d = doc(
            r#"<Step name="B"/><Step name="P"><StepRepeat stepRef="B" x="0" y="0"/></Step>"#,
            TWO_LAYERS,
        );
        assert_eq!(select_step(&d, &options(None)).unwrap().name, "P");
        assert_eq!(select_step(&d, &options(Some("B"))).unwrap().name, "B");
        // Without repeats: the first StepRef, as before.
        let d = doc(r#"<Step name="P"/><Step name="B"/>"#, TWO_LAYERS);
        assert_eq!(select_step(&d, &options(None)).unwrap().name, "B");
    }

    #[test]
    fn instances_are_numbered_per_step_depth_first() {
        let d = doc(
            r#"<Step name="B"><Datum x="1" y="1"/></Step>
<Step name="S"><StepRepeat stepRef="B" x="0" y="0" nx="2" ny="1" dx="10" dy="0"/></Step>
<Step name="P"><StepRepeat stepRef="S" x="0" y="0" nx="1" ny="2" dx="0" dy="20"/>
<StepRepeat stepRef="B" x="100" y="0" angle="90" mirror="true"/></Step>"#,
            TWO_LAYERS,
        );
        let mut warnings = Warnings::default();
        let root = d.ecad.steps.get("P").unwrap();
        let (parts, instances) = expand(&d.ecad, root, &mut warnings);
        assert!(warnings.is_empty());
        let names: Vec<&str> = instances.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, ["S-1", "B-1", "B-2", "S-2", "B-3", "B-4", "B-5"]);
        let parents: Vec<Option<u32>> = instances.iter().map(|i| i.parent).collect();
        assert_eq!(
            parents,
            [None, Some(0), Some(0), None, Some(3), Some(3), None]
        );
        assert_eq!(parts.len(), 8);
        assert_eq!(parts[0].instance, None);

        // B-4: second copy of B in S-2. B's datum (1, 1) lands on (10, 20).
        let b4 = &parts[6];
        assert_eq!(b4.instance, Some(5));
        let p = b4.frame.transform_point2(DVec2::new(1e-3, 1e-3));
        assert!(p.distance(DVec2::new(10e-3, 20e-3)) < 1e-12, "{p}");

        // B-5 is mirrored, then rotated by 90° about its datum, which lands on (100, 0).
        let b5 = &parts[7];
        assert!(b5.flipped);
        let p = b5.frame.transform_point2(DVec2::new(2e-3, 1e-3));
        assert!(p.distance(DVec2::new(100e-3, -1e-3)) < 1e-12, "{p}");
        assert_eq!(instances[6].angle, 90.0);
        assert_eq!(instances[6].side, Side::Bottom);
        assert!((instances[6].x - 101e-3).abs() < 1e-12);
        assert!((instances[6].y - 1e-3).abs() < 1e-12);
    }

    #[test]
    fn cycles_are_skipped_with_a_warning() {
        let d = doc(
            r#"<Step name="B"><StepRepeat stepRef="P" x="0" y="0"/></Step>
<Step name="P"><StepRepeat stepRef="B" x="0" y="0"/></Step>"#,
            TWO_LAYERS,
        );
        // Every step is referenced: the first StepRef converts.
        let root = select_step(&d, &options(None)).unwrap();
        assert_eq!(root.name, "B");
        let mut warnings = Warnings::default();
        let (parts, _) = expand(&d.ecad, root, &mut warnings);
        assert_eq!(parts.len(), 2);
        let warnings = warnings.into_vec();
        assert_eq!(
            warnings[0].message,
            "step `P` repeats step `B`, which contains it; the repeat was skipped"
        );
    }

    #[test]
    fn layers_flip_to_their_counterparts() {
        let layers = r#"
<Layer name="F.Silk" layerFunction="SILKSCREEN" side="TOP"/>
<Layer name="F.Mask" layerFunction="SOLDERMASK" side="TOP"/>
<Layer name="F.Paste" layerFunction="SOLDERPASTE" side="TOP"/>
<Layer name="F.Cu" layerFunction="CONDUCTOR" side="TOP"/>
<Layer name="In1" layerFunction="CONDUCTOR" side="INTERNAL"/>
<Layer name="In2" layerFunction="CONDUCTOR" side="INTERNAL"/>
<Layer name="B.Cu" layerFunction="CONDUCTOR" side="BOTTOM"/>
<Layer name="B.Mask" layerFunction="SOLDERMASK" side="BOTTOM"/>
<Layer name="B.Silk" layerFunction="SILKSCREEN" side="BOTTOM"/>
<Layer name="Notes" layerFunction="DOCUMENT" side="NONE"/>
<Layer name="F.Fab" layerFunction="ASSEMBLY" side="TOP"/>
<Layer name="D1" layerFunction="DRILL"><Span fromLayer="F.Cu" toLayer="B.Cu"/></Layer>
<Layer name="D2" layerFunction="DRILL"><Span fromLayer="F.Cu" toLayer="In1"/></Layer>
<Layer name="D3" layerFunction="DRILL"><Span fromLayer="In2" toLayer="B.Cu"/></Layer>
<Layer name="D4" layerFunction="DRILL"><Span fromLayer="In1" toLayer="In2"/></Layer>
<Layer name="D5" layerFunction="DRILL"><Span fromLayer="F.Cu" toLayer="In2"/></Layer>"#;
        let d = doc(r#"<Step name="B"/>"#, layers);
        let mut warnings = Warnings::default();
        let stack = stackup::build(&d.ecad, &mut warnings).unwrap();
        let flip = Flip::new(&d.ecad, &stack);
        for (a, b) in [
            ("F.Cu", "B.Cu"),
            ("In1", "In2"),
            ("F.Mask", "B.Mask"),
            ("F.Silk", "B.Silk"),
        ] {
            assert_eq!(flip.layer(a), Some(b));
            assert_eq!(flip.layer(b), Some(a));
        }
        assert_eq!(flip.layer("F.Paste"), None, "no bottom paste layer");
        assert_eq!(flip.layer("F.Fab"), None, "no bottom assembly layer");
        assert_eq!(flip.layer("Notes"), Some("Notes"), "no side");
        assert_eq!(flip.layer("@core"), Some("@core"));
        for (a, b) in [("D1", "D1"), ("D2", "D3"), ("D3", "D2"), ("D4", "D4")] {
            assert_eq!(flip.drill(a), b);
            assert!(flip.has_drill(a));
        }
        assert_eq!(flip.drill("D5"), "D5");
        assert!(!flip.has_drill("D5"));
    }
}
