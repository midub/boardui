//! Unit tests over small XML snippets, one module per element family.

use crate::{Document, Error, parse_bytes};

/// Parses a document with the given `Content` children and, in `CadData`, `cad_data`.
fn doc(units: &str, content: &str, cad_data: &str) -> Result<Document, Error> {
    let xml = format!(
        r#"<?xml version="1.0"?>
<IPC-2581 revision="C" xmlns="http://webstds.ipc.org/2581">
<Content><FunctionMode mode="ASSEMBLY"/>{content}</Content>
<Ecad name="e"><CadHeader units="{units}"/><CadData>{cad_data}</CadData></Ecad>
</IPC-2581>"#
    );
    parse_bytes(xml.as_bytes())
}

#[test]
fn minimal_document() {
    let d = doc("INCH", "", "").unwrap();
    assert_eq!(d.revision, "C");
    assert_eq!(d.content.function_mode.as_deref(), Some("ASSEMBLY"));
    assert!(d.diagnostics.is_empty(), "{:?}", d.diagnostics);
}
