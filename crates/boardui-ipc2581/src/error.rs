use std::fmt;

/// A position in the source document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Position {
    /// Byte offset from the start of the input.
    pub offset: u64,
    /// 1-based line number.
    pub line: u64,
}

impl fmt::Display for Position {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "line {} (byte {})", self.line, self.offset)
    }
}

/// An error that stops parsing.
#[derive(Debug)]
pub struct Error(Box<Inner>);

#[derive(Debug)]
struct Inner {
    kind: ErrorKind,
    position: Position,
}

impl Error {
    pub(crate) fn new(kind: ErrorKind, position: Position) -> Self {
        Self(Box::new(Inner { kind, position }))
    }

    /// What went wrong.
    pub fn kind(&self) -> &ErrorKind {
        &self.0.kind
    }

    /// Where it went wrong: the start of the offending element, or the reader position for
    /// malformed XML and I/O errors.
    pub fn position(&self) -> Position {
        self.0.position
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.0.position, self.0.kind)
    }
}

impl std::error::Error for Error {}

/// The kind of an [`Error`].
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum ErrorKind {
    /// The input is not well-formed XML, or could not be read.
    Xml {
        /// Description from the XML reader.
        message: String,
    },
    /// The input ended inside an element.
    UnexpectedEof {
        /// The element that was still open.
        element: String,
    },
    /// The root element is not `IPC-2581`.
    NotIpc2581 {
        /// Local name of the root element found, empty if there is none.
        root: String,
    },
    /// A required child element is missing.
    MissingElement {
        /// The element that lacks the child.
        element: String,
        /// Description of the missing child.
        expected: String,
    },
    /// A required attribute is missing.
    MissingAttribute {
        /// The element that lacks the attribute.
        element: String,
        /// The attribute name.
        attribute: String,
    },
    /// An attribute value cannot be parsed, or is an empty reference.
    InvalidValue {
        /// The element carrying the attribute.
        element: String,
        /// The attribute name.
        attribute: String,
        /// The value as written.
        value: String,
        /// Description of the accepted values.
        expected: String,
    },
    /// Elements are nested deeper than the reader accepts.
    NestingTooDeep {
        /// The nested element.
        element: String,
        /// The maximum nesting depth.
        limit: usize,
    },
    /// A length appears where no unit is in effect, for example `CadData` before `CadHeader`.
    UnitsUnknown {
        /// The element carrying the length.
        element: String,
    },
}

impl fmt::Display for ErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Xml { message } => write!(f, "malformed XML: {message}"),
            Self::UnexpectedEof { element } => {
                write!(f, "input ended inside element `{element}`")
            }
            Self::NotIpc2581 { root } => {
                write!(f, "root element is `{root}`, expected `IPC-2581`")
            }
            Self::MissingElement { element, expected } => {
                write!(f, "element `{element}` is missing {expected}")
            }
            Self::MissingAttribute { element, attribute } => {
                write!(f, "element `{element}` is missing attribute `{attribute}`")
            }
            Self::InvalidValue {
                element,
                attribute,
                value,
                expected,
            } => write!(
                f,
                "attribute `{attribute}` of `{element}` is {value:?}, expected {expected}"
            ),
            Self::NestingTooDeep { element, limit } => {
                write!(f, "`{element}` is nested more than {limit} levels deep")
            }
            Self::UnitsUnknown { element } => write!(
                f,
                "element `{element}` has a length but no units are in effect"
            ),
        }
    }
}
