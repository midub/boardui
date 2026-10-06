//! Layer classification, stack-up order and Z ranges (spec §6.4–§6.6).

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

/// What the converter does with a layer, by its `layerFunction`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayerClass {
    /// A physical layer that becomes a layer node.
    Physical(Role),
    /// A drill or rout layer: holes and slots.
    Drill,
    /// Not converted (paste, documentation, courtyard, …).
    Ignored,
}

/// Classifies an IPC-2581 `layerFunction`.
pub fn classify(function: &str) -> LayerClass {
    match function.to_ascii_uppercase().as_str() {
        "CONDUCTOR" | "SIGNAL" | "PLANE" | "MIXED" | "CONDFOIL" | "CONDFILM" | "POWER_GROUND" => {
            LayerClass::Physical(Role::Copper)
        }
        "DIELCORE" | "DIELPREG" | "DIELBASE" | "DIELADHV" | "DIELECTRIC" | "DIELCOVERLAY" => {
            LayerClass::Physical(Role::Dielectric)
        }
        "SOLDERMASK" => LayerClass::Physical(Role::Soldermask),
        "SILKSCREEN" | "LEGEND" => LayerClass::Physical(Role::Silkscreen),
        "DRILL" | "ROUT" | "ROUTE" => LayerClass::Drill,
        _ => LayerClass::Ignored,
    }
}

/// A physical layer with its Z range.
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
    /// Suggested default visibility: inner copper and dielectric are hidden (spec §8.3).
    pub fn visible(&self) -> bool {
        match self.role {
            Role::Dielectric => false,
            Role::Copper => self.side != Side::Internal,
            Role::Soldermask | Role::Silkscreen => true,
        }
    }
}

/// The board's physical layers, top to bottom.
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
            LayerClass::Physical(role) => Some(Entry {
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
                    Role::Dielectric => None,
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
        assert!(!core.visible());
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

    #[test]
    fn no_copper_is_an_error() {
        let d = doc(r#"<Layer name="SST" layerFunction="SILKSCREEN" side="TOP"/>"#);
        assert!(build(&d.ecad, &mut Warnings::default()).is_err());
    }
}
