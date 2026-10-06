//! Layer classification, stack-up order and Z ranges (spec §6.4–§6.6, §6.11–§6.13).

use boardui_gltf::{Role, Side, ThicknessSource};
use boardui_ipc2581 as ipc;

use crate::Warnings;

/// Default copper-to-copper board thickness (spec §6.4).
pub const DEFAULT_THICKNESS: f64 = 1.6e-3;
/// Default copper thickness.
pub const DEFAULT_COPPER: f64 = 35e-6;
/// Default soldermask thickness.
pub const DEFAULT_SOLDERMASK: f64 = 20e-6;
/// Default silkscreen thickness.
pub const DEFAULT_SILKSCREEN: f64 = 10e-6;
/// Default solder paste thickness: a typical stencil (spec §6.11).
pub const DEFAULT_PASTE: f64 = 100e-6;
/// Thickness of a drawing sheet (spec §6.12).
pub const DRAWING_THICKNESS: f64 = 10e-6;

/// What the converter does with a layer, by its `layerFunction`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayerClass {
    /// A layer that becomes a layer node.
    Layer(Role),
    /// A drill or rout layer: holes and slots.
    Drill,
    /// Not converted (glue, probe, V-cut, board outline, …).
    Ignored,
}

/// Classifies an IPC-2581 `layerFunction`.
pub fn classify(function: &str) -> LayerClass {
    match function.to_ascii_uppercase().as_str() {
        "CONDUCTOR" | "SIGNAL" | "PLANE" | "MIXED" | "CONDFOIL" | "CONDFILM" | "POWER_GROUND" => {
            LayerClass::Layer(Role::Copper)
        }
        "DIELCORE" | "DIELPREG" | "DIELBASE" | "DIELADHV" | "DIELECTRIC" | "DIELCOVERLAY" => {
            LayerClass::Layer(Role::Dielectric)
        }
        "SOLDERMASK" => LayerClass::Layer(Role::Soldermask),
        "SILKSCREEN" | "LEGEND" => LayerClass::Layer(Role::Silkscreen),
        "SOLDERPASTE" | "PASTEMASK" => LayerClass::Layer(Role::Paste),
        "COURTYARD" => LayerClass::Layer(Role::Courtyard),
        "ASSEMBLY" => LayerClass::Layer(Role::Assembly),
        "DOCUMENT" => LayerClass::Layer(Role::Documentation),
        "DRILL" | "ROUT" | "ROUTE" => LayerClass::Drill,
        _ => LayerClass::Ignored,
    }
}

/// A layer with its Z range.
#[derive(Debug, Clone, PartialEq)]
pub struct StackLayer {
    /// Source layer name, or a synthesized name starting with `@`.
    pub name: String,
    /// Role.
    pub role: Role,
    /// Source `layerFunction`; `None` when synthesized.
    pub ipc_function: Option<String>,
    /// Side.
    pub side: Side,
    /// Bottom of the layer, in metres.
    pub z_min: f64,
    /// Top of the layer, in metres.
    pub z_max: f64,
    /// Where the thickness came from.
    pub thickness_source: ThicknessSource,
    /// Whether the layer was synthesized.
    pub synthesized: bool,
}

impl StackLayer {
    /// Suggested default visibility: inner copper and the optional layers are hidden,
    /// everything else (including the dielectric, which keeps the board opaque) is shown
    /// (spec §8.3).
    pub fn visible(&self) -> bool {
        !self.role.is_optional() && (self.role != Role::Copper || self.side != Side::Internal)
    }
}

/// The board's layers, top to bottom.
#[derive(Debug, Clone, PartialEq)]
pub struct Stack {
    /// Layers, top to bottom.
    pub layers: Vec<StackLayer>,
    /// Copper-to-copper thickness, in metres.
    pub thickness: f64,
}

impl Stack {
    /// Indices of the copper layers, top to bottom.
    pub fn copper(&self) -> Vec<usize> {
        (0..self.layers.len())
            .filter(|&i| self.layers[i].role == Role::Copper)
            .collect()
    }

    /// Index of a layer by name.
    pub fn index(&self, name: &str) -> Option<usize> {
        self.layers.iter().position(|l| l.name == name)
    }

    /// The outer copper layer of a side.
    pub fn outer_copper(&self, side: Side) -> Option<usize> {
        let copper = self.copper();
        match side {
            Side::Bottom if copper.len() > 1 => copper.last().copied(),
            Side::Bottom => None,
            _ => copper.first().copied(),
        }
    }

    /// The outer surface of a side: the highest top (or lowest bottom) of its layers.
    fn surface(&self, side: Side) -> f64 {
        let z = self.layers.iter().filter(|l| l.side == side);
        match side {
            Side::Bottom => z.map(|l| l.z_min).fold(f64::INFINITY, f64::min),
            _ => z.map(|l| l.z_max).fold(f64::NEG_INFINITY, f64::max),
        }
    }

    /// Adds layers outside the copper span (above the top copper, or below the bottom
    /// copper), and orders both sides top to bottom by the layers' outer surfaces.
    fn add_outer(&mut self, side: Side, new: Vec<StackLayer>) {
        let copper = self.copper();
        let (first, last) = (copper[0], *copper.last().expect("copper"));
        let mut lower = self.layers.split_off(last + 1);
        let mut upper: Vec<StackLayer> = self.layers.drain(..first).collect();
        if side == Side::Bottom {
            lower.extend(new);
        } else {
            upper.extend(new);
        }
        upper.sort_by(|a, b| b.z_max.total_cmp(&a.z_max));
        lower.sort_by(|a, b| b.z_min.total_cmp(&a.z_min));
        upper.append(&mut self.layers);
        upper.append(&mut lower);
        self.layers = upper;
    }
}

/// Synthesized layers the pipeline asks for, per side (top, bottom): a silkscreen layer for
/// package silkscreens and an assembly layer for package assembly drawings (spec §6.13).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Synthesize {
    /// `@silkscreen-top`, `@silkscreen-bottom`.
    pub silkscreen: [bool; 2],
    /// `@assembly-top`, `@assembly-bottom`.
    pub assembly: [bool; 2],
}

/// Whether the step has features on a layer.
pub fn has_features(step: &ipc::Step, layer: &str) -> bool {
    step.layer_features
        .get(layer)
        .is_some_and(|lf| lf.feature_count() > 0)
}

/// The side an optional layer goes on: `BOTTOM` layers on the bottom, all others (`TOP`,
/// `NONE`, `ALL`, …) on the top (spec §6.11).
pub fn optional_side(layer: &ipc::Layer) -> Side {
    match layer.side {
        Some(ipc::Side::Bottom) => Side::Bottom,
        _ => Side::Top,
    }
}

/// Adds the synthesized silkscreen layers, the paste layers and the drawing layers with
/// features in `step` (spec §6.11–§6.13) to the stack.
pub fn add_optional(
    stack: &mut Stack,
    ecad: &ipc::Ecad,
    step: &ipc::Step,
    synthesize: Synthesize,
    warnings: &mut Warnings,
) {
    let synthesized = |name: &str, role, side, z_min, z_max| StackLayer {
        name: name.to_owned(),
        role,
        ipc_function: None,
        side,
        z_min,
        z_max,
        thickness_source: ThicknessSource::Default,
        synthesized: true,
    };
    let optional: Vec<&ipc::Layer> = ecad
        .layers
        .values()
        .filter(|l| {
            matches!(classify(&l.function), LayerClass::Layer(role) if role.is_optional())
                && has_features(step, &l.name)
        })
        .collect();
    let role_of = |l: &ipc::Layer| match classify(&l.function) {
        LayerClass::Layer(role) => role,
        _ => unreachable!("optional layers only"),
    };
    for (k, side) in [Side::Top, Side::Bottom].into_iter().enumerate() {
        let on_side: Vec<&ipc::Layer> = optional
            .iter()
            .copied()
            .filter(|l| optional_side(l) == side)
            .collect();
        let Some(copper) = stack.outer_copper(side) else {
            if !on_side.is_empty() {
                let names: Vec<&str> = on_side.iter().map(|l| l.name.as_str()).collect();
                warnings.push(format!(
                    "the board has no bottom side; layers {} were skipped",
                    names.join(", ")
                ));
            }
            continue;
        };
        let up = if side == Side::Bottom { -1.0 } else { 1.0 };
        let range = |from: f64, t: f64| {
            let to = from + up * t;
            (from.min(to), from.max(to))
        };
        if synthesize.silkscreen[k] {
            let name = ["@silkscreen-top", "@silkscreen-bottom"][k];
            let (z_min, z_max) = range(stack.surface(side), DEFAULT_SILKSCREEN);
            let layer = synthesized(name, Role::Silkscreen, side, z_min, z_max);
            stack.add_outer(side, vec![layer]);
        }

        // Paste sits on the outer copper surface (spec §6.11); one layer per side.
        let copper_surface = match side {
            Side::Bottom => stack.layers[copper].z_min,
            _ => stack.layers[copper].z_max,
        };
        let mut pastes = on_side.iter().filter(|l| role_of(l) == Role::Paste);
        if let Some(paste) = pastes.next() {
            let thickness = stackup_thickness(ecad, &paste.name);
            let (z_min, z_max) = range(copper_surface, thickness.unwrap_or(DEFAULT_PASTE));
            let layer = StackLayer {
                name: paste.name.clone(),
                role: Role::Paste,
                ipc_function: Some(paste.function.clone()),
                side,
                z_min,
                z_max,
                thickness_source: if thickness.is_some() {
                    ThicknessSource::File
                } else {
                    ThicknessSource::Default
                },
                synthesized: false,
            };
            stack.add_outer(side, vec![layer]);
        }
        for extra in pastes {
            warnings.push(format!(
                "layer `{}` is a second paste layer on its side and was skipped",
                extra.name
            ));
        }

        // Drawings are stacked outward from the side's surface (spec §6.12).
        let rank = |role: Role| match role {
            Role::Assembly => 0,
            Role::Courtyard => 1,
            _ => 2,
        };
        let mut drawings: Vec<(Role, String, Option<String>)> = on_side
            .iter()
            .filter(|l| role_of(l).is_drawing())
            .map(|l| (role_of(l), l.name.clone(), Some(l.function.clone())))
            .collect();
        if synthesize.assembly[k] {
            let name = ["@assembly-top", "@assembly-bottom"][k];
            drawings.push((Role::Assembly, name.to_owned(), None));
        }
        drawings.sort_by_key(|(role, ..)| rank(*role));
        let mut surface = stack.surface(side);
        let mut layers = Vec::new();
        for (role, name, function) in drawings {
            let (z_min, z_max) = range(surface, DRAWING_THICKNESS);
            surface += up * DRAWING_THICKNESS;
            layers.push(StackLayer {
                synthesized: function.is_none(),
                ipc_function: function,
                ..synthesized(&name, role, side, z_min, z_max)
            });
        }
        stack.add_outer(side, layers);
    }
}

/// The thickness of a layer in the first stack-up, if given (and not 0).
fn stackup_thickness(ecad: &ipc::Ecad, layer: &str) -> Option<f64> {
    ecad.stackups
        .first()?
        .groups
        .iter()
        .flat_map(|g| &g.layers)
        .find(|l| l.layer_or_group_ref == layer)?
        .thickness
        .filter(|&t| t > 0.0)
}

/// An entry while ordering: a source layer or a synthesized one.
#[derive(Debug, Clone)]
struct Entry {
    name: String,
    role: Role,
    function: Option<String>,
    file_side: Option<ipc::Side>,
    thickness: Option<f64>,
}

/// Builds the stack-up of `ecad` (spec §6.4).
///
/// # Errors
///
/// Returns a message if the file has no copper layer.
pub fn build(ecad: &ipc::Ecad, warnings: &mut Warnings) -> Result<Stack, String> {
    let physical: Vec<Entry> = ecad
        .layers
        .values()
        .filter_map(|layer| match classify(&layer.function) {
            LayerClass::Layer(role) if !role.is_optional() => Some(Entry {
                name: layer.name.clone(),
                role,
                function: Some(layer.function.clone()),
                file_side: layer.side,
                thickness: None,
            }),
            _ => None,
        })
        .collect();
    if !physical.iter().any(|e| e.role == Role::Copper) {
        return Err("the file has no copper layer".into());
    }

    let ordered = match ecad.stackups.first() {
        Some(stackup) => from_stackup(stackup, &physical, warnings),
        None => None,
    };
    let ordered = ordered.unwrap_or_else(|| default_order(&physical));

    // Split into the copper span and the layers above and below it.
    let first = ordered
        .iter()
        .position(|e| e.role == Role::Copper)
        .expect("copper");
    let last = ordered
        .iter()
        .rposition(|e| e.role == Role::Copper)
        .expect("copper");
    let mut above = Vec::new();
    let mut below = Vec::new();
    for (i, entry) in ordered.iter().enumerate() {
        if (first..=last).contains(&i) {
            continue;
        }
        if entry.role == Role::Dielectric {
            warnings.push(format!(
                "dielectric layer `{}` lies outside the copper layers and was skipped",
                entry.name
            ));
            continue;
        }
        if i < first { &mut above } else { &mut below }.push(entry.clone());
    }
    let mut span: Vec<Entry> = Vec::new();
    for entry in &ordered[first..=last] {
        if matches!(entry.role, Role::Soldermask | Role::Silkscreen) {
            warnings.push(format!(
                "layer `{}` lies between copper layers and was skipped",
                entry.name
            ));
            continue;
        }
        span.push(entry.clone());
    }
    synthesize_dielectric(&mut span);
    for (side, list) in [
        (ipc::Side::Top, &mut above),
        (ipc::Side::Bottom, &mut below),
    ] {
        let has_copper_side =
            side == ipc::Side::Top || span.iter().filter(|e| e.role == Role::Copper).count() > 1;
        if has_copper_side && !list.iter().any(|e| e.role == Role::Soldermask) {
            let name = if side == ipc::Side::Top {
                "@soldermask-top"
            } else {
                "@soldermask-bottom"
            };
            let entry = Entry {
                name: name.into(),
                role: Role::Soldermask,
                function: None,
                file_side: Some(side),
                thickness: None,
            };
            // The mask goes next to the copper: last above, first below.
            if side == ipc::Side::Top {
                list.push(entry);
            } else {
                list.insert(0, entry);
            }
        }
    }

    Ok(z_ranges(&above, &span, &below))
}

/// Orders the physical layers by the stack-up. `None` if the stack-up misses copper layers.
fn from_stackup(
    stackup: &ipc::Stackup,
    physical: &[Entry],
    warnings: &mut Warnings,
) -> Option<Vec<Entry>> {
    let mut entries: Vec<(u32, usize, &ipc::StackupLayer)> = stackup
        .groups
        .iter()
        .flat_map(|g| &g.layers)
        .enumerate()
        .map(|(i, l)| (l.sequence.unwrap_or(u32::MAX), i, l))
        .collect();
    entries.sort_by_key(|&(sequence, index, _)| (sequence, index));
    let mut ordered: Vec<Entry> = Vec::new();
    for (_, _, layer) in entries {
        let Some(entry) = physical.iter().find(|e| e.name == layer.layer_or_group_ref) else {
            continue;
        };
        if ordered.iter().any(|e| e.name == entry.name) {
            continue;
        }
        ordered.push(Entry {
            thickness: layer.thickness.filter(|&t| t > 0.0),
            ..entry.clone()
        });
    }
    let copper_in_stack = ordered.iter().filter(|e| e.role == Role::Copper).count();
    let copper = physical.iter().filter(|e| e.role == Role::Copper).count();
    if copper_in_stack != copper {
        warnings.push(format!(
            "stack-up `{}` lists {copper_in_stack} of {copper} copper layers; using the default layer order",
            stackup.name
        ));
        return None;
    }
    // Stack-ups count from the top; flip one that clearly counts from the bottom.
    let side_of = |e: &Entry| e.file_side;
    let first_copper = ordered.iter().find(|e| e.role == Role::Copper);
    let last_copper = ordered.iter().rev().find(|e| e.role == Role::Copper);
    if first_copper.and_then(side_of) == Some(ipc::Side::Bottom)
        && last_copper.and_then(side_of) == Some(ipc::Side::Top)
    {
        ordered.reverse();
    }
    // Soldermask and silkscreen missing from the stack-up go outside, by their side.
    let mut top = Vec::new();
    let mut bottom = Vec::new();
    for entry in physical {
        if ordered.iter().any(|e| e.name == entry.name) {
            continue;
        }
        match (entry.role, entry.file_side) {
            (Role::Soldermask | Role::Silkscreen, Some(ipc::Side::Top)) => top.push(entry.clone()),
            (Role::Soldermask | Role::Silkscreen, Some(ipc::Side::Bottom)) => {
                bottom.push(entry.clone());
            }
            _ => warnings.push(format!(
                "layer `{}` is not in the stack-up and was skipped",
                entry.name
            )),
        }
    }
    // Silkscreen outermost.
    top.sort_by_key(|e| e.role != Role::Silkscreen);
    bottom.sort_by_key(|e| e.role == Role::Silkscreen);
    top.extend(ordered);
    top.extend(bottom);
    Some(top)
}

/// The order without a stack-up: top silkscreen, top soldermask, copper and dielectric in
/// document order (top copper first, bottom copper last), bottom soldermask, bottom
/// silkscreen.
fn default_order(physical: &[Entry]) -> Vec<Entry> {
    let zone = |e: &Entry| match (e.role, e.file_side) {
        (Role::Silkscreen, Some(ipc::Side::Bottom)) => 6,
        (Role::Soldermask, Some(ipc::Side::Bottom)) => 5,
        (Role::Silkscreen, _) => 0,
        (Role::Soldermask, _) => 1,
        (Role::Copper, Some(ipc::Side::Top)) => 2,
        (Role::Copper, Some(ipc::Side::Bottom)) => 4,
        _ => 3,
    };
    let mut ordered = physical.to_vec();
    ordered.sort_by_key(zone);
    ordered
}

/// Inserts `@core` / `@prepreg-<k>` between adjacent copper layers without dielectric
/// (spec §6.4). With a single copper layer, `@core` goes beneath it.
fn synthesize_dielectric(span: &mut Vec<Entry>) {
    let synthesized = |name: String| Entry {
        name,
        role: Role::Dielectric,
        function: None,
        file_side: None,
        thickness: None,
    };
    let copper: Vec<usize> = (0..span.len())
        .filter(|&i| span[i].role == Role::Copper)
        .collect();
    if copper.len() == 1 {
        span.push(synthesized("@core".into()));
        return;
    }
    let gaps = copper.len() - 1;
    let core = (gaps - 1) / 2;
    // Walk gaps from the bottom so that insertions don't shift earlier indices.
    for gap in (0..gaps).rev() {
        let (a, b) = (copper[gap], copper[gap + 1]);
        if span[a + 1..b].iter().any(|e| e.role == Role::Dielectric) {
            continue;
        }
        let name = if gap == core {
            "@core".to_owned()
        } else {
            format!("@prepreg-{}", gap + 1)
        };
        span.insert(b, synthesized(name));
    }
}

fn z_ranges(above: &[Entry], span: &[Entry], below: &[Entry]) -> Stack {
    let copper_count = span.iter().filter(|e| e.role == Role::Copper).count();
    let thickness_of = |e: &Entry| -> (Option<f64>, ThicknessSource) {
        match e.thickness {
            Some(t) => (Some(t), ThicknessSource::File),
            None => (
                match e.role {
                    Role::Copper => Some(DEFAULT_COPPER),
                    Role::Soldermask => Some(DEFAULT_SOLDERMASK),
                    Role::Silkscreen => Some(DEFAULT_SILKSCREEN),
                    _ => None,
                },
                ThicknessSource::Default,
            ),
        }
    };
    // Dielectrics without thickness share what the default board thickness leaves.
    let known: f64 = span.iter().filter_map(|e| thickness_of(e).0).sum();
    let unknown = span.iter().filter(|e| thickness_of(e).0.is_none()).count();
    let share = if unknown > 0 {
        let rest = DEFAULT_THICKNESS - known;
        if rest > 0.0 {
            rest / unknown as f64
        } else {
            DEFAULT_THICKNESS / (copper_count.max(2) - 1) as f64
        }
    } else {
        0.0
    };
    let thicknesses: Vec<(f64, ThicknessSource)> = span
        .iter()
        .map(|e| {
            let (t, source) = thickness_of(e);
            (t.unwrap_or(share), source)
        })
        .collect();
    let total: f64 = thicknesses.iter().map(|t| t.0).sum();

    let side_of = |e: &Entry, copper_index: Option<usize>| match (e.role, copper_index) {
        (Role::Copper, Some(0)) => Side::Top,
        (Role::Copper, Some(k)) if k + 1 == copper_count => Side::Bottom,
        _ => Side::Internal,
    };
    let layer = |e: &Entry, side, z_min, z_max, source| StackLayer {
        name: e.name.clone(),
        role: e.role,
        ipc_function: e.function.clone(),
        side,
        z_min,
        z_max,
        thickness_source: source,
        synthesized: e.function.is_none(),
    };

    let mut middle = Vec::new();
    let mut z = total / 2.0;
    let mut copper_index = 0;
    for (e, &(t, source)) in span.iter().zip(&thicknesses) {
        let index = (e.role == Role::Copper).then(|| {
            copper_index += 1;
            copper_index - 1
        });
        middle.push(layer(e, side_of(e, index), z - t, z, source));
        z -= t;
    }

    // Above the top copper: masks start at the top of the dielectric beneath it (spec §6.5).
    let top = &middle[0];
    let (mut base, mut surface) = (top.z_min, top.z_max);
    let mut upper = Vec::new();
    for e in above.iter().rev() {
        let (t, source) = thickness_of(e);
        let t = t.expect("outer layers have a default thickness");
        let z_min = if e.role == Role::Soldermask {
            base
        } else {
            surface
        };
        upper.push(layer(e, Side::Top, z_min, surface + t, source));
        surface += t;
        base = surface;
    }
    upper.reverse();

    let bottom = middle.last().expect("copper");
    let mut lower = Vec::new();
    if copper_count > 1 {
        let (mut base, mut surface) = (bottom.z_max, bottom.z_min);
        for e in below {
            let (t, source) = thickness_of(e);
            let t = t.expect("outer layers have a default thickness");
            let z_max = if e.role == Role::Soldermask {
                base
            } else {
                surface
            };
            lower.push(layer(e, Side::Bottom, surface - t, z_max, source));
            surface -= t;
            base = surface;
        }
    }

    let mut layers = upper;
    layers.extend(middle);
    layers.extend(lower);
    Stack {
        layers,
        thickness: total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(xml: &str) -> ipc::Document {
        let xml = format!(
            r#"<IPC-2581 revision="C"><Content><FunctionMode mode="FABRICATION"/></Content>
            <Ecad name="b"><CadHeader units="MILLIMETER"/><CadData>{xml}<Step name="s"/></CadData></Ecad></IPC-2581>"#
        );
        ipc::parse_bytes(xml.as_bytes()).unwrap()
    }

    fn names(stack: &Stack) -> Vec<&str> {
        stack.layers.iter().map(|l| l.name.as_str()).collect()
    }

    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-12, "{a} vs {b}");
    }

    #[test]
    fn two_layers_get_defaults_and_synthesized_layers() {
        let d = doc(
            r#"<Layer name="BOTTOM" layerFunction="CONDUCTOR" side="BOTTOM"/>
            <Layer name="TOP" layerFunction="CONDUCTOR" side="TOP"/>
            <Layer name="SST" layerFunction="SILKSCREEN" side="TOP"/>
            <Layer name="D" layerFunction="DRILL" side="ALL"/>"#,
        );
        let mut w = Warnings::default();
        let stack = build(&d.ecad, &mut w).unwrap();
        assert_eq!(
            names(&stack),
            [
                "SST",
                "@soldermask-top",
                "TOP",
                "@core",
                "BOTTOM",
                "@soldermask-bottom"
            ]
        );
        close(stack.thickness, 1.6e-3);
        let [silk, mask, top, core, bottom, bmask] = &stack.layers[..] else {
            panic!()
        };
        close(top.z_max, 0.8e-3);
        close(top.z_min, 0.765e-3);
        close(core.z_max, 0.765e-3);
        close(core.z_min, -0.765e-3);
        close(bottom.z_min, -0.8e-3);
        close(mask.z_min, 0.765e-3);
        close(mask.z_max, 0.82e-3);
        close(silk.z_min, 0.82e-3);
        close(silk.z_max, 0.83e-3);
        close(bmask.z_max, -0.765e-3);
        close(bmask.z_min, -0.82e-3);
        assert!(core.synthesized && mask.synthesized && !top.synthesized);
        assert_eq!(top.side, Side::Top);
        assert_eq!(bottom.side, Side::Bottom);
        assert!(core.visible());
        assert!(w.is_empty());
    }

    #[test]
    fn four_layers_without_dielectric_get_core_and_prepregs() {
        let d = doc(r#"<Layer name="L1" layerFunction="SIGNAL" side="TOP"/>
            <Layer name="L2" layerFunction="PLANE" side="INTERNAL"/>
            <Layer name="L3" layerFunction="PLANE" side="INTERNAL"/>
            <Layer name="L4" layerFunction="SIGNAL" side="BOTTOM"/>
            <Layer name="M" layerFunction="SOLDERMASK" side="BOTTOM"/>"#);
        let stack = build(&d.ecad, &mut Warnings::default()).unwrap();
        assert_eq!(
            names(&stack),
            [
                "@soldermask-top",
                "L1",
                "@prepreg-1",
                "L2",
                "@core",
                "L3",
                "@prepreg-3",
                "L4",
                "M"
            ]
        );
        let gap = (1.6e-3 - 4.0 * 35e-6) / 3.0;
        close(stack.layers[2].z_max - stack.layers[2].z_min, gap);
        assert_eq!(stack.layers[3].side, Side::Internal);
        assert!(!stack.layers[3].visible());
    }

    #[test]
    fn stackup_thicknesses_and_order_are_used() {
        let d = doc(
            r#"<Layer name="F.Mask" layerFunction="SOLDERMASK" side="TOP"/>
            <Layer name="F.Cu" layerFunction="CONDUCTOR" side="TOP"/>
            <Layer name="D1" layerFunction="DIELCORE" side="INTERNAL"/>
            <Layer name="B.Cu" layerFunction="CONDUCTOR" side="BOTTOM"/>
            <Layer name="F.Silk" layerFunction="SILKSCREEN" side="TOP"/>
            <Stackup name="S" overallThickness="1.0"><StackupGroup name="G">
              <StackupLayer layerOrGroupRef="B.Cu" thickness="0.018" sequence="4"/>
              <StackupLayer layerOrGroupRef="F.Silk" thickness="0" sequence="0"/>
              <StackupLayer layerOrGroupRef="F.Mask" thickness="0.01" sequence="1"/>
              <StackupLayer layerOrGroupRef="F.Cu" thickness="0.018" sequence="2"/>
              <StackupLayer layerOrGroupRef="D1" thickness="0.5" sequence="3"/>
            </StackupGroup></Stackup>"#,
        );
        let stack = build(&d.ecad, &mut Warnings::default()).unwrap();
        assert_eq!(
            names(&stack),
            [
                "F.Silk",
                "F.Mask",
                "F.Cu",
                "D1",
                "B.Cu",
                "@soldermask-bottom"
            ]
        );
        close(stack.thickness, 0.536e-3);
        let top = &stack.layers[2];
        close(top.z_max, 0.268e-3);
        assert_eq!(top.thickness_source, ThicknessSource::File);
        let silk = &stack.layers[0];
        assert_eq!(silk.thickness_source, ThicknessSource::Default);
        close(silk.z_max - silk.z_min, DEFAULT_SILKSCREEN);
        close(stack.layers[1].z_max, 0.268e-3 + 10e-6);
    }

    #[test]
    fn single_copper_layer_sits_on_a_core() {
        let d = doc(r#"<Layer name="TOP" layerFunction="CONDUCTOR" side="TOP"/>"#);
        let stack = build(&d.ecad, &mut Warnings::default()).unwrap();
        assert_eq!(names(&stack), ["@soldermask-top", "TOP", "@core"]);
        close(stack.layers[1].z_max, 0.8e-3);
        close(stack.layers[2].z_min, -0.8e-3);
    }

    /// A document whose step has one feature on each of `featured`.
    fn doc_with_features(layers: &str, featured: &[&str]) -> ipc::Document {
        let features: String = featured
            .iter()
            .map(|l| {
                format!(
                    r#"<LayerFeature layerRef="{l}"><Set><Features><Location x="0" y="0"/>
                    <Circle diameter="1"/></Features></Set></LayerFeature>"#
                )
            })
            .collect();
        let xml = format!(
            r#"<IPC-2581 revision="C"><Content><FunctionMode mode="FABRICATION"/></Content>
            <Ecad name="b"><CadHeader units="MILLIMETER"/><CadData>{layers}<Step name="s">{features}</Step>
            </CadData></Ecad></IPC-2581>"#
        );
        ipc::parse_bytes(xml.as_bytes()).unwrap()
    }

    const KICAD_LAYERS: &str = r#"<Layer name="F.Cu" layerFunction="CONDUCTOR" side="TOP"/>
        <Layer name="B.Cu" layerFunction="CONDUCTOR" side="BOTTOM"/>
        <Layer name="F.Silkscreen" layerFunction="SILKSCREEN" side="TOP"/>
        <Layer name="F.Paste" layerFunction="SOLDERPASTE" side="TOP"/>
        <Layer name="B.Paste" layerFunction="SOLDERPASTE" side="BOTTOM"/>
        <Layer name="User.Comments" layerFunction="DOCUMENT" side="NONE"/>
        <Layer name="User.Eco1" layerFunction="DOCUMENT" side="NONE"/>
        <Layer name="F.Courtyard" layerFunction="COURTYARD" side="TOP"/>
        <Layer name="F.Fab" layerFunction="ASSEMBLY" side="TOP"/>
        <Layer name="B.Fab" layerFunction="ASSEMBLY" side="BOTTOM"/>
        <Layer name="F.Adhesive" layerFunction="GLUE" side="TOP"/>"#;

    fn optional_stack(d: &ipc::Document, synthesize: Synthesize) -> (Stack, Warnings) {
        let mut w = Warnings::default();
        let mut stack = build(&d.ecad, &mut w).unwrap();
        let step = d.ecad.steps.values().next().unwrap();
        add_optional(&mut stack, &d.ecad, step, synthesize, &mut w);
        (stack, w)
    }

    #[test]
    fn paste_and_drawings_are_placed_outside_the_surface() {
        let d = doc_with_features(
            KICAD_LAYERS,
            &[
                "F.Paste",
                "B.Paste",
                "User.Comments",
                "F.Courtyard",
                "F.Fab",
                "B.Fab",
                "F.Adhesive",
            ],
        );
        let (stack, w) = optional_stack(&d, Synthesize::default());
        assert_eq!(
            names(&stack),
            [
                "User.Comments",
                "F.Courtyard",
                "F.Fab",
                "F.Paste",
                "F.Silkscreen",
                "@soldermask-top",
                "F.Cu",
                "@core",
                "B.Cu",
                "@soldermask-bottom",
                "B.Paste",
                "B.Fab"
            ]
        );
        assert!(w.is_empty());
        let layer = |name: &str| &stack.layers[stack.index(name).unwrap()];
        // Paste stands on the copper, through the mask and silkscreen.
        close(layer("F.Paste").z_min, 0.8e-3);
        close(layer("F.Paste").z_max, 0.8e-3 + DEFAULT_PASTE);
        close(layer("B.Paste").z_max, -0.8e-3);
        close(layer("B.Paste").z_min, -0.8e-3 - DEFAULT_PASTE);
        // Drawings are stacked outward from the outermost surface (here the paste).
        let surface = 0.8e-3 + DEFAULT_PASTE;
        for (k, name) in ["F.Fab", "F.Courtyard", "User.Comments"].iter().enumerate() {
            close(layer(name).z_min, surface + k as f64 * DRAWING_THICKNESS);
            close(
                layer(name).z_max,
                surface + (k + 1) as f64 * DRAWING_THICKNESS,
            );
        }
        close(layer("B.Fab").z_max, -surface);
        assert_eq!(layer("User.Comments").side, Side::Top);
        assert_eq!(layer("B.Fab").side, Side::Bottom);
        assert_eq!(layer("F.Fab").role, Role::Assembly);
        for name in [
            "F.Paste",
            "B.Paste",
            "User.Comments",
            "F.Courtyard",
            "F.Fab",
        ] {
            assert!(!layer(name).visible(), "{name}");
            assert!(!layer(name).synthesized, "{name}");
        }
        assert!(layer("F.Silkscreen").visible());
    }

    #[test]
    fn paste_thickness_comes_from_the_stackup() {
        let layers = format!(
            r#"{KICAD_LAYERS}<Stackup name="S"><StackupGroup name="G">
              <StackupLayer layerOrGroupRef="F.Paste" thickness="0.12" sequence="0"/>
              <StackupLayer layerOrGroupRef="F.Cu" thickness="0.035" sequence="1"/>
              <StackupLayer layerOrGroupRef="B.Cu" thickness="0.035" sequence="2"/>
              <StackupLayer layerOrGroupRef="B.Paste" thickness="0" sequence="3"/>
            </StackupGroup></Stackup>"#
        );
        let d = doc_with_features(&layers, &["F.Paste", "B.Paste"]);
        let (stack, _) = optional_stack(&d, Synthesize::default());
        let paste = &stack.layers[stack.index("F.Paste").unwrap()];
        close(paste.z_max - paste.z_min, 0.12e-3);
        assert_eq!(paste.thickness_source, ThicknessSource::File);
        let paste = &stack.layers[stack.index("B.Paste").unwrap()];
        close(paste.z_max - paste.z_min, DEFAULT_PASTE);
        assert_eq!(paste.thickness_source, ThicknessSource::Default);
    }

    #[test]
    fn empty_and_extra_optional_layers_are_left_out() {
        let layers =
            format!(r#"{KICAD_LAYERS}<Layer name="P2" layerFunction="PASTEMASK" side="TOP"/>"#);
        let d = doc_with_features(&layers, &["F.Paste", "P2"]);
        let (stack, w) = optional_stack(&d, Synthesize::default());
        assert!(stack.index("F.Paste").is_some());
        assert!(stack.index("P2").is_none());
        assert!(stack.index("F.Fab").is_none(), "no features");
        assert_eq!(
            w.into_vec()[0].message,
            "layer `P2` is a second paste layer on its side and was skipped"
        );
    }

    #[test]
    fn package_drawings_get_synthesized_layers() {
        let d = doc_with_features(
            r#"<Layer name="TOP" layerFunction="CONDUCTOR" side="TOP"/>
            <Layer name="BOTTOM" layerFunction="CONDUCTOR" side="BOTTOM"/>
            <Layer name="DOC" layerFunction="DOCUMENT" side="BOTTOM"/>"#,
            &["DOC"],
        );
        let synthesize = Synthesize {
            silkscreen: [true, false],
            assembly: [true, true],
        };
        let (stack, _) = optional_stack(&d, synthesize);
        assert_eq!(
            names(&stack),
            [
                "@assembly-top",
                "@silkscreen-top",
                "@soldermask-top",
                "TOP",
                "@core",
                "BOTTOM",
                "@soldermask-bottom",
                "@assembly-bottom",
                "DOC"
            ]
        );
        let silk = &stack.layers[1];
        assert_eq!((silk.role, silk.synthesized), (Role::Silkscreen, true));
        assert!(silk.visible());
        close(silk.z_min, 0.82e-3);
        close(silk.z_max, 0.83e-3);
        let assembly = &stack.layers[0];
        assert_eq!(
            (assembly.role, assembly.synthesized),
            (Role::Assembly, true)
        );
        assert_eq!(assembly.ipc_function, None);
        close(assembly.z_min, 0.83e-3);
        close(stack.layers[7].z_max, -0.82e-3);
        close(stack.layers[8].z_max, -0.82e-3 - DRAWING_THICKNESS);
    }

    #[test]
    fn a_single_sided_board_has_no_bottom_drawings() {
        let d = doc_with_features(
            r#"<Layer name="TOP" layerFunction="CONDUCTOR" side="TOP"/>
            <Layer name="BF" layerFunction="ASSEMBLY" side="BOTTOM"/>"#,
            &["BF"],
        );
        let (stack, w) = optional_stack(&d, Synthesize::default());
        assert_eq!(names(&stack), ["@soldermask-top", "TOP", "@core"]);
        assert_eq!(
            w.into_vec()[0].message,
            "the board has no bottom side; layers BF were skipped"
        );
    }

    #[test]
    fn optional_functions_are_classified() {
        for (function, role) in [
            ("SOLDERPASTE", Role::Paste),
            ("PASTEMASK", Role::Paste),
            ("COURTYARD", Role::Courtyard),
            ("ASSEMBLY", Role::Assembly),
            ("DOCUMENT", Role::Documentation),
        ] {
            assert_eq!(classify(function), LayerClass::Layer(role), "{function}");
        }
        for function in [
            "GLUE",
            "PROBE",
            "VCUT",
            "SCORE",
            "BOARD_OUTLINE",
            "COATINGCOND",
        ] {
            assert_eq!(classify(function), LayerClass::Ignored, "{function}");
        }
    }

    #[test]
    fn no_copper_is_an_error() {
        let d = doc(r#"<Layer name="SST" layerFunction="SILKSCREEN" side="TOP"/>"#);
        assert!(build(&d.ecad, &mut Warnings::default()).is_err());
    }
}
