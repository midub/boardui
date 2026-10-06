use std::fmt;

/// An error caused by invalid geometry input.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum GeomError {
    /// A coordinate or length is NaN or infinite.
    NonFinite,
    /// A coordinate lies outside ±[`MAX_COORDINATE`](crate::MAX_COORDINATE).
    OutOfRange {
        /// The offending value, in metres.
        value: f64,
    },
    /// A length that must not be negative is negative.
    NegativeLength {
        /// What the length describes, for example `"stroke width"`.
        what: &'static str,
        /// The offending value, in metres.
        value: f64,
    },
    /// A tessellation tolerance is not a finite value of at least
    /// [`GRID_STEP`](crate::GRID_STEP).
    InvalidTolerance {
        /// The offending value, in metres.
        value: f64,
    },
    /// A Z range is empty or reversed.
    InvalidZRange {
        /// Lower bound, in metres.
        z_min: f64,
        /// Upper bound, in metres.
        z_max: f64,
    },
    /// Features were added to a layer mesh out of ascending ID order.
    FeatureOrder {
        /// The ID added before.
        previous: u32,
        /// The ID that should have been greater.
        next: u32,
    },
    /// The triangulator returned a vertex that is not on the region boundary.
    ///
    /// This indicates a bug in this crate or its triangulator, not bad input.
    Triangulation,
}

impl fmt::Display for GeomError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonFinite => f.write_str("coordinate or length is not finite"),
            Self::OutOfRange { value } => write!(
                f,
                "coordinate {value} m is outside ±{} m",
                crate::MAX_COORDINATE
            ),
            Self::NegativeLength { what, value } => write!(f, "{what} {value} m is negative"),
            Self::InvalidTolerance { value } => write!(
                f,
                "tolerance {value} m must be finite and at least {} m",
                crate::GRID_STEP
            ),
            Self::InvalidZRange { z_min, z_max } => {
                write!(f, "Z range [{z_min}, {z_max}] m is empty")
            }
            Self::FeatureOrder { previous, next } => write!(
                f,
                "feature {next} added after feature {previous}; IDs must ascend"
            ),
            Self::Triangulation => f.write_str("triangulation produced a vertex off the boundary"),
        }
    }
}

impl std::error::Error for GeomError {}

/// A [`GeomError`] in one feature of a layer.
#[derive(Debug, Clone, PartialEq)]
pub struct FeatureError {
    /// Index of the feature in the input slice.
    pub index: usize,
    /// What is wrong with it.
    pub error: GeomError,
}

impl fmt::Display for FeatureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "feature {}: {}", self.index, self.error)
    }
}

impl std::error::Error for FeatureError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.error)
    }
}
