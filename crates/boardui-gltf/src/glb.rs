//! The GLB container: a JSON chunk and an optional binary chunk.

use crate::Root;
use std::fmt;

const MAGIC: &[u8; 4] = b"glTF";
const VERSION: u32 = 2;
const CHUNK_JSON: u32 = 0x4E4F_534A;
const CHUNK_BIN: u32 = 0x004E_4942;

/// Packs a glTF root and its binary buffer into a GLB file.
///
/// `root.buffers[0]` must describe `bin` (its `byteLength` is set here). The JSON chunk is
/// padded with spaces and the binary chunk with zeros to 4 bytes.
pub fn write(root: &Root, bin: &[u8]) -> Vec<u8> {
    let json = serde_json::to_vec(root).expect("glTF JSON serializes");
    let json_len = json.len().next_multiple_of(4);
    let bin_len = bin.len().next_multiple_of(4);
    let total = 12 + 8 + json_len + if bin.is_empty() { 0 } else { 8 + bin_len };
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&VERSION.to_le_bytes());
    out.extend_from_slice(&u32_len(total).to_le_bytes());
    out.extend_from_slice(&u32_len(json_len).to_le_bytes());
    out.extend_from_slice(&CHUNK_JSON.to_le_bytes());
    out.extend_from_slice(&json);
    out.resize(out.len() + json_len - json.len(), b' ');
    if !bin.is_empty() {
        out.extend_from_slice(&u32_len(bin_len).to_le_bytes());
        out.extend_from_slice(&CHUNK_BIN.to_le_bytes());
        out.extend_from_slice(bin);
        out.resize(out.len() + bin_len - bin.len(), 0);
    }
    out
}

fn u32_len(len: usize) -> u32 {
    u32::try_from(len).expect("GLB files are limited to 4 GiB")
}

/// A GLB file split into its chunks.
#[derive(Debug, Clone, Copy)]
pub struct Glb<'a> {
    /// The JSON chunk, without padding.
    pub json: &'a [u8],
    /// The binary chunk, if present.
    pub bin: Option<&'a [u8]>,
}

/// Why a file is not a readable GLB.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlbError(pub String);

impl fmt::Display for GlbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for GlbError {}

/// Splits a GLB file into its chunks.
///
/// # Errors
///
/// Returns an error for a wrong magic number or version, inconsistent lengths, or a missing
/// JSON chunk.
pub fn split(bytes: &[u8]) -> Result<Glb<'_>, GlbError> {
    let err = |message: &str| Err(GlbError(message.to_owned()));
    if bytes.len() < 20 || &bytes[0..4] != MAGIC {
        return err("not a GLB file (bad magic number)");
    }
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().expect("4 bytes"));
    if word(4) != VERSION {
        return err("unsupported GLB version (expected 2)");
    }
    let total = word(8) as usize;
    if total > bytes.len() {
        return err("GLB header length exceeds the file size");
    }
    let bytes = &bytes[..total];
    let mut at = 12;
    let mut json = None;
    let mut bin = None;
    while at + 8 <= bytes.len() {
        let len = word(at) as usize;
        let kind = word(at + 4);
        let start = at + 8;
        let Some(end) = start.checked_add(len).filter(|&end| end <= bytes.len()) else {
            return err("GLB chunk exceeds the file");
        };
        match kind {
            CHUNK_JSON if json.is_none() => json = Some(&bytes[start..end]),
            CHUNK_BIN if bin.is_none() && json.is_some() => bin = Some(&bytes[start..end]),
            _ => {}
        }
        at = end;
    }
    let Some(json) = json else {
        return err("GLB has no JSON chunk");
    };
    let json = json.trim_ascii_end();
    Ok(Glb { json, bin })
}

/// Reads a GLB file into its glTF root and binary chunk.
///
/// # Errors
///
/// Returns an error if the container is broken or the JSON is not a glTF root.
pub fn read(bytes: &[u8]) -> Result<(Root, &[u8]), GlbError> {
    let glb = split(bytes)?;
    let root: Root = serde_json::from_slice(glb.json)
        .map_err(|e| GlbError(format!("glTF JSON is invalid: {e}")))?;
    Ok((root, glb.bin.unwrap_or(&[])))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::{Asset, Buffer};

    #[test]
    fn round_trip() {
        let root = Root {
            asset: Asset {
                version: "2.0".into(),
                ..Asset::default()
            },
            buffers: vec![Buffer {
                byte_length: 5,
                uri: None,
            }],
            ..Root::default()
        };
        let glb = write(&root, &[1, 2, 3, 4, 5]);
        assert_eq!(glb.len() % 4, 0);
        let (back, bin) = read(&glb).unwrap();
        assert_eq!(back, root);
        assert_eq!(&bin[..5], &[1, 2, 3, 4, 5]);
    }

    #[test]
    fn rejects_garbage() {
        assert!(read(b"not a glb at all, really").is_err());
        let mut glb = write(&Root::default(), &[]);
        glb[8] = 0xff;
        assert!(read(&glb).is_err());
    }
}
