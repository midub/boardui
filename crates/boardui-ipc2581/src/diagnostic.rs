use std::collections::HashMap;
use std::fmt;

use crate::Position;

/// A warning about input the reader skipped or could not resolve.
///
/// Identical warnings are merged: `position` is the first occurrence and `occurrences`
/// counts all of them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    /// What was found.
    pub kind: DiagnosticKind,
    /// Position of the first occurrence.
    pub position: Position,
    /// Number of occurrences, at least 1.
    pub occurrences: u64,
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.position, self.kind)?;
        if self.occurrences > 1 {
            write!(f, " ({} occurrences)", self.occurrences)?;
        }
        Ok(())
    }
}

/// The kind of a [`Diagnostic`].
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum DiagnosticKind {
    /// An element the reader does not model; it was skipped with its subtree.
    UnknownElement {
        /// Local name of the skipped element.
        element: String,
        /// Local name of its parent.
        parent: String,
    },
    /// An attribute the reader does not model; it was ignored.
    UnknownAttribute {
        /// Local name of the element carrying it.
        element: String,
        /// Local name of the attribute.
        attribute: String,
    },
    /// Non-whitespace text inside an element; it was ignored.
    UnexpectedText {
        /// Local name of the element containing the text.
        element: String,
    },
    /// A shape element in a shape position that the reader cannot describe. It is kept as
    /// [`Shape::Unsupported`](crate::Shape::Unsupported) or
    /// [`PrimitiveKind::Unsupported`](crate::PrimitiveKind::Unsupported).
    UnsupportedShape {
        /// Local name of the shape element.
        element: String,
    },
    /// An element that may occur only once occurred again; the repetition was ignored.
    DuplicateElement {
        /// Local name of the repeated element.
        element: String,
        /// Local name of its parent.
        parent: String,
    },
    /// Two definitions share a key. Both are kept; lookups return the first.
    DuplicateKey {
        /// What kind of definition.
        kind: RefKind,
        /// The shared key.
        key: String,
    },
    /// A reference whose target does not exist.
    DanglingReference {
        /// What kind of target was expected.
        kind: RefKind,
        /// The reference as written. Pin references are written `<owner>/<pin>`, where the
        /// owner is a component refDes (`PinRef`) or a package name (`Package@pinOne`).
        key: String,
    },
    /// The `IPC-2581@revision` is neither `B` nor `C`; the file was read as revision C.
    UnsupportedRevision {
        /// The revision as written.
        revision: String,
    },
    /// A required attribute that some exporters omit was missing; a default was used.
    MissingAttribute {
        /// Local name of the element.
        element: String,
        /// Local name of the missing attribute.
        attribute: String,
        /// The value used instead.
        default: String,
    },
}

impl fmt::Display for DiagnosticKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownElement { element, parent } => {
                write!(f, "skipped unknown element `{element}` in `{parent}`")
            }
            Self::UnknownAttribute { element, attribute } => {
                write!(f, "ignored unknown attribute `{attribute}` of `{element}`")
            }
            Self::UnexpectedText { element } => write!(f, "ignored text in `{element}`"),
            Self::UnsupportedShape { element } => write!(f, "unsupported shape `{element}`"),
            Self::DuplicateElement { element, parent } => {
                write!(f, "ignored repeated element `{element}` in `{parent}`")
            }
            Self::DuplicateKey { kind, key } => write!(f, "duplicate {kind} `{key}`"),
            Self::DanglingReference { kind, key } => {
                write!(f, "reference to unknown {kind} `{key}`")
            }
            Self::UnsupportedRevision { revision } => {
                write!(f, "unsupported revision `{revision}`, read as revision C")
            }
            Self::MissingAttribute {
                element,
                attribute,
                default,
            } => write!(
                f,
                "element `{element}` is missing attribute `{attribute}`; using `{default}`"
            ),
        }
    }
}

/// The kind of definition a key or reference denotes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum RefKind {
    /// `EntryStandard` in `DictionaryStandard`.
    StandardPrimitive,
    /// `EntryUser` in `DictionaryUser`.
    UserPrimitive,
    /// `EntryLineDesc` in `DictionaryLineDesc`.
    LineDesc,
    /// `EntryFillDesc` in `DictionaryFillDesc`.
    FillDesc,
    /// `EntryColor` in `DictionaryColor`.
    Color,
    /// `EntryFont` in `DictionaryFont`.
    Font,
    /// `Layer`.
    Layer,
    /// `Layer` or `StackupGroup`, as referenced by `StackupLayer@layerOrGroupRef`.
    LayerOrGroup,
    /// `Step`.
    Step,
    /// `PadStackDef`.
    PadstackDef,
    /// `Package`.
    Package,
    /// `Component`.
    Component,
    /// `Pin` of a package.
    Pin,
    /// `Spec` in `CadHeader`.
    Spec,
    /// `Enterprise` in `LogisticHeader`.
    Enterprise,
    /// `AvlItem`, by `OEMDesignNumber`.
    AvlItem,
}

impl fmt::Display for RefKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::StandardPrimitive => "standard primitive",
            Self::UserPrimitive => "user primitive",
            Self::LineDesc => "line descriptor",
            Self::FillDesc => "fill descriptor",
            Self::Color => "colour",
            Self::Font => "font",
            Self::Layer => "layer",
            Self::LayerOrGroup => "layer or stack-up group",
            Self::Step => "step",
            Self::PadstackDef => "padstack definition",
            Self::Package => "package",
            Self::Component => "component",
            Self::Pin => "pin",
            Self::Spec => "spec",
            Self::Enterprise => "enterprise",
            Self::AvlItem => "AVL item",
        })
    }
}

/// Collects warnings, merging identical ones.
#[derive(Debug, Default)]
pub(crate) struct Diagnostics {
    list: Vec<Diagnostic>,
    index: HashMap<DiagnosticKind, usize>,
}

impl Diagnostics {
    pub(crate) fn warn(&mut self, kind: DiagnosticKind, position: Position) {
        if let Some(&i) = self.index.get(&kind) {
            self.list[i].occurrences += 1;
        } else {
            self.index.insert(kind.clone(), self.list.len());
            self.list.push(Diagnostic {
                kind,
                position,
                occurrences: 1,
            });
        }
    }

    pub(crate) fn into_vec(self) -> Vec<Diagnostic> {
        self.list
    }
}
