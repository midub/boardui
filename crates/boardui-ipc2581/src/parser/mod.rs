//! Recursive-descent reader over a quick-xml pull parser.
//!
//! Each `read_*` method is called with the element's start tag loaded in [`Parser::tag`], reads
//! the attributes it models, then consumes the element's children through
//! [`Parser::children`]. The model under construction lives in the parser so that references
//! can be checked as soon as their targets are known.

mod content;
mod refs;
mod shape;
mod step;
mod values;
mod xml;

#[cfg(test)]
mod tests;

use std::io::BufRead;
use std::mem::take;

use quick_xml::Reader;

use crate::diagnostic::Diagnostics;
use crate::{
    Content, DiagnosticKind, Document, Ecad, Error, ErrorKind, Layer, Position, RefKind, Span,
    Stackup, StackupGroup, StackupLayer, Step, Table, Units,
};
use refs::Deferred;
use xml::{Next, Tag};

pub(crate) struct Parser<R> {
    reader: Reader<R>,
    buf: Vec<u8>,
    /// Line of the reader position, 1-based.
    line: u64,
    tag: Tag,
    diagnostics: Diagnostics,
    /// Metres per source unit, while a unit is in effect.
    scale: Option<f64>,
    /// Nesting depth of `UserSpecial` elements, bounded to keep recursion finite.
    nesting: usize,
    content: Content,
    layers: Table<Layer>,
    stackups: Vec<Stackup>,
    steps: Table<Step>,
    /// The step being read.
    step: Step,
    /// Unresolved references to document-wide definitions, checked at the end.
    global_refs: Vec<Deferred>,
    /// Unresolved references within the current step, checked at its end.
    step_refs: Vec<Deferred>,
}

impl<R: BufRead> Parser<R> {
    pub(crate) fn new(reader: R) -> Self {
        Self {
            reader: Reader::from_reader(reader),
            buf: Vec::new(),
            line: 1,
            tag: Tag::default(),
            diagnostics: Diagnostics::default(),
            scale: None,
            nesting: 0,
            content: Content::default(),
            layers: Table::default(),
            stackups: Vec::new(),
            steps: Table::default(),
            step: Step::default(),
            global_refs: Vec::new(),
            step_refs: Vec::new(),
        }
    }

    pub(crate) fn parse(mut self) -> Result<Document, Error> {
        let root = match self.next("document")? {
            Next::Start => self.tag.name().to_owned(),
            Next::End | Next::Eof => String::new(),
        };
        if root != "IPC-2581" {
            return Err(Error::new(
                ErrorKind::NotIpc2581 { root },
                self.tag.position,
            ));
        }
        let position = self.tag.position;
        let revision = self.req_str("revision")?;
        if !matches!(revision.as_str(), "B" | "C") {
            self.warn(DiagnosticKind::UnsupportedRevision {
                revision: revision.clone(),
            });
        }

        let mut has_content = false;
        let mut ecad = None;
        self.children("IPC-2581", |p| match p.tag.name() {
            "Content" if !has_content => {
                has_content = true;
                p.read_content()
            }
            "Ecad" if ecad.is_none() => {
                ecad = Some(p.read_ecad()?);
                Ok(())
            }
            "Content" | "Ecad" => p.duplicate("IPC-2581"),
            _ => p.unknown("IPC-2581"),
        })?;
        if !has_content {
            return Err(missing_element("IPC-2581", "`Content`", position));
        }
        let (name, units) = ecad.ok_or_else(|| missing_element("IPC-2581", "`Ecad`", position))?;

        let refs = take(&mut self.global_refs);
        self.resolve_deferred(refs);
        Ok(Document {
            revision,
            content: self.content,
            ecad: Ecad {
                name,
                units,
                layers: self.layers,
                stackups: self.stackups,
                steps: self.steps,
            },
            diagnostics: self.diagnostics.into_vec(),
        })
    }

    /// Reads `Ecad`; layers, stack-ups and steps go into the parser. Returns the name and units.
    fn read_ecad(&mut self) -> Result<(String, Units), Error> {
        let position = self.tag.position;
        let name = self.req_str("name")?;
        let mut units = None;
        let mut has_cad_data = false;
        self.children("Ecad", |p| match p.tag.name() {
            "CadHeader" if units.is_none() => {
                let unit: Units = p.req_enum("units")?;
                units = Some(unit);
                p.scale = Some(unit.metres());
                p.leaf("CadHeader")
            }
            "CadData" if !has_cad_data => {
                if units.is_none() {
                    return Err(missing_element(
                        "Ecad",
                        "`CadHeader` before `CadData`",
                        p.tag.position,
                    ));
                }
                has_cad_data = true;
                p.read_cad_data()
            }
            "CadHeader" | "CadData" => p.duplicate("Ecad"),
            _ => p.unknown("Ecad"),
        })?;
        self.scale = None;
        let units = units.ok_or_else(|| missing_element("Ecad", "`CadHeader`", position))?;
        if !has_cad_data {
            return Err(missing_element("Ecad", "`CadData`", position));
        }
        Ok((name, units))
    }

    fn read_cad_data(&mut self) -> Result<(), Error> {
        self.children("CadData", |p| match p.tag.name() {
            "Layer" => {
                let position = p.tag.position;
                let layer = p.read_layer()?;
                insert(
                    &mut p.diagnostics,
                    &mut p.layers,
                    RefKind::Layer,
                    layer.name.clone(),
                    layer,
                    position,
                );
                Ok(())
            }
            "Stackup" => {
                let stackup = p.read_stackup()?;
                p.stackups.push(stackup);
                Ok(())
            }
            "Step" => p.read_step(),
            _ => p.unknown("CadData"),
        })
    }

    fn read_layer(&mut self) -> Result<Layer, Error> {
        let name = self.req_str("name")?;
        let function = self.req_str("layerFunction")?;
        let side = self.opt_enum("side")?;
        let polarity = self.opt_enum("polarity")?.unwrap_or_default();
        let mut span = None;
        self.children("Layer", |p| match p.tag.name() {
            "Span" if span.is_none() => {
                let from_layer = p.req_ref("fromLayer")?;
                let to_layer = p.req_ref("toLayer")?;
                p.check_ref(RefKind::Layer, &from_layer);
                p.check_ref(RefKind::Layer, &to_layer);
                p.leaf("Span")?;
                span = Some(Span {
                    from_layer,
                    to_layer,
                });
                Ok(())
            }
            "Span" => p.duplicate("Layer"),
            _ => p.unknown("Layer"),
        })?;
        Ok(Layer {
            name,
            function,
            side,
            polarity,
            span,
        })
    }

    fn read_stackup(&mut self) -> Result<Stackup, Error> {
        let mut stackup = Stackup {
            // Polar Speedstack and Altium omit it.
            name: self.str_or("name", "(unnamed)"),
            overall_thickness: self.opt_len("overallThickness")?,
            tol_plus: self.opt_len("tolPlus")?,
            tol_minus: self.opt_len("tolMinus")?,
            where_measured: self.opt_enum("whereMeasured")?,
            groups: Vec::new(),
        };
        self.children("Stackup", |p| match p.tag.name() {
            "StackupGroup" => {
                let group = p.read_stackup_group()?;
                stackup.groups.push(group);
                Ok(())
            }
            _ => p.unknown("Stackup"),
        })?;
        Ok(stackup)
    }

    fn read_stackup_group(&mut self) -> Result<StackupGroup, Error> {
        let mut group = StackupGroup {
            name: self.req_str("name")?,
            thickness: self.opt_len("thickness")?,
            tol_plus: self.opt_len("tolPlus")?,
            tol_minus: self.opt_len("tolMinus")?,
            layers: Vec::new(),
        };
        self.children("StackupGroup", |p| match p.tag.name() {
            "StackupLayer" => {
                let layer = StackupLayer {
                    layer_or_group_ref: p.req_ref("layerOrGroupRef")?,
                    thickness: p.opt_len("thickness")?,
                    tol_plus: p.opt_len("tolPlus")?,
                    tol_minus: p.opt_len("tolMinus")?,
                    sequence: p.opt_u32("sequence")?,
                };
                p.check_ref(RefKind::LayerOrGroup, &layer.layer_or_group_ref);
                p.leaf("StackupLayer")?;
                group.layers.push(layer);
                Ok(())
            }
            _ => p.unknown("StackupGroup"),
        })?;
        Ok(group)
    }

    /// Reads a reference element such as `LineDescRef`: its `attribute` names the target.
    fn read_ref(
        &mut self,
        element: &'static str,
        attribute: &str,
        kind: RefKind,
    ) -> Result<String, Error> {
        let key = self.req_ref(attribute)?;
        self.check_ref(kind, &key);
        self.leaf(element)?;
        Ok(key)
    }
}

/// Appends to a keyed table, reporting a duplicate key.
fn insert<T>(
    diagnostics: &mut Diagnostics,
    table: &mut Table<T>,
    kind: RefKind,
    key: String,
    value: T,
    position: Position,
) {
    if table.get(&key).is_some() {
        diagnostics.warn(
            DiagnosticKind::DuplicateKey {
                kind,
                key: key.clone(),
            },
            position,
        );
    }
    table.insert(key, value);
}

fn missing_element(element: &str, expected: &str, position: Position) -> Error {
    Error::new(
        ErrorKind::MissingElement {
            element: element.to_owned(),
            expected: expected.to_owned(),
        },
        position,
    )
}
