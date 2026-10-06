//! Building the binary buffer of an asset, and reading accessors back.

use crate::json::{
    ARRAY_BUFFER, Accessor, Buffer, BufferView, ELEMENT_ARRAY_BUFFER, FLOAT, Root, UNSIGNED_BYTE,
    UNSIGNED_INT, UNSIGNED_SHORT, component_size,
};

/// Alignment of every buffer view. `EXT_structural_metadata` requires 8 bytes for property
/// table data; glTF requires 4 for vertex data.
const ALIGN: usize = 8;

/// A glTF root under construction, with its binary buffer.
#[derive(Debug, Default)]
pub struct AssetBuilder {
    /// The JSON part.
    pub root: Root,
    /// The binary buffer (GLB `BIN` chunk).
    pub bin: Vec<u8>,
}

impl AssetBuilder {
    /// Appends a buffer view holding `bytes`.
    pub fn push_view(&mut self, bytes: &[u8], stride: Option<u32>, target: Option<u32>) -> u32 {
        self.bin.resize(self.bin.len().next_multiple_of(ALIGN), 0);
        let view = BufferView {
            buffer: 0,
            byte_offset: self.bin.len() as u64,
            byte_length: bytes.len() as u64,
            byte_stride: stride,
            target,
        };
        self.bin.extend_from_slice(bytes);
        push(&mut self.root.buffer_views, view)
    }

    /// Appends an accessor.
    pub fn push_accessor(&mut self, accessor: Accessor) -> u32 {
        push(&mut self.root.accessors, accessor)
    }

    /// Appends `POSITION`-style `VEC3` float data with its bounds.
    pub fn push_vec3(&mut self, values: &[[f32; 3]], with_bounds: bool) -> u32 {
        let mut bytes = Vec::with_capacity(values.len() * 12);
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for v in values {
            for k in 0..3 {
                bytes.extend_from_slice(&v[k].to_le_bytes());
                min[k] = min[k].min(v[k]);
                max[k] = max[k].max(v[k]);
            }
        }
        let view = self.push_view(&bytes, None, Some(ARRAY_BUFFER));
        let bounds = |b: [f32; 3]| Some(b.iter().map(|&x| f64::from(x)).collect());
        self.push_accessor(Accessor {
            buffer_view: Some(view),
            component_type: FLOAT,
            count: values.len() as u64,
            kind: "VEC3".into(),
            min: if with_bounds { bounds(min) } else { None },
            max: if with_bounds { bounds(max) } else { None },
            ..Accessor::default()
        })
    }

    /// Appends float vertex data with `N` components (`VEC2` or `VEC4`).
    pub fn push_vec_f32<const N: usize>(&mut self, values: &[[f32; N]]) -> u32 {
        let bytes: Vec<u8> = values
            .iter()
            .flat_map(|v| v.iter().flat_map(|x| x.to_le_bytes()))
            .collect();
        let view = self.push_view(&bytes, None, Some(ARRAY_BUFFER));
        self.push_accessor(Accessor {
            buffer_view: Some(view),
            component_type: FLOAT,
            count: values.len() as u64,
            kind: format!("VEC{N}"),
            ..Accessor::default()
        })
    }

    /// Appends `UNSIGNED_SHORT` triangle indices.
    pub fn push_indices_u16(&mut self, indices: &[u16]) -> u32 {
        let bytes: Vec<u8> = indices.iter().flat_map(|i| i.to_le_bytes()).collect();
        self.push_scalar(&bytes, UNSIGNED_SHORT, indices.len(), Some(ELEMENT_ARRAY_BUFFER))
    }

    /// Appends `UNSIGNED_INT` triangle indices.
    pub fn push_indices_u32(&mut self, indices: &[u32]) -> u32 {
        let bytes: Vec<u8> = indices.iter().flat_map(|i| i.to_le_bytes()).collect();
        self.push_scalar(&bytes, UNSIGNED_INT, indices.len(), Some(ELEMENT_ARRAY_BUFFER))
    }

    /// Appends a `_FEATURE_ID_n` attribute: `UNSIGNED_SHORT` when `float` is false, `FLOAT`
    /// otherwise (spec §8.1).
    ///
    /// glTF requires every vertex attribute element to start on a 4-byte boundary, so
    /// `UNSIGNED_SHORT` IDs are written with a byte stride of 4.
    pub fn push_feature_ids(&mut self, ids: &[u32], float: bool) -> u32 {
        let (bytes, component_type, stride): (Vec<u8>, _, _) = if float {
            let bytes = ids.iter().flat_map(|&id| (id as f32).to_le_bytes()).collect();
            (bytes, FLOAT, None)
        } else {
            let bytes = ids
                .iter()
                .flat_map(|&id| {
                    let [a, b] = u16::try_from(id)
                        .expect("UNSIGNED_SHORT feature IDs fit 16 bits")
                        .to_le_bytes();
                    [a, b, 0, 0]
                })
                .collect();
            (bytes, UNSIGNED_SHORT, Some(4))
        };
        let view = self.push_view(&bytes, stride, Some(ARRAY_BUFFER));
        self.push_accessor(Accessor {
            buffer_view: Some(view),
            component_type,
            count: ids.len() as u64,
            kind: "SCALAR".into(),
            ..Accessor::default()
        })
    }

    fn push_scalar(
        &mut self,
        bytes: &[u8],
        component_type: u32,
        count: usize,
        target: Option<u32>,
    ) -> u32 {
        let view = self.push_view(bytes, None, target);
        self.push_accessor(Accessor {
            buffer_view: Some(view),
            component_type,
            count: count as u64,
            kind: "SCALAR".into(),
            ..Accessor::default()
        })
    }

    /// Finishes the buffer and packs the asset as GLB.
    pub fn into_glb(mut self) -> Vec<u8> {
        self.bin.resize(self.bin.len().next_multiple_of(4), 0);
        self.root.buffers = if self.bin.is_empty() {
            Vec::new()
        } else {
            vec![Buffer {
                byte_length: self.bin.len() as u64,
                uri: None,
            }]
        };
        crate::glb::write(&self.root, &self.bin)
    }
}

/// Appends `item` and returns its index.
pub(crate) fn push<T>(list: &mut Vec<T>, item: T) -> u32 {
    list.push(item);
    u32::try_from(list.len() - 1).expect("fewer than 2^32 glTF objects")
}

/// The bytes of buffer view `index` of a GLB asset.
///
/// # Errors
///
/// Returns a message if the view doesn't exist or lies outside the binary chunk.
pub fn view_bytes<'a>(root: &Root, bin: &'a [u8], index: u32) -> Result<&'a [u8], String> {
    let view = root
        .buffer_views
        .get(index as usize)
        .ok_or_else(|| format!("bufferView {index} does not exist"))?;
    if view.buffer != 0 || root.buffers.first().is_some_and(|b| b.uri.is_some()) {
        return Err(format!(
            "bufferView {index} does not refer to the GLB binary chunk"
        ));
    }
    let start = view.byte_offset as usize;
    start
        .checked_add(view.byte_length as usize)
        .and_then(|end| bin.get(start..end))
        .ok_or_else(|| format!("bufferView {index} lies outside the binary chunk"))
}

/// Calls `f` with the components of each element of accessor `index`, converted to `f64`.
///
/// # Errors
///
/// Returns a message if the accessor or its data is malformed or sparse.
pub fn read_accessor(
    root: &Root,
    bin: &[u8],
    index: u32,
    mut f: impl FnMut(&[f64]),
) -> Result<(), String> {
    let accessor = root
        .accessors
        .get(index as usize)
        .ok_or_else(|| format!("accessor {index} does not exist"))?;
    let components = accessor
        .components()
        .ok_or_else(|| format!("accessor {index} has unknown type {}", accessor.kind))?;
    let size = component_size(accessor.component_type)
        .ok_or_else(|| format!("accessor {index} has unknown componentType"))?;
    if accessor.sparse.is_some() {
        return Err(format!("accessor {index} is sparse"));
    }
    let count = accessor.count as usize;
    let Some(view_index) = accessor.buffer_view else {
        let zeros = vec![0.0; components];
        (0..count).for_each(|_| f(&zeros));
        return Ok(());
    };
    let bytes = view_bytes(root, bin, view_index)?;
    let element = components * size;
    let stride = root.buffer_views[view_index as usize]
        .byte_stride
        .map_or(element, |s| s as usize);
    let offset = accessor.byte_offset as usize;
    if count > 0 && offset + stride * (count - 1) + element > bytes.len() {
        return Err(format!("accessor {index} reads past its bufferView"));
    }
    let mut values = vec![0.0; components];
    for i in 0..count {
        let at = offset + i * stride;
        for (k, value) in values.iter_mut().enumerate() {
            let b = &bytes[at + k * size..at + (k + 1) * size];
            *value = match accessor.component_type {
                FLOAT => f64::from(f32::from_le_bytes(b.try_into().expect("4 bytes"))),
                UNSIGNED_INT => f64::from(u32::from_le_bytes(b.try_into().expect("4 bytes"))),
                UNSIGNED_SHORT => f64::from(u16::from_le_bytes(b.try_into().expect("2 bytes"))),
                UNSIGNED_BYTE => f64::from(b[0]),
                crate::json::SHORT => f64::from(i16::from_le_bytes(b.try_into().expect("2"))),
                _ => f64::from(b[0] as i8),
            };
        }
        f(&values);
    }
    Ok(())
}

/// Reads a `VEC3` float accessor.
///
/// # Errors
///
/// See [`read_accessor`]; also fails for other types.
pub fn read_vec3(root: &Root, bin: &[u8], index: u32) -> Result<Vec<[f32; 3]>, String> {
    check_type(root, index, "VEC3", &[FLOAT])?;
    let mut out = Vec::with_capacity(root.accessors[index as usize].count as usize);
    read_accessor(root, bin, index, |v| {
        out.push([v[0] as f32, v[1] as f32, v[2] as f32]);
    })?;
    Ok(out)
}

/// Reads a `SCALAR` accessor of integers (indices or feature IDs). Float values must be
/// whole numbers.
///
/// # Errors
///
/// See [`read_accessor`]; also fails for other types and fractional values.
pub fn read_u32s(root: &Root, bin: &[u8], index: u32) -> Result<Vec<u32>, String> {
    check_type(
        root,
        index,
        "SCALAR",
        &[UNSIGNED_BYTE, UNSIGNED_SHORT, UNSIGNED_INT, FLOAT],
    )?;
    let mut out = Vec::with_capacity(root.accessors[index as usize].count as usize);
    let mut bad = None;
    read_accessor(root, bin, index, |v| {
        if v[0].fract() != 0.0 || v[0] < 0.0 || v[0] > f64::from(u32::MAX) {
            bad.get_or_insert(v[0]);
        }
        out.push(v[0] as u32);
    })?;
    match bad {
        Some(value) => Err(format!(
            "accessor {index} holds {value}, which is not an unsigned integer"
        )),
        None => Ok(out),
    }
}

fn check_type(root: &Root, index: u32, kind: &str, types: &[u32]) -> Result<(), String> {
    let accessor = root
        .accessors
        .get(index as usize)
        .ok_or_else(|| format!("accessor {index} does not exist"))?;
    if accessor.kind != kind || !types.contains(&accessor.component_type) {
        return Err(format!(
            "accessor {index} is {} of componentType {}, expected {kind}",
            accessor.kind, accessor.component_type
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feature_ids_round_trip_in_both_types() {
        let ids = [0, 0, 1, 2, 70_000];
        let mut builder = AssetBuilder::default();
        let short = builder.push_feature_ids(&ids[..4], false);
        let float = builder.push_feature_ids(&ids, true);
        let (root, bin) = (builder.root.clone(), builder.bin.clone());
        assert_eq!(root.buffer_views[0].byte_stride, Some(4));
        assert_eq!(read_u32s(&root, &bin, short).unwrap(), &ids[..4]);
        assert_eq!(read_u32s(&root, &bin, float).unwrap(), ids);
    }

    #[test]
    fn views_are_aligned_and_bounds_recorded() {
        let mut builder = AssetBuilder::default();
        builder.push_indices_u16(&[0, 1, 2]);
        let positions = builder.push_vec3(&[[0.0, 1.0, -2.0], [3.0, -1.0, 0.5]], true);
        assert_eq!(builder.root.buffer_views[1].byte_offset % 8, 0);
        let accessor = &builder.root.accessors[positions as usize];
        assert_eq!(accessor.min.as_deref(), Some(&[0.0, -1.0, -2.0][..]));
        assert_eq!(accessor.max.as_deref(), Some(&[3.0, 1.0, 0.5][..]));
        let back = read_vec3(&builder.root, &builder.bin, positions).unwrap();
        assert_eq!(back, [[0.0, 1.0, -2.0], [3.0, -1.0, 0.5]]);
    }
}
