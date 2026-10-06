//! Layer colours from the source (spec §6.10).
//!
//! A layer's colour comes from the `Spec`s it refers to (`Layer/SpecRef` and
//! `StackupLayer/SpecRef` of the first stack-up): an explicit RGB colour (`Color`, or
//! `ColorRef` into `DictionaryColor`) is used as is; a colour name (`ColorTerm`, or a
//! `Property text="Color : <name>"` as KiCad writes it) is mapped to a realistic board colour.
//! Only soldermask and silkscreen are coloured; the other roles keep their defaults.

use boardui_gltf::Role;
use boardui_ipc2581 as ipc;

use crate::Warnings;
use crate::stackup::Stack;

/// Colour names with a realistic soldermask and silkscreen colour (sRGB). The soldermask colour
/// is drawn translucent (spec §7), the silkscreen colour opaque. Green soldermask and white
/// silkscreen are the profile's defaults.
const PALETTE: [(&str, [u8; 3], [u8; 3]); 11] = [
    ("green", [0x1E, 0x6B, 0x2E], [0x2F, 0x8F, 0x43]),
    ("red", [0xA0, 0x1C, 0x1C], [0xC6, 0x2B, 0x23]),
    ("blue", [0x1F, 0x4E, 0x9C], [0x2E, 0x5B, 0xB8]),
    ("purple", [0x4F, 0x23, 0x73], [0x6B, 0x3E, 0x94]),
    ("black", [0x15, 0x15, 0x15], [0x1C, 0x1C, 0x1C]),
    ("white", [0xE9, 0xE9, 0xE6], [0xF2, 0xF2, 0xF2]),
    ("yellow", [0xD4, 0xB4, 0x17], [0xEE, 0xD3, 0x3A]),
    ("orange", [0xC9, 0x60, 0x1C], [0xE2, 0x78, 0x2A]),
    ("brown", [0x5C, 0x3A, 0x1F], [0x7A, 0x50, 0x30]),
    ("pink", [0xC8, 0x5A, 0x8A], [0xE6, 0x8A, 0xAE]),
    ("gray", [0x5B, 0x60, 0x66], [0x8C, 0x8C, 0x8C]),
];

/// Words describing the finish rather than the colour, ignored in names.
const FINISHES: [&str; 5] = ["matte", "matt", "glossy", "gloss", "satin"];

/// Names that state no colour.
const UNSPECIFIED: [&str; 6] = [
    "",
    "not specified",
    "other",
    "user defined",
    "board",
    "boardpanel",
];

/// The result of looking up a colour name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Named {
    /// A colour, sRGB.
    Color([u8; 3]),
    /// The name states no colour, for example KiCad's `Not specified`.
    Unspecified,
    /// An unknown name.
    Unknown,
}

/// Maps a colour name to a realistic colour for `role`: case-insensitive, finish words such as
/// `Matte` ignored, `grey` read as `gray`. `#RRGGBB` and `#RRGGBBAA` (KiCad's user-defined
/// colours) are used as is.
pub(crate) fn named(role: Role, name: &str) -> Named {
    let name = name.trim();
    if let Some(hex) = name.strip_prefix('#') {
        return parse_hex(hex).map_or(Named::Unknown, Named::Color);
    }
    let lower = name.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty() && !FINISHES.contains(w))
        .map(|w| if w == "grey" { "gray" } else { w })
        .collect();
    let key = words.join(" ");
    if UNSPECIFIED.contains(&key.as_str()) {
        return Named::Unspecified;
    }
    match PALETTE.iter().find(|(n, ..)| *n == key) {
        Some(&(_, mask, silk)) => Named::Color(if role == Role::Silkscreen { silk } else { mask }),
        None => Named::Unknown,
    }
}

fn parse_hex(hex: &str) -> Option<[u8; 3]> {
    if !(hex.len() == 6 || hex.len() == 8) || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some([channel(0)?, channel(2)?, channel(4)?])
}

/// The colour of each layer of `stack` from the source, sRGB; `None` for the role's default.
/// Unknown colour names are reported once each and drawn in the default colour.
pub(crate) fn resolve(
    doc: &ipc::Document,
    stack: &Stack,
    warnings: &mut Warnings,
) -> Vec<Option<[u8; 3]>> {
    stack
        .layers
        .iter()
        .map(|layer| match layer.role {
            Role::Soldermask | Role::Silkscreen if !layer.synthesized => {
                layer_color(doc, &layer.name, layer.role, warnings)
            }
            _ => None,
        })
        .collect()
}

fn layer_color(
    doc: &ipc::Document,
    layer: &str,
    role: Role,
    warnings: &mut Warnings,
) -> Option<[u8; 3]> {
    let specs = specs(&doc.ecad, layer);
    let generals = || specs.iter().flat_map(|s| &s.general);
    // An explicit colour first, in any of the layer's specs.
    for general in generals() {
        let rgb = match &general.color {
            Some(ipc::SpecColor::Rgb(c)) => Some(c),
            Some(ipc::SpecColor::Ref(id)) => doc.content.colors.get(id),
            _ => None,
        };
        if let Some(c) = rgb {
            return Some([c.r, c.g, c.b]);
        }
    }
    // Then a colour name.
    for general in generals() {
        let term = match &general.color {
            Some(ipc::SpecColor::Term { name, comment }) => match comment {
                Some(comment) if name.eq_ignore_ascii_case("OTHER") => Some(comment.as_str()),
                _ => Some(name.as_str()),
            },
            _ => None,
        };
        let properties = general
            .properties
            .iter()
            .filter_map(|p| p.text.as_deref().and_then(color_property));
        for name in term.into_iter().chain(properties) {
            match named(role, name) {
                Named::Color(rgb) => return Some(rgb),
                Named::Unspecified => {}
                Named::Unknown => {
                    let role = format!("{role:?}").to_lowercase();
                    warnings.push(format!(
                        "unknown {role} colour `{}`; the default colour is used",
                        name.trim()
                    ));
                    return None;
                }
            }
        }
    }
    None
}

/// The name in a `Color : <name>` property text (KiCad), if it is one.
fn color_property(text: &str) -> Option<&str> {
    let (key, value) = text.split_once(':')?;
    let key = key.trim();
    (key.eq_ignore_ascii_case("color") || key.eq_ignore_ascii_case("colour")).then_some(value)
}

/// The specs `layer` refers to: its own `SpecRef`s, then those of its `StackupLayer`s in the
/// first stack-up, in document order.
fn specs<'a>(ecad: &'a ipc::Ecad, layer: &str) -> Vec<&'a ipc::Spec> {
    let own = ecad
        .layers
        .get(layer)
        .into_iter()
        .flat_map(|l| &l.spec_refs);
    let stacked = ecad
        .stackups
        .first()
        .into_iter()
        .flat_map(|s| &s.groups)
        .flat_map(|g| &g.layers)
        .filter(|l| l.layer_or_group_ref == layer)
        .flat_map(|l| &l.spec_refs);
    own.chain(stacked)
        .filter_map(|id| ecad.specs.get(id).or_else(|| kicad9_spec(ecad, layer, id)))
        .collect()
}

/// Whether a reader warning is about a dangling `SpecRef` that [`kicad9_spec`] resolves. Such
/// references are understood, so they are not reported.
pub(crate) fn is_recovered_spec_ref(ecad: &ipc::Ecad, kind: &ipc::DiagnosticKind) -> bool {
    let ipc::DiagnosticKind::DanglingReference {
        kind: ipc::RefKind::Spec,
        key,
    } = kind
    else {
        return false;
    };
    let layers = ecad.layers.values().map(|l| l.name.as_str());
    let stacked = ecad
        .stackups
        .iter()
        .flat_map(|s| &s.groups)
        .flat_map(|g| &g.layers)
        .map(|l| l.layer_or_group_ref.as_str());
    layers
        .chain(stacked)
        .any(|layer| kicad9_spec(ecad, layer, key).is_some())
}

/// KiCad 9 refers to a layer's spec as `SPEC_<layer>` but names it `<layer>_<n>`. For such a
/// dangling reference, the only spec named `<layer>_<digits>` is the one meant.
fn kicad9_spec<'a>(ecad: &'a ipc::Ecad, layer: &str, id: &str) -> Option<&'a ipc::Spec> {
    if id.strip_prefix("SPEC_") != Some(layer) {
        return None;
    }
    let mut candidates = ecad.specs.values().filter(|s| {
        s.name
            .strip_prefix(layer)
            .and_then(|rest| rest.strip_prefix('_'))
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
    });
    let spec = candidates.next()?;
    candidates.next().is_none().then_some(spec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_map_to_realistic_colours() {
        let blue_mask = Named::Color([0x1F, 0x4E, 0x9C]);
        for name in [
            "Blue",
            "BLUE",
            " blue ",
            "Matte Blue",
            "blue (glossy)",
            "Satin-Blue",
        ] {
            assert_eq!(named(Role::Soldermask, name), blue_mask, "{name}");
        }
        assert_eq!(
            named(Role::Silkscreen, "Blue"),
            Named::Color([0x2E, 0x5B, 0xB8])
        );
        assert_eq!(
            named(Role::Silkscreen, "Grey"),
            named(Role::Silkscreen, "GRAY")
        );
        // KiCad's mask and silkscreen names, and the ColorTerm list of IPC-2581C.
        for name in [
            "Green", "Red", "Blue", "Purple", "Black", "White", "Yellow", "ORANGE", "BROWN",
            "PINK", "GRAY",
        ] {
            assert!(
                matches!(named(Role::Soldermask, name), Named::Color(_)),
                "{name}"
            );
        }
    }

    #[test]
    fn defaults_are_the_profile_defaults() {
        use boardui_gltf::BuiltinMaterial;
        assert_eq!(
            named(Role::Soldermask, "Green"),
            Named::Color(BuiltinMaterial::Soldermask.base_color())
        );
        assert_eq!(
            named(Role::Silkscreen, "White"),
            Named::Color(BuiltinMaterial::Silkscreen.base_color())
        );
    }

    #[test]
    fn hex_colours_are_used_as_is() {
        assert_eq!(
            named(Role::Soldermask, "#00ff80"),
            Named::Color([0, 0xff, 0x80])
        );
        assert_eq!(
            named(Role::Silkscreen, "#102030D4"),
            Named::Color([0x10, 0x20, 0x30])
        );
        assert_eq!(named(Role::Silkscreen, "#1020"), Named::Unknown);
        assert_eq!(named(Role::Silkscreen, "#10203g"), Named::Unknown);
    }

    #[test]
    fn some_names_state_no_colour() {
        for name in ["Not specified", "OTHER", "", "User defined", "BOARD"] {
            assert_eq!(named(Role::Soldermask, name), Named::Unspecified, "{name}");
        }
        assert_eq!(named(Role::Soldermask, "Chartreuse"), Named::Unknown);
        assert_eq!(named(Role::Soldermask, "Light Blue"), Named::Unknown);
    }

    #[test]
    fn colour_properties() {
        assert_eq!(color_property("Color : Blue"), Some(" Blue"));
        assert_eq!(color_property("colour:Red"), Some("Red"));
        assert_eq!(color_property("Type : Top Solder Mask"), None);
        assert_eq!(color_property("SOLDERMASK"), None);
    }

    /// Layer names with their colours.
    type Colours = Vec<(String, Option<[u8; 3]>)>;

    /// The colours of `layers`, the converter's warnings and the reader's warnings that the
    /// converter keeps.
    fn colours(header: &str, layers: &str) -> (Colours, Vec<String>, Vec<String>) {
        let xml = format!(
            r#"<IPC-2581 revision="C"><Content>
<DictionaryColor><EntryColor id="C1"><Color r="1" g="2" b="3"/></EntryColor></DictionaryColor>
</Content><Ecad name="e"><CadHeader units="MILLIMETER">{header}</CadHeader><CadData>
<Layer name="TOP" layerFunction="CONDUCTOR" side="TOP"/>
{layers}
</CadData></Ecad></IPC-2581>"#
        );
        let doc = ipc::parse(xml.as_bytes()).unwrap();
        let mut warnings = Warnings::default();
        let stack = crate::stackup::build(&doc.ecad, &mut warnings).unwrap();
        let mut warnings = Warnings::default();
        let colours = resolve(&doc, &stack, &mut warnings);
        let named = stack.layers.iter().map(|l| l.name.clone()).zip(colours);
        let reader = doc.diagnostics.iter().map(|d| &d.kind);
        (
            named.collect(),
            warnings.into_vec().into_iter().map(|w| w.message).collect(),
            reader
                .filter(|k| !is_recovered_spec_ref(&doc.ecad, k))
                .map(ToString::to_string)
                .collect(),
        )
    }

    fn colour_of(list: &[(String, Option<[u8; 3]>)], layer: &str) -> Option<[u8; 3]> {
        list.iter().find(|(n, _)| n == layer).unwrap().1
    }

    #[test]
    fn explicit_colours_come_first() {
        let (list, warnings, reader) = colours(
            r#"<Spec name="NAME"><General type="MATERIAL"><Property text="Color : Red"/></General></Spec>
               <Spec name="REF"><General type="MATERIAL"><ColorRef id="C1"/></General></Spec>
               <Spec name="TERM"><General type="OTHER"><ColorTerm name="YELLOW"/></General></Spec>"#,
            r#"<Layer name="SM" layerFunction="SOLDERMASK" side="TOP"><SpecRef id="NAME"/><SpecRef id="REF"/></Layer>
               <Layer name="SS" layerFunction="SILKSCREEN" side="TOP"><SpecRef id="TERM"/></Layer>
               <Layer name="SM2" layerFunction="SOLDERMASK" side="BOTTOM"><SpecRef id="NAME"/></Layer>
               <Layer name="BOT" layerFunction="CONDUCTOR" side="BOTTOM"><SpecRef id="REF"/></Layer>"#,
        );
        assert_eq!(warnings, Vec::<String>::new());
        assert_eq!(reader, Vec::<String>::new());
        assert_eq!(colour_of(&list, "SM"), Some([1, 2, 3]));
        assert_eq!(colour_of(&list, "SS"), Some([0xEE, 0xD3, 0x3A]));
        assert_eq!(colour_of(&list, "SM2"), Some([0xA0, 0x1C, 0x1C]));
        // Copper keeps its default, and so do synthesized layers.
        assert_eq!(colour_of(&list, "BOT"), None);
        assert!(
            list.iter()
                .filter(|(n, _)| n.starts_with('@'))
                .all(|(_, c)| c.is_none())
        );
    }

    #[test]
    fn kicad9_spec_references_are_matched_by_name() {
        // As in KiCad 9 exports: the dictionary entries are not referenced, and the
        // `SpecRef`s name `SPEC_<layer>` while the specs are `<layer>_<n>`.
        let (list, warnings, reader) = colours(
            r#"<Spec name="F.Mask_2"><General type="MATERIAL"><Property text="SOLDERMASK"/><Property text="Color : Blue"/></General></Spec>
               <Spec name="F.Silkscreen_2"><General type="MATERIAL"><Property text="Color : Black"/></General></Spec>
               <Spec name="F.Silkscreen_3"><General type="MATERIAL"><Property text="Color : Red"/></General></Spec>
               <Spec name="B.Mask_2"><General type="MATERIAL"><Property text="Color : Chartreuse"/></General></Spec>"#,
            r#"<Layer name="F.Silkscreen" layerFunction="SILKSCREEN" side="TOP"/>
               <Layer name="F.Mask" layerFunction="SOLDERMASK" side="TOP"/>
               <Layer name="B.Mask" layerFunction="SOLDERMASK" side="BOTTOM"/>
               <Layer name="BOT" layerFunction="CONDUCTOR" side="BOTTOM"/>
               <Stackup name="S" overallThickness="1.6" tolPlus="0" tolMinus="0" whereMeasured="MASK"><StackupGroup name="G" thickness="1.6" tolPlus="0" tolMinus="0">
                 <StackupLayer layerOrGroupRef="F.Silkscreen" thickness="0.01"><SpecRef id="SPEC_F.Silkscreen"/></StackupLayer>
                 <StackupLayer layerOrGroupRef="F.Mask" thickness="0.01"><SpecRef id="SPEC_F.Mask"/></StackupLayer>
                 <StackupLayer layerOrGroupRef="TOP" thickness="0.035"><SpecRef id="SPEC_TOP"/></StackupLayer>
                 <StackupLayer layerOrGroupRef="BOT" thickness="0.035"/>
                 <StackupLayer layerOrGroupRef="B.Mask" thickness="0.01"><SpecRef id="SPEC_B.Mask"/></StackupLayer>
               </StackupGroup></Stackup>"#,
        );
        assert_eq!(colour_of(&list, "F.Mask"), Some([0x1F, 0x4E, 0x9C]));
        // Two candidates: ambiguous, so the default.
        assert_eq!(colour_of(&list, "F.Silkscreen"), None);
        assert_eq!(colour_of(&list, "B.Mask"), None);
        assert_eq!(
            warnings,
            ["unknown soldermask colour `Chartreuse`; the default colour is used"]
        );
        // Recognised references are not reported; `SPEC_TOP` has no `TOP_<n>` spec.
        assert_eq!(
            reader,
            [
                "reference to unknown spec `SPEC_F.Silkscreen`",
                "reference to unknown spec `SPEC_TOP`"
            ]
        );
    }
}
