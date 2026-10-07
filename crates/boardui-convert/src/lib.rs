//! IPC-2581 to boardui glTF conversion pipeline and profile validation.
//!
//! [`convert`] turns an IPC-2581 file into a boardui asset (GLB) following the profile in
//! `spec/README.md`:
//!
//! 1. parse the XML ([`boardui_ipc2581`]);
//! 2. build the stack-up with Z ranges, synthesizing missing dielectric and soldermask
//!    layers (spec §6.4, §6.5);
//! 3. turn each feature into a region and resolve polarity and overlaps (spec §6.2) with
//!    [`boardui_geom`];
//! 4. cut holes from the layers they cross and build plated barrels (spec §6.3);
//! 5. build dielectric and soldermask sheets and clip the silkscreen (spec §6.5–§6.7);
//! 6. extrude everything into closed prisms, assemble the layer meshes;
//! 7. place components with placeholder bodies or user models (spec §6.8, §6.9);
//! 8. write the metadata tables and the GLB ([`boardui_gltf`]).
//!
//! A panel converts with every step that its `StepRepeat`s place (spec §6.14).
//!
//! [`validate`] checks a GLB against the profile rules of spec §10.

mod bom;
mod colours;
mod components;
mod models;
mod outline;
mod padstacks;
mod panel;
mod pipeline;
mod shapes;
mod stackup;
mod text;
mod validate;

use std::fmt;

use boardui_ipc2581 as ipc;
pub use models::{MappingError, ModelLibrary, ModelRule};
pub use stackup::{DEFAULT_COPPER, DEFAULT_SILKSCREEN, DEFAULT_SOLDERMASK, DEFAULT_THICKNESS};
pub use validate::{Issue, Report, Severity, validate};

/// Default arc tessellation tolerance (spec §6.1): 5 µm.
pub const DEFAULT_TOLERANCE: f64 = 5e-6;
/// Default barrel wall thickness (spec §6.3): 25 µm.
pub const DEFAULT_PLATING_THICKNESS: f64 = 25e-6;

/// Conversion options.
#[derive(Debug, Clone)]
pub struct Options {
    /// Maximum chord deviation of tessellated arcs, in metres.
    pub tolerance: f64,
    /// Barrel wall thickness, in metres.
    pub plating_thickness: f64,
    /// The step to convert. `None`: the root step, the first that no `StepRepeat`
    /// references, preferring the order of the `StepRef`s (spec §6.14).
    pub step: Option<String>,
    /// User models for component bodies (spec §6.9).
    pub models: Option<ModelLibrary>,
    /// `asset.generator` of the output.
    pub generator: String,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            tolerance: DEFAULT_TOLERANCE,
            plating_thickness: DEFAULT_PLATING_THICKNESS,
            step: None,
            models: None,
            generator: format!("boardui {}", env!("CARGO_PKG_VERSION")),
        }
    }
}

/// The result of a conversion.
#[derive(Debug, Clone)]
pub struct Conversion {
    /// The boardui asset.
    pub glb: Vec<u8>,
    /// Warnings from the reader and the converter.
    pub warnings: Vec<Warning>,
    /// Counts describing the output.
    pub stats: Stats,
    /// Wall-clock time of each pipeline step in seconds, in order. Empty on WebAssembly.
    pub timings: Vec<(&'static str, f64)>,
}

/// A warning about input that was skipped, approximated or inconsistent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Warning {
    /// What happened.
    pub message: String,
    /// Where in the source, for warnings from the reader.
    pub position: Option<ipc::Position>,
    /// How often it happened.
    pub occurrences: u64,
}

impl fmt::Display for Warning {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(position) = self.position {
            write!(f, "{position}: ")?;
        }
        f.write_str(&self.message)?;
        if self.occurrences > 1 {
            write!(f, " ({} occurrences)", self.occurrences)?;
        }
        Ok(())
    }
}

/// Counts describing a converted board.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Stats {
    /// Layer nodes.
    pub layers: usize,
    /// Drill nodes.
    pub drills: usize,
    /// Rows in all feature tables.
    pub features: usize,
    /// Vertices in layer and drill meshes.
    pub vertices: usize,
    /// Triangles in layer and drill meshes.
    pub triangles: usize,
    /// Components.
    pub components: usize,
    /// Nets.
    pub nets: usize,
    /// Instances of steps placed by `StepRepeat`s (spec §6.14).
    pub instances: usize,
    /// Pins.
    pub pins: usize,
    /// Package pins referenced by pads.
    pub pins_checked: usize,
    /// Of those, pins that land on none of their pads when placed with the component's
    /// transform (spec §6.8).
    pub pins_misplaced: usize,
}

/// Why a conversion failed.
#[derive(Debug)]
#[non_exhaustive]
pub enum ConvertError {
    /// The input is not readable IPC-2581.
    Parse(ipc::Error),
    /// The input can't be converted.
    Input(String),
}

impl fmt::Display for ConvertError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Parse(e) => write!(f, "cannot read the IPC-2581 file: {e}"),
            Self::Input(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for ConvertError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Parse(e) => Some(e),
            Self::Input(_) => None,
        }
    }
}

/// The steps of a conversion, in order, as reported by [`convert_with_progress`]. They match
/// the pipeline in `docs/architecture.md`; [`Conversion::timings`] uses the same names.
pub const STEPS: [&str; 8] = [
    "parse",
    "stack-up, features, components",
    "resolve",
    "hole cuts",
    "cut and sheets",
    "extrude",
    "barrels",
    "write",
];

/// A pipeline step starting or ending, as reported by [`convert_with_progress`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Progress {
    /// The step (one of [`STEPS`]) started.
    Start(&'static str),
    /// The step ended.
    End(&'static str),
}

/// Converts an IPC-2581 file to a boardui asset.
///
/// # Errors
///
/// Returns [`ConvertError::Parse`] if the XML can't be read and [`ConvertError::Input`] if
/// it has nothing to convert (no step or no copper layer) or the options are invalid.
pub fn convert(xml: &[u8], options: &Options) -> Result<Conversion, ConvertError> {
    convert_with_progress(xml, options, &mut |_| {})
}

/// Converts an IPC-2581 file like [`convert`], calling `progress` when each of the [`STEPS`]
/// starts and ends. The steps run in order; each starts once.
///
/// # Errors
///
/// See [`convert`].
pub fn convert_with_progress(
    xml: &[u8],
    options: &Options,
    progress: &mut dyn FnMut(Progress),
) -> Result<Conversion, ConvertError> {
    let timings = Timings::new(progress);
    let document = {
        let _step = timings.step("parse");
        ipc::parse_bytes(xml).map_err(ConvertError::Parse)?
    };
    pipeline::run(&document, &sha256(xml), options, timings)
}

/// Converts a parsed document. `sha256` is the hex digest of the source file.
///
/// # Errors
///
/// See [`convert`].
pub fn convert_document(
    document: &ipc::Document,
    sha256: &str,
    options: &Options,
) -> Result<Conversion, ConvertError> {
    pipeline::run(document, sha256, options, Timings::new(&mut |_| {}))
}

/// Lowercase hex SHA-256 of `bytes`.
pub fn sha256(bytes: &[u8]) -> String {
    use sha2::Digest;
    let digest = sha2::Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Times pipeline steps: a tracing span each, progress events and, on native targets, the
/// wall-clock time.
pub(crate) struct Timings<'p> {
    list: std::cell::RefCell<Vec<(&'static str, f64)>>,
    progress: std::cell::RefCell<&'p mut dyn FnMut(Progress)>,
}

impl<'p> Timings<'p> {
    pub(crate) fn new(progress: &'p mut dyn FnMut(Progress)) -> Self {
        Self {
            list: std::cell::RefCell::default(),
            progress: std::cell::RefCell::new(progress),
        }
    }

    /// Starts a step; it ends when the returned guard is dropped.
    pub(crate) fn step(&self, name: &'static str) -> Step<'_, 'p> {
        debug_assert!(STEPS.contains(&name), "unknown step {name}");
        (self.progress.borrow_mut())(Progress::Start(name));
        Step {
            timings: self,
            name,
            _span: tracing::info_span!("step", name).entered(),
            #[cfg(not(target_arch = "wasm32"))]
            start: std::time::Instant::now(),
        }
    }

    pub(crate) fn into_vec(self) -> Vec<(&'static str, f64)> {
        self.list.into_inner()
    }
}

/// A running pipeline step.
pub(crate) struct Step<'a, 'p> {
    timings: &'a Timings<'p>,
    name: &'static str,
    _span: tracing::span::EnteredSpan,
    #[cfg(not(target_arch = "wasm32"))]
    start: std::time::Instant,
}

impl Drop for Step<'_, '_> {
    fn drop(&mut self) {
        #[cfg(not(target_arch = "wasm32"))]
        self.timings
            .list
            .borrow_mut()
            .push((self.name, self.start.elapsed().as_secs_f64()));
        (self.timings.progress.borrow_mut())(Progress::End(self.name));
    }
}

/// Converter warnings, merged by message.
#[derive(Debug, Default)]
pub(crate) struct Warnings {
    list: Vec<Warning>,
}

impl Warnings {
    pub(crate) fn push(&mut self, message: impl Into<String>) {
        let message = message.into();
        match self.list.iter_mut().find(|w| w.message == message) {
            Some(w) => w.occurrences += 1,
            None => self.list.push(Warning {
                message,
                position: None,
                occurrences: 1,
            }),
        }
    }

    #[cfg(test)]
    pub(crate) fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    pub(crate) fn into_vec(self) -> Vec<Warning> {
        self.list
    }
}
