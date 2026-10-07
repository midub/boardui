//! Assembly data: `LogisticHeader` enterprises, `HistoryRecord`, `Bom` and `Avl`.
//!
//! Only what describes the parts is modelled. Administrative data (roles, persons, change
//! records, certifications, BOM and AVL headers, quantities, dates) is skipped without a
//! warning: it is not geometry and not part metadata.

use std::io::BufRead;

use super::{Parser, insert};
use crate::{
    Avl, AvlItem, AvlMpn, AvlVmpn, Bom, BomItem, BomRefDes, Characteristic, CharacteristicValue,
    Enterprise, Error, HistoryRecord, RefKind, SoftwarePackage,
};

impl<R: BufRead> Parser<R> {
    /// Marks attributes as read without modelling them.
    fn ignore_attributes(&mut self, attributes: &[&str]) {
        for attribute in attributes {
            self.tag.take(attribute);
        }
    }

    pub(super) fn read_logistic_header(&mut self) -> Result<(), Error> {
        self.children("LogisticHeader", |p| match p.tag.name() {
            "Enterprise" => {
                let position = p.tag.position;
                let enterprise = Enterprise {
                    id: p.req_str("id")?,
                    name: p.opt_str("name"),
                    code: p.opt_str("code"),
                };
                p.ignore_attributes(&[
                    "codeType",
                    "address1",
                    "address2",
                    "city",
                    "stateProvince",
                    "country",
                    "postalCode",
                    "phone",
                    "fax",
                    "email",
                    "url",
                ]);
                p.leaf("Enterprise")?;
                insert(
                    &mut p.diagnostics,
                    &mut p.enterprises,
                    RefKind::Enterprise,
                    enterprise.id.clone(),
                    enterprise,
                    position,
                );
                Ok(())
            }
            "Role" | "Person" => p.skip(),
            _ => p.unknown("LogisticHeader"),
        })
    }

    pub(super) fn read_history_record(&mut self) -> Result<HistoryRecord, Error> {
        let mut history = HistoryRecord {
            software: self.opt_str("software"),
            software_package: None,
        };
        self.ignore_attributes(&[
            "number",
            "origination",
            "lastChange",
            "lifecyclePhase",
            "externalConfigurationEntryPoint",
        ]);
        self.children("HistoryRecord", |p| match p.tag.name() {
            "FileRevision" => {
                p.ignore_attributes(&["fileRevisionId", "comment", "label"]);
                p.children("FileRevision", |p| match p.tag.name() {
                    "SoftwarePackage" if history.software_package.is_none() => {
                        let package = SoftwarePackage {
                            name: p.req_str("name")?,
                            revision: p.opt_str("revision"),
                            vendor: p.opt_str("vendor"),
                            model: p.opt_str("model"),
                        };
                        p.children("SoftwarePackage", |p| match p.tag.name() {
                            "Certification" => p.skip(),
                            _ => p.unknown("SoftwarePackage"),
                        })?;
                        history.software_package = Some(package);
                        Ok(())
                    }
                    "SoftwarePackage" => p.duplicate("FileRevision"),
                    _ => p.unknown("FileRevision"),
                })
            }
            "ChangeRec" => p.skip(),
            _ => p.unknown("HistoryRecord"),
        })?;
        Ok(history)
    }

    pub(super) fn read_bom(&mut self) -> Result<Bom, Error> {
        let mut bom = Bom {
            name: self.opt_str("name").unwrap_or_default(),
            items: Vec::new(),
        };
        self.children("Bom", |p| match p.tag.name() {
            "BomHeader" => p.skip(),
            "BomItem" => {
                let item = p.read_bom_item()?;
                bom.items.push(item);
                Ok(())
            }
            _ => p.unknown("Bom"),
        })?;
        Ok(bom)
    }

    fn read_bom_item(&mut self) -> Result<BomItem, Error> {
        let mut item = BomItem {
            oem_design_number_ref: self.opt_str("OEMDesignNumberRef"),
            internal_part_number: self.opt_str("internalPartNumber"),
            description: self.opt_str("description"),
            category: self.opt_str("category"),
            ..BomItem::default()
        };
        // `numberIO` and `packageRef` are written by Altium (revision A).
        self.ignore_attributes(&["quantity", "pinCount", "numberIO", "packageRef"]);
        self.children("BomItem", |p| match p.tag.name() {
            "RefDes" => {
                let ref_des = BomRefDes {
                    name: p.req_str("name")?,
                    package_ref: p.opt_str("packageRef"),
                    populate: p.opt_bool("populate")?,
                    layer_ref: p.opt_str("layerRef"),
                };
                p.ignore_attributes(&["modelRef"]);
                p.children("RefDes", |p| match p.tag.name() {
                    "Tuning" | "Firmware" => p.skip(),
                    _ => p.unknown("RefDes"),
                })?;
                item.ref_des.push(ref_des);
                Ok(())
            }
            // Other designators: materials, documents and tools.
            "MatDes" | "DocDes" | "ToolDes" | "SpecRef" => p.skip(),
            "Characteristics" => {
                p.ignore_attributes(&["category"]);
                p.children("Characteristics", |p| {
                    let characteristic = p.read_characteristic()?;
                    item.characteristics.extend(characteristic);
                    Ok(())
                })
            }
            _ => p.unknown("BomItem"),
        })?;
        Ok(item)
    }

    /// Reads a child of `Characteristics`; returns `None` for an unknown one.
    fn read_characteristic(&mut self) -> Result<Option<Characteristic>, Error> {
        let element = match self.tag.name() {
            "Textual" => "Textual",
            "Enumerated" => "Enumerated",
            "Measured" => "Measured",
            "Ranged" => "Ranged",
            _ => return self.unknown("Characteristics").map(|()| None),
        };
        let definition_source = self.opt_str("definitionSource");
        let (name, value) = match element {
            "Textual" => (
                self.opt_str("textualCharacteristicName"),
                CharacteristicValue::Textual(self.opt_str("textualCharacteristicValue")),
            ),
            "Enumerated" => (
                self.opt_str("enumeratedCharacteristicName"),
                CharacteristicValue::Enumerated(self.opt_str("enumeratedCharacteristicValue")),
            ),
            "Measured" => (
                self.opt_str("measuredCharacteristicName"),
                CharacteristicValue::Measured {
                    value: self.opt_str("measuredCharacteristicValue"),
                    unit: self.opt_str("engineeringUnitOfMeasure"),
                    negative_tolerance: self.opt_str("engineeringNegativeTolerance"),
                    positive_tolerance: self.opt_str("engineeringPositiveTolerance"),
                },
            ),
            _ => (
                self.opt_str("rangedCharacteristicName"),
                CharacteristicValue::Ranged {
                    lower: self.opt_str("rangedCharacteristicLowerValue"),
                    upper: self.opt_str("rangedCharacteristicUpperValue"),
                    unit: self.opt_str("engineeringUnitOfMeasure"),
                    negative_tolerance: self.opt_str("engineeringNegativeTolerance"),
                    positive_tolerance: self.opt_str("engineeringPositiveTolerance"),
                },
            ),
        };
        self.leaf(element)?;
        Ok(Some(Characteristic {
            definition_source,
            name,
            value,
        }))
    }

    pub(super) fn read_avl(&mut self) -> Result<Avl, Error> {
        let mut avl = Avl {
            name: self.opt_str("name").unwrap_or_default(),
            ..Avl::default()
        };
        self.children("Avl", |p| match p.tag.name() {
            "AvlHeader" => p.skip(),
            "AvlItem" => {
                let position = p.tag.position;
                let item = p.read_avl_item()?;
                insert(
                    &mut p.diagnostics,
                    &mut avl.items,
                    RefKind::AvlItem,
                    item.oem_design_number.clone(),
                    item,
                    position,
                );
                Ok(())
            }
            _ => p.unknown("Avl"),
        })?;
        Ok(avl)
    }

    fn read_avl_item(&mut self) -> Result<AvlItem, Error> {
        let mut item = AvlItem {
            oem_design_number: self.req_str("OEMDesignNumber")?,
            vmpns: Vec::new(),
        };
        self.children("AvlItem", |p| match p.tag.name() {
            "AvlVmpn" => {
                let mut vmpn = AvlVmpn {
                    qualified: p.opt_bool("qualified")?,
                    chosen: p.opt_bool("chosen")?,
                    ..AvlVmpn::default()
                };
                p.ignore_attributes(&["evplVendor", "evplMpn"]);
                p.children("AvlVmpn", |p| match p.tag.name() {
                    "AvlMpn" if vmpn.mpn.is_none() => {
                        let mpn = AvlMpn {
                            name: p.req_str("name")?,
                            rank: p.opt_u32("rank")?,
                        };
                        p.ignore_attributes(&[
                            "cost",
                            "moistureSensitivity",
                            "availability",
                            "other",
                        ]);
                        p.leaf("AvlMpn")?;
                        vmpn.mpn = Some(mpn);
                        Ok(())
                    }
                    "AvlVendor" if vmpn.vendor.is_none() => {
                        let vendor = p.opt_str("enterpriseRef").filter(|v| !v.is_empty());
                        if let Some(vendor) = &vendor {
                            p.check_ref(RefKind::Enterprise, vendor);
                        }
                        p.leaf("AvlVendor")?;
                        vmpn.vendor = vendor;
                        Ok(())
                    }
                    "AvlMpn" | "AvlVendor" => p.duplicate("AvlVmpn"),
                    _ => p.unknown("AvlVmpn"),
                })?;
                item.vmpns.push(vmpn);
                Ok(())
            }
            "SpecRef" => p.skip(),
            _ => p.unknown("AvlItem"),
        })?;
        Ok(item)
    }
}
