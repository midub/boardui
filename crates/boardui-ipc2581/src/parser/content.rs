//! `Content`: function mode, step and layer references, dictionaries.

use std::io::BufRead;

use super::{Parser, insert, missing_element};
use crate::{Color, Content, Error, RefKind, Table, Units};

impl<R: BufRead> Parser<R> {
    pub(super) fn read_content(&mut self) -> Result<(), Error> {
        self.children("Content", |p| match p.tag.name() {
            "FunctionMode" if p.content.function_mode.is_none() => {
                let mode = p.req_str("mode")?;
                p.leaf("FunctionMode")?;
                p.content.function_mode = Some(mode);
                Ok(())
            }
            "FunctionMode" => p.duplicate("Content"),
            "StepRef" => {
                let name = p.read_ref("StepRef", "name", RefKind::Step)?;
                p.content.step_refs.push(name);
                Ok(())
            }
            "LayerRef" => {
                let name = p.read_ref("LayerRef", "name", RefKind::Layer)?;
                p.content.layer_refs.push(name);
                Ok(())
            }
            "DictionaryStandard" => p.read_dictionary(
                (
                    "DictionaryStandard",
                    "EntryStandard",
                    "a standard primitive",
                ),
                RefKind::StandardPrimitive,
                |c| &mut c.standard_primitives,
                |p| p.read_standard_primitive().map(Some),
            ),
            "DictionaryUser" => p.read_dictionary(
                ("DictionaryUser", "EntryUser", "a user primitive"),
                RefKind::UserPrimitive,
                |c| &mut c.user_primitives,
                |p| p.read_shape().map(Some),
            ),
            "DictionaryLineDesc" => p.read_dictionary(
                ("DictionaryLineDesc", "EntryLineDesc", "`LineDesc`"),
                RefKind::LineDesc,
                |c| &mut c.line_descs,
                |p| match p.tag.name() {
                    "LineDesc" => p.read_line_desc().map(Some),
                    _ => p.unknown("EntryLineDesc").map(|()| None),
                },
            ),
            "DictionaryFillDesc" => p.read_dictionary(
                ("DictionaryFillDesc", "EntryFillDesc", "`FillDesc`"),
                RefKind::FillDesc,
                |c| &mut c.fill_descs,
                |p| match p.tag.name() {
                    "FillDesc" => p.read_fill_desc().map(Some),
                    _ => p.unknown("EntryFillDesc").map(|()| None),
                },
            ),
            "DictionaryColor" => p.read_dictionary(
                ("DictionaryColor", "EntryColor", "`Color`"),
                RefKind::Color,
                |c| &mut c.colors,
                |p| match p.tag.name() {
                    "Color" => p.read_color().map(Some),
                    _ => p.unknown("EntryColor").map(|()| None),
                },
            ),
            _ => p.unknown("Content"),
        })
    }

    /// Reads a dictionary whose entries each hold one value, read by `read_value` (which
    /// returns `None` for a child it skipped). `names` are the dictionary element, the entry
    /// element and a description of the value. Lengths use the dictionary's `units`.
    fn read_dictionary<T>(
        &mut self,
        names: (&'static str, &'static str, &'static str),
        kind: RefKind,
        table: fn(&mut Content) -> &mut Table<T>,
        mut read_value: impl FnMut(&mut Self) -> Result<Option<T>, Error>,
    ) -> Result<(), Error> {
        let (dictionary, entry, expected) = names;
        let outer_scale = self.scale;
        if let Some(units) = self.opt_enum::<Units>("units")? {
            self.scale = Some(units.metres());
        }
        let result = self.children(dictionary, |p| {
            if p.tag.name() != entry {
                return p.unknown(dictionary);
            }
            let position = p.tag.position;
            let id = p.req_ref("id")?;
            let mut value = None;
            p.children(entry, |p| {
                if value.is_some() {
                    return p.duplicate(entry);
                }
                value = read_value(p)?;
                Ok(())
            })?;
            let value = value.ok_or_else(|| missing_element(entry, expected, position))?;
            insert(
                &mut p.diagnostics,
                table(&mut p.content),
                kind,
                id,
                value,
                position,
            );
            Ok(())
        });
        self.scale = outer_scale;
        result
    }

    pub(super) fn read_color(&mut self) -> Result<Color, Error> {
        let color = Color {
            r: self.req_u8("r")?,
            g: self.req_u8("g")?,
            b: self.req_u8("b")?,
        };
        self.leaf("Color")?;
        Ok(color)
    }
}
