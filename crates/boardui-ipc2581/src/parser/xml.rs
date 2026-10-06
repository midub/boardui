//! Pull-parser plumbing: reading tags, attributes and child elements.

use std::io::BufRead;
use std::ops::Range;

use quick_xml::XmlVersion;
use quick_xml::events::{BytesStart, Event};

use super::Parser;
use crate::{DiagnosticKind, Error, ErrorKind, Position};

/// The start tag most recently read. Attribute storage is reused between tags.
#[derive(Debug, Default)]
pub(super) struct Tag {
    /// Local name followed by attribute names and values.
    text: String,
    name: Range<usize>,
    attrs: Vec<Attr>,
    /// `<Tag/>`: there are no children to read.
    pub(super) empty: bool,
    pub(super) position: Position,
}

#[derive(Debug)]
struct Attr {
    name: Range<usize>,
    value: Range<usize>,
    used: bool,
}

impl Tag {
    /// Local name of the element.
    pub(super) fn name(&self) -> &str {
        &self.text[self.name.clone()]
    }

    /// Loads a start tag. Namespace declarations and prefixed attributes (`xmlns:*`,
    /// `xsi:schemaLocation`, ...) are dropped: IPC-2581 attributes are always unqualified.
    fn load(
        &mut self,
        start: &BytesStart<'_>,
        empty: bool,
        position: Position,
    ) -> Result<(), quick_xml::Error> {
        self.text.clear();
        self.attrs.clear();
        self.empty = empty;
        self.position = position;
        self.text.push_str(start.local_name().as_ref());
        self.name = 0..self.text.len();
        for attr in start.attributes() {
            let attr = attr?;
            if attr.key.as_ref() == "xmlns" || attr.key.prefix().is_some() {
                continue;
            }
            let value = attr.normalized_value(XmlVersion::Implicit1_0)?;
            let name_start = self.text.len();
            self.text.push_str(attr.key.local_name().as_ref());
            let value_start = self.text.len();
            self.text.push_str(&value);
            self.attrs.push(Attr {
                name: name_start..value_start,
                value: value_start..self.text.len(),
                used: false,
            });
        }
        Ok(())
    }

    /// Returns an attribute value and marks the attribute as read.
    pub(super) fn take(&mut self, name: &str) -> Option<&str> {
        let Self { text, attrs, .. } = self;
        let attr = attrs.iter_mut().find(|a| &text[a.name.clone()] == name)?;
        attr.used = true;
        Some(&text[attr.value.clone()])
    }

    fn unused(&self) -> impl Iterator<Item = &str> {
        self.attrs
            .iter()
            .filter(|a| !a.used)
            .map(|a| &self.text[a.name.clone()])
    }
}

/// What [`Parser::next`] found.
pub(super) enum Next {
    /// A start tag, loaded into [`Parser::tag`].
    Start,
    /// The end tag of the element whose children are being read.
    End,
    /// End of input.
    Eof,
}

fn newlines(s: &str) -> u64 {
    s.bytes().filter(|&b| b == b'\n').count() as u64
}

impl<R: BufRead> Parser<R> {
    /// Reads up to the next start tag, end tag or end of input. Comments, processing
    /// instructions and whitespace are skipped; other text is reported against `element`.
    pub(super) fn next(&mut self, element: &str) -> Result<Next, Error> {
        loop {
            let position = Position {
                offset: self.reader.buffer_position(),
                line: self.line,
            };
            self.buf.clear();
            let event = match self.reader.read_event_into(&mut self.buf) {
                Ok(event) => event,
                Err(e) => {
                    let position = Position {
                        offset: self.reader.error_position(),
                        line: self.line,
                    };
                    return Err(xml_error(&e, position));
                }
            };
            self.line += newlines(&event);
            match event {
                Event::Start(ref start) | Event::Empty(ref start) => {
                    let empty = matches!(event, Event::Empty(_));
                    return match self.tag.load(start, empty, position) {
                        Ok(()) => Ok(Next::Start),
                        Err(e) => Err(xml_error(&e, position)),
                    };
                }
                Event::End(_) => return Ok(Next::End),
                Event::Eof => return Ok(Next::Eof),
                Event::Text(ref text) if text.trim().is_empty() => {}
                Event::Text(_) | Event::CData(_) | Event::GeneralRef(_) => {
                    self.diagnostics.warn(
                        DiagnosticKind::UnexpectedText {
                            element: element.to_owned(),
                        },
                        position,
                    );
                }
                Event::Comment(_) | Event::Decl(_) | Event::PI(_) | Event::DocType(_) => {}
            }
        }
    }

    /// Reads the children of the current element with `child`, which must consume each child
    /// it is called for. Unread attributes of the current element are reported first.
    pub(super) fn children(
        &mut self,
        element: &'static str,
        mut child: impl FnMut(&mut Self) -> Result<(), Error>,
    ) -> Result<(), Error> {
        self.finish_attributes();
        if self.tag.empty {
            return Ok(());
        }
        let position = self.tag.position;
        loop {
            match self.next(element)? {
                Next::Start => child(self)?,
                Next::End => return Ok(()),
                Next::Eof => {
                    return Err(Error::new(
                        ErrorKind::UnexpectedEof {
                            element: element.to_owned(),
                        },
                        position,
                    ));
                }
            }
        }
    }

    /// Finishes an element without modelled children; any children are reported and skipped.
    pub(super) fn leaf(&mut self, element: &'static str) -> Result<(), Error> {
        self.children(element, |p| p.unknown(element))
    }

    /// Reports the current element as unknown in `parent` and skips it.
    pub(super) fn unknown(&mut self, parent: &'static str) -> Result<(), Error> {
        self.warn(DiagnosticKind::UnknownElement {
            element: self.tag.name().to_owned(),
            parent: parent.to_owned(),
        });
        self.skip()
    }

    /// Reports the current element as a repetition in `parent` and skips it.
    pub(super) fn duplicate(&mut self, parent: &'static str) -> Result<(), Error> {
        self.warn(DiagnosticKind::DuplicateElement {
            element: self.tag.name().to_owned(),
            parent: parent.to_owned(),
        });
        self.skip()
    }

    /// Records a warning at the current element.
    pub(super) fn warn(&mut self, kind: DiagnosticKind) {
        self.diagnostics.warn(kind, self.tag.position);
    }

    /// Skips the current element and its subtree without interpreting it.
    pub(super) fn skip(&mut self) -> Result<(), Error> {
        if self.tag.empty {
            return Ok(());
        }
        let mut depth = 1_usize;
        loop {
            self.buf.clear();
            let event = match self.reader.read_event_into(&mut self.buf) {
                Ok(event) => event,
                Err(e) => {
                    let position = Position {
                        offset: self.reader.error_position(),
                        line: self.line,
                    };
                    return Err(xml_error(&e, position));
                }
            };
            self.line += newlines(&event);
            match event {
                Event::Start(_) => depth += 1,
                Event::End(_) => {
                    depth -= 1;
                    if depth == 0 {
                        return Ok(());
                    }
                }
                Event::Eof => {
                    return Err(Error::new(
                        ErrorKind::UnexpectedEof {
                            element: self.tag.name().to_owned(),
                        },
                        self.tag.position,
                    ));
                }
                _ => {}
            }
        }
    }

    fn finish_attributes(&mut self) {
        let Self {
            tag, diagnostics, ..
        } = self;
        for attribute in tag.unused() {
            diagnostics.warn(
                DiagnosticKind::UnknownAttribute {
                    element: tag.name().to_owned(),
                    attribute: attribute.to_owned(),
                },
                tag.position,
            );
        }
    }

    // ----- attribute values -----

    fn missing(&self, attribute: &str) -> Error {
        Error::new(
            ErrorKind::MissingAttribute {
                element: self.tag.name().to_owned(),
                attribute: attribute.to_owned(),
            },
            self.tag.position,
        )
    }

    fn invalid(&self, attribute: &str, value: String, expected: &str) -> Error {
        Error::new(
            ErrorKind::InvalidValue {
                element: self.tag.name().to_owned(),
                attribute: attribute.to_owned(),
                value,
                expected: expected.to_owned(),
            },
            self.tag.position,
        )
    }

    /// An optional attribute converted with `convert`; `expected` describes valid values.
    fn opt_with<T>(
        &mut self,
        attribute: &str,
        expected: &str,
        convert: impl FnOnce(&str) -> Option<T>,
    ) -> Result<Option<T>, Error> {
        let Some(raw) = self.tag.take(attribute) else {
            return Ok(None);
        };
        match convert(raw) {
            Some(value) => Ok(Some(value)),
            None => {
                let raw = raw.to_owned();
                Err(self.invalid(attribute, raw, expected))
            }
        }
    }

    fn req_with<T>(
        &mut self,
        attribute: &str,
        expected: &str,
        convert: impl FnOnce(&str) -> Option<T>,
    ) -> Result<T, Error> {
        self.opt_with(attribute, expected, convert)?
            .ok_or_else(|| self.missing(attribute))
    }

    /// An optional string attribute.
    pub(super) fn opt_str(&mut self, attribute: &str) -> Option<String> {
        self.tag.take(attribute).map(str::to_owned)
    }

    /// A required string attribute.
    pub(super) fn req_str(&mut self, attribute: &str) -> Result<String, Error> {
        self.opt_str(attribute)
            .ok_or_else(|| self.missing(attribute))
    }

    /// An optional reference attribute: present means non-empty.
    pub(super) fn opt_ref(&mut self, attribute: &str) -> Result<Option<String>, Error> {
        self.opt_with(attribute, "a non-empty reference", |s| {
            (!s.is_empty()).then(|| s.to_owned())
        })
    }

    /// A required, non-empty reference attribute.
    pub(super) fn req_ref(&mut self, attribute: &str) -> Result<String, Error> {
        self.opt_ref(attribute)?
            .ok_or_else(|| self.missing(attribute))
    }

    /// An optional number without unit (angle, scale).
    pub(super) fn opt_f64(&mut self, attribute: &str) -> Result<Option<f64>, Error> {
        self.opt_with(attribute, "a finite number", parse_f64)
    }

    /// A required length, converted to metres.
    pub(super) fn req_len(&mut self, attribute: &str) -> Result<f64, Error> {
        let scale = self.scale()?;
        Ok(self.req_with(attribute, "a finite number", parse_f64)? * scale)
    }

    /// An optional length, converted to metres.
    pub(super) fn opt_len(&mut self, attribute: &str) -> Result<Option<f64>, Error> {
        let Some(value) = self.opt_f64(attribute)? else {
            return Ok(None);
        };
        Ok(Some(value * self.scale()?))
    }

    /// An optional `xsd:boolean`.
    pub(super) fn opt_bool(&mut self, attribute: &str) -> Result<Option<bool>, Error> {
        self.opt_with(attribute, "true or false", parse_bool)
    }

    /// A required `xsd:boolean`.
    pub(super) fn req_bool(&mut self, attribute: &str) -> Result<bool, Error> {
        self.req_with(attribute, "true or false", parse_bool)
    }

    /// An optional non-negative integer.
    pub(super) fn opt_u32(&mut self, attribute: &str) -> Result<Option<u32>, Error> {
        self.opt_with(attribute, "a non-negative integer", |s| {
            s.trim().parse().ok()
        })
    }

    /// A required 8-bit colour channel.
    pub(super) fn req_u8(&mut self, attribute: &str) -> Result<u8, Error> {
        self.req_with(attribute, "an integer from 0 to 255", |s| {
            s.trim().parse().ok()
        })
    }

    /// An optional enumerated attribute.
    pub(super) fn opt_enum<T: AttrEnum>(&mut self, attribute: &str) -> Result<Option<T>, Error> {
        self.opt_with(attribute, T::EXPECTED, |s| T::from_attr(s.trim()))
    }

    /// A required enumerated attribute.
    pub(super) fn req_enum<T: AttrEnum>(&mut self, attribute: &str) -> Result<T, Error> {
        self.req_with(attribute, T::EXPECTED, |s| T::from_attr(s.trim()))
    }

    /// Metres per source unit at the current element.
    fn scale(&self) -> Result<f64, Error> {
        self.scale.ok_or_else(|| {
            Error::new(
                ErrorKind::UnitsUnknown {
                    element: self.tag.name().to_owned(),
                },
                self.tag.position,
            )
        })
    }
}

/// An attribute with a fixed set of values.
pub(super) trait AttrEnum: Sized {
    /// Description of the accepted values, for errors.
    const EXPECTED: &'static str;

    /// Maps an attribute value to the enum.
    fn from_attr(value: &str) -> Option<Self>;
}

fn parse_f64(s: &str) -> Option<f64> {
    s.trim().parse::<f64>().ok().filter(|v| v.is_finite())
}

fn parse_bool(s: &str) -> Option<bool> {
    match s.trim() {
        "true" | "1" => Some(true),
        "false" | "0" => Some(false),
        _ => None,
    }
}

fn xml_error(e: &quick_xml::Error, position: Position) -> Error {
    Error::new(
        ErrorKind::Xml {
            message: e.to_string(),
        },
        position,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_must_be_finite() {
        assert_eq!(parse_f64(" 1.5e-3 "), Some(0.0015));
        assert_eq!(parse_f64(".5"), Some(0.5));
        assert_eq!(parse_f64("-2"), Some(-2.0));
        assert_eq!(parse_f64("INF"), None);
        assert_eq!(parse_f64("NaN"), None);
        assert_eq!(parse_f64("1,5"), None);
        assert_eq!(parse_f64(""), None);
    }

    #[test]
    fn booleans_follow_xsd() {
        assert_eq!(parse_bool("true"), Some(true));
        assert_eq!(parse_bool("1"), Some(true));
        assert_eq!(parse_bool("false"), Some(false));
        assert_eq!(parse_bool(" 0 "), Some(false));
        assert_eq!(parse_bool("TRUE"), None);
        assert_eq!(parse_bool("yes"), None);
    }
}
