//! Component attributes and the populate flag from the BOM and the AVL (spec §8.2).

use std::collections::HashMap;

use boardui_gltf::ComponentAsset;

use crate::ipc;

/// The BOM data of one component.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct PartData {
    /// `RefDes@populate`.
    pub populate: Option<bool>,
    /// Attributes as `(name, value)`, with unique names and non-empty values.
    pub attributes: Vec<(String, String)>,
}

/// The BOM of a document, by reference designator.
pub(crate) struct Bom<'a> {
    doc: &'a ipc::Document,
    /// The first `RefDes` of each name over all `Bom`s, with its item.
    by_ref_des: HashMap<&'a str, (&'a ipc::BomItem, &'a ipc::BomRefDes)>,
    /// Attributes of each item, by item address, computed once.
    attributes: HashMap<*const ipc::BomItem, Vec<(String, String)>>,
}

impl<'a> Bom<'a> {
    pub(crate) fn new(doc: &'a ipc::Document) -> Self {
        let mut by_ref_des = HashMap::new();
        for item in doc.boms.iter().flat_map(|b| &b.items) {
            for ref_des in &item.ref_des {
                by_ref_des
                    .entry(ref_des.name.as_str())
                    .or_insert((item, ref_des));
            }
        }
        Self {
            doc,
            by_ref_des,
            attributes: HashMap::new(),
        }
    }

    /// The BOM data of the component with this refDes; empty without a BOM entry.
    pub(crate) fn part(&mut self, ref_des: &str) -> PartData {
        let Some(&(item, entry)) = self.by_ref_des.get(ref_des) else {
            return PartData::default();
        };
        let doc = self.doc;
        let attributes = self
            .attributes
            .entry(std::ptr::from_ref(item))
            .or_insert_with(|| attributes(doc, item))
            .clone();
        PartData {
            populate: entry.populate,
            attributes,
        }
    }

    /// Sets the populate flag and attributes of every component.
    pub(crate) fn annotate(&mut self, components: &mut [ComponentAsset]) {
        for c in components {
            let part = self.part(&c.ref_des);
            c.populate = part.populate;
            c.attributes = part.attributes;
        }
    }
}

/// The attributes of a BOM item (spec §8.2): its characteristics in document order, then
/// `Description`, `MPN` and `Manufacturer`. A name that is already taken keeps its value;
/// empty names and values are left out.
pub(crate) fn attributes(doc: &ipc::Document, item: &ipc::BomItem) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut push = |name: &str, value: String| {
        if name.trim().is_empty() || value.trim().is_empty() || out.iter().any(|(n, _)| n == name) {
            return;
        }
        out.push((name.to_owned(), value));
    };
    for c in &item.characteristics {
        if let Some(name) = &c.name {
            push(name, characteristic_value(&c.value));
        }
    }
    if let Some(description) = &item.description {
        push("Description", description.clone());
    }
    if let Some(vmpn) = preferred_vmpn(doc, item) {
        if let Some(mpn) = &vmpn.mpn {
            push("MPN", mpn.name.clone());
        }
        let manufacturer = vmpn
            .vendor
            .as_deref()
            .and_then(|id| doc.enterprises.get(id))
            .and_then(|e| e.name.clone());
        if let Some(manufacturer) = manufacturer {
            push("Manufacturer", manufacturer);
        }
    }
    out
}

/// A characteristic's value as one string: the value as written, a range as
/// `<lower>..<upper>` (a missing bound left empty), followed by a space and the unit.
fn characteristic_value(value: &ipc::CharacteristicValue) -> String {
    let with_unit = |value: String, unit: &Option<String>| match unit.as_deref().map(str::trim) {
        Some(unit) if !unit.is_empty() && !value.is_empty() => format!("{value} {unit}"),
        _ => value,
    };
    match value {
        ipc::CharacteristicValue::Textual(v) | ipc::CharacteristicValue::Enumerated(v) => {
            v.clone().unwrap_or_default()
        }
        ipc::CharacteristicValue::Measured { value, unit, .. } => {
            with_unit(value.clone().unwrap_or_default(), unit)
        }
        ipc::CharacteristicValue::Ranged {
            lower, upper, unit, ..
        } => {
            let range = match (lower.as_deref(), upper.as_deref()) {
                (None, None) => String::new(),
                (lower, upper) => {
                    format!(
                        "{}..{}",
                        lower.unwrap_or_default(),
                        upper.unwrap_or_default()
                    )
                }
            };
            with_unit(range, unit)
        }
    }
}

/// The AVL entry of the item's part with a part number: `chosen` first, then `qualified`,
/// then the lowest `rank` (unranked last), then the first in document order.
fn preferred_vmpn<'d>(doc: &'d ipc::Document, item: &ipc::BomItem) -> Option<&'d ipc::AvlVmpn> {
    let part = item.oem_design_number_ref.as_deref()?;
    let entry = doc.avl.as_ref()?.items.get(part)?;
    entry
        .vmpns
        .iter()
        .filter(|v| v.mpn.as_ref().is_some_and(|m| !m.name.trim().is_empty()))
        .min_by_key(|v| {
            (
                v.chosen != Some(true),
                v.qualified != Some(true),
                v.mpn.as_ref().and_then(|m| m.rank).unwrap_or(u32::MAX),
            )
        })
}

/// The software that wrote the file: `HistoryRecord/FileRevision/SoftwarePackage`.
pub(crate) fn software(doc: &ipc::Document) -> Option<boardui_gltf::Software> {
    let package = doc.history.as_ref()?.software_package.as_ref()?;
    let present = |s: &Option<String>| s.clone().filter(|s| !s.trim().is_empty());
    (!package.name.trim().is_empty()).then(|| boardui_gltf::Software {
        name: package.name.clone(),
        revision: present(&package.revision),
        vendor: present(&package.vendor),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(before: &str, after: &str) -> ipc::Document {
        let xml = format!(
            r#"<IPC-2581 revision="C"><Content/>{before}
<Ecad name="e"><CadHeader units="MILLIMETER"/><CadData/></Ecad>{after}</IPC-2581>"#
        );
        ipc::parse_bytes(xml.as_bytes()).unwrap()
    }

    fn pairs(attributes: &[(String, String)]) -> Vec<(&str, &str)> {
        attributes
            .iter()
            .map(|(n, v)| (n.as_str(), v.as_str()))
            .collect()
    }

    #[test]
    fn attributes_follow_the_rules() {
        let d = doc(
            r#"<LogisticHeader><Enterprise id="V0" name="Yageo" code="NONE"/><Enterprise id="V1" code="NONE"/></LogisticHeader>
               <Bom name="B"><BomItem OEMDesignNumberRef="R_10k" quantity="2" category="ELECTRICAL" description="Resistor">
                 <RefDes name="R1" populate="true"/><RefDes name="R2" populate="false"/>
                 <Characteristics category="ELECTRICAL">
                   <Textual textualCharacteristicName="Value" textualCharacteristicValue="10k"/>
                   <Textual textualCharacteristicName="Value" textualCharacteristicValue="later"/>
                   <Textual textualCharacteristicName="Empty" textualCharacteristicValue=""/>
                   <Textual textualCharacteristicValue="nameless"/>
                   <Measured measuredCharacteristicName="Power" measuredCharacteristicValue="0.1" engineeringUnitOfMeasure="W"/>
                   <Ranged rangedCharacteristicName="Temperature" rangedCharacteristicLowerValue="-55" rangedCharacteristicUpperValue="155" engineeringUnitOfMeasure="CEL"/>
                   <Ranged rangedCharacteristicName="Max" rangedCharacteristicUpperValue="50" engineeringUnitOfMeasure="V"/>
                   <Enumerated enumeratedCharacteristicName="Series" enumeratedCharacteristicValue="RC0402"/>
                   <Textual textualCharacteristicName="MPN" textualCharacteristicValue="from-field"/>
                 </Characteristics>
               </BomItem>
               <BomItem OEMDesignNumberRef="C_1u" quantity="1" category="ELECTRICAL">
                 <RefDes name="C1"/><Characteristics category="ELECTRICAL"/>
               </BomItem></Bom>"#,
            r#"<Avl name="L">
                 <AvlItem OEMDesignNumber="R_10k">
                   <AvlVmpn><AvlMpn name="RC0402FR-0710KL" rank="2"/><AvlVendor enterpriseRef="V0"/></AvlVmpn>
                 </AvlItem>
                 <AvlItem OEMDesignNumber="C_1u">
                   <AvlVmpn><AvlMpn name="third" rank="1"/><AvlVendor enterpriseRef="V0"/></AvlVmpn>
                   <AvlVmpn qualified="true"><AvlMpn name="second"/><AvlVendor enterpriseRef="V0"/></AvlVmpn>
                   <AvlVmpn chosen="true"><AvlMpn name="first"/><AvlVendor enterpriseRef="V1"/></AvlVmpn>
                 </AvlItem>
               </Avl>"#,
        );
        let mut bom = Bom::new(&d);
        let r1 = bom.part("R1");
        assert_eq!(r1.populate, Some(true));
        assert_eq!(
            pairs(&r1.attributes),
            [
                ("Value", "10k"),
                ("Power", "0.1 W"),
                ("Temperature", "-55..155 CEL"),
                ("Max", "..50 V"),
                ("Series", "RC0402"),
                ("MPN", "from-field"),
                ("Description", "Resistor"),
                ("Manufacturer", "Yageo"),
            ]
        );
        let r2 = bom.part("R2");
        assert_eq!(r2.populate, Some(false));
        assert_eq!(r2.attributes, r1.attributes);
        // `chosen` wins; its vendor has no name.
        assert_eq!(pairs(&bom.part("C1").attributes), [("MPN", "first")]);
        assert_eq!(bom.part("C1").populate, None);
        assert_eq!(bom.part("U1"), PartData::default());
    }

    #[test]
    fn the_first_ref_des_wins_and_software_is_read() {
        let d = doc(
            r#"<HistoryRecord software="x"><FileRevision fileRevisionId="1" comment=""><SoftwarePackage name="KiCad" revision="9.0.9" vendor=""/></FileRevision></HistoryRecord>
               <Bom name="A"><BomItem OEMDesignNumberRef="P" quantity="1" category="ELECTRICAL" description="first"><RefDes name="U1" populate="false"/><Characteristics category="ELECTRICAL"/></BomItem></Bom>
               <Bom name="B"><BomItem OEMDesignNumberRef="Q" quantity="1" category="ELECTRICAL" description="second"><RefDes name="U1" populate="true"/><Characteristics category="ELECTRICAL"/></BomItem></Bom>"#,
            "",
        );
        let mut bom = Bom::new(&d);
        let u1 = bom.part("U1");
        assert_eq!(u1.populate, Some(false));
        assert_eq!(pairs(&u1.attributes), [("Description", "first")]);
        assert_eq!(
            software(&d),
            Some(boardui_gltf::Software {
                name: "KiCad".into(),
                revision: Some("9.0.9".into()),
                vendor: None
            })
        );
        assert_eq!(software(&doc("", "")), None);
    }
}
