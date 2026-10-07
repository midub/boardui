//! Streaming IPC-2581 reader producing a typed board model.
//!
//! [`parse`] reads an IPC-2581 revision B or C file with a pull parser (no DOM) and returns a
//! [`Document`]: the content dictionaries, layers, stack-ups and steps, with every length
//! converted to metres, and the assembly data: the bills of materials with their part
//! characteristics, the approved vendor list and the software that wrote the file. Shapes are
//! described as written in the file; turning them into geometry is up to the caller
//! (`boardui-geom`). The `PadStack`s of revision A and B steps (Altium writes them) are kept as
//! written, in [`Step::pad_stacks`].
//!
//! ```
//! let xml = br#"<IPC-2581 revision="C">
//!   <Content><FunctionMode mode="ASSEMBLY"/></Content>
//!   <Ecad name="board">
//!     <CadHeader units="MILLIMETER"/>
//!     <CadData>
//!       <Layer name="TOP" layerFunction="CONDUCTOR" side="TOP"/>
//!       <Step name="pcb">
//!         <LayerFeature layerRef="TOP">
//!           <Set net="GND">
//!             <Hole name="H1" diameter="0.3" platingStatus="VIA" plusTol="0" minusTol="0" x="1" y="2"/>
//!           </Set>
//!         </LayerFeature>
//!       </Step>
//!     </CadData>
//!   </Ecad>
//! </IPC-2581>"#;
//! let doc = boardui_ipc2581::parse_bytes(xml)?;
//! let step = doc.ecad.steps.get("pcb").unwrap();
//! assert_eq!(step.nets(), ["GND"]);
//! assert!(doc.diagnostics.is_empty());
//! # Ok::<(), boardui_ipc2581::Error>(())
//! ```
//!
//! # Diagnostics
//!
//! - Elements and attributes the reader does not model are skipped and recorded in
//!   [`Document::diagnostics`] as warnings. Repeated warnings are merged into one entry with an
//!   occurrence count and the position of the first occurrence.
//! - References to dictionary entries, layers, packages, components, padstacks and pins are
//!   checked once their targets are known; dangling ones are warnings.
//! - Malformed XML, malformed values, missing required attributes or elements, and empty
//!   references are [`Error`]s carrying the position of the offending element.

mod diagnostic;
mod error;
mod model;
mod parser;
mod shape;
mod table;

use std::io::BufRead;

pub use diagnostic::{Diagnostic, DiagnosticKind, RefKind};
pub use error::{Error, ErrorKind, Position};
pub use model::{
    Avl, AvlItem, AvlMpn, AvlVmpn, Bom, BomItem, BomRefDes, Characteristic, CharacteristicValue,
    Component, Content, Document, Ecad, Enterprise, Feature, FeatureElement, Features, Fiducial,
    FiducialKind, HistoryRecord, Hole, Layer, LayerFeature, LayerHole, LayerPad, Marking,
    MountType, Package, PackageDrawing, Pad, PadStack, PadUsage, PadUse, PadstackDef, PadstackPad,
    Pin, PinRef, PlatingStatus, Polarity, Set, Side, SlotCavity, SoftwarePackage, Span, Spec,
    SpecColor, SpecGeneral, SpecProperty, Stackup, StackupGroup, StackupLayer, Step, StepRepeat,
    Units, WhereMeasured,
};
pub use shape::{
    Arc, ButterflyShape, Color, Contour, Corners, EmbeddedFont, FillDesc, FillProperty, FillStyle,
    Font, Glyph, Line, LineDesc, LineEnd, LineProperty, LineStyle, Moire, Outline, Path, Point,
    PolyStep, Polygon, Polyline, PrimitiveKind, RingShape, Shape, StandardPrimitive, Text, Xform,
};
pub use table::Table;

/// Parses an IPC-2581 document from a buffered reader.
///
/// The input is streamed: memory use is proportional to the resulting model, not to the size
/// of the XML.
///
/// # Errors
///
/// Returns an [`Error`] for malformed XML, malformed attribute values, missing required
/// attributes or elements, empty references and I/O failures.
pub fn parse(reader: impl BufRead) -> Result<Document, Error> {
    parser::Parser::new(reader).parse()
}

/// Parses an IPC-2581 document held in memory.
///
/// # Errors
///
/// See [`parse`].
pub fn parse_bytes(bytes: &[u8]) -> Result<Document, Error> {
    parse(bytes)
}
