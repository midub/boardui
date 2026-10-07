//! WebAssembly bindings for the boardui converter, wrapped by the `@boardui/converter` npm
//! package (`packages/converter`), which runs them in a Web Worker.
//!
//! - [`convert`] turns IPC-2581 bytes into a boardui GLB, with warnings, stats and per-step
//!   timings, and reports each pipeline step to an optional callback;
//! - [`validate`] checks a GLB against the profile rules (spec §10);
//! - [`ConvertOptions`] holds the options, including a model mapping and its files.
//!
//! Results are plain JavaScript objects; `packages/converter/src/types.ts` declares them.

use std::collections::HashMap;

use boardui_convert::{ModelLibrary, Options, Progress, STEPS, Severity};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// `performance.now()`, available in windows, workers and Node.
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
}

/// Returns the converter version.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// The pipeline steps in order, as passed to the progress callback of [`convert`].
#[wasm_bindgen]
pub fn steps() -> Vec<String> {
    STEPS.iter().map(|s| (*s).to_owned()).collect()
}

/// Options of [`convert`]. Lengths are in metres; unset values take the converter defaults.
#[wasm_bindgen]
#[derive(Debug, Default)]
pub struct ConvertOptions {
    tolerance: Option<f64>,
    plating_thickness: Option<f64>,
    step: Option<String>,
    models: Option<String>,
    files: HashMap<String, Vec<u8>>,
}

#[wasm_bindgen]
impl ConvertOptions {
    /// Default options.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Maximum chord deviation of tessellated arcs (spec §6.1).
    #[wasm_bindgen(setter)]
    pub fn set_tolerance(&mut self, value: Option<f64>) {
        self.tolerance = value;
    }

    /// Barrel wall thickness (spec §6.3).
    #[wasm_bindgen(setter = platingThickness)]
    pub fn set_plating_thickness(&mut self, value: Option<f64>) {
        self.plating_thickness = value;
    }

    /// The step to convert; default the first `StepRef`, or else the first step.
    #[wasm_bindgen(setter)]
    pub fn set_step(&mut self, value: Option<String>) {
        self.step = value;
    }

    /// A model mapping file (spec §6.9, `models.schema.json`) as JSON text.
    #[wasm_bindgen(setter)]
    pub fn set_models(&mut self, value: Option<String>) {
        self.models = value;
    }

    /// Adds a file the model mapping refers to (a glTF, GLB, `.bin` or texture), by its path
    /// relative to the mapping file. A path the mapping names that has no exact match falls
    /// back to the only added file with the same name.
    #[wasm_bindgen(js_name = addFile)]
    pub fn add_file(&mut self, path: &str, bytes: Vec<u8>) {
        self.files.insert(normalize(path), bytes);
    }
}

/// Converts IPC-2581 XML to a boardui asset.
///
/// `progress(step, index, count)` is called when each step of [`steps`] starts. Returns
/// `{ glb: Uint8Array, warnings, stats, timings }`; throws an `Error` if the input can't be
/// converted or the model mapping can't be read.
#[wasm_bindgen]
pub fn convert(
    xml: &[u8],
    options: &ConvertOptions,
    progress: Option<js_sys::Function>,
) -> Result<js_sys::Object, JsError> {
    let mut opts = Options::default();
    if let Some(tolerance) = options.tolerance {
        opts.tolerance = tolerance;
    }
    if let Some(plating) = options.plating_thickness {
        opts.plating_thickness = plating;
    }
    opts.step.clone_from(&options.step);
    opts.generator = format!("boardui {} (wasm)", env!("CARGO_PKG_VERSION"));
    let mut model_warnings = Vec::new();
    if let Some(mapping) = &options.models {
        let library = ModelLibrary::from_json(mapping, |path| options.file(path))
            .map_err(|e| JsError::new(&e.to_string()))?;
        model_warnings.clone_from(&library.warnings);
        opts.models = Some(library);
    }

    let mut timings: Vec<(&'static str, f64)> = Vec::new();
    let mut started = 0.0;
    let mut callback_error = None;
    let mut on_progress = |event: Progress| match event {
        Progress::Start(step) => {
            started = performance_now();
            if let Some(f) = &progress {
                let index = STEPS.iter().position(|s| *s == step).unwrap_or(0);
                let args = js_sys::Array::of3(
                    &JsValue::from_str(step),
                    &JsValue::from(index as u32),
                    &JsValue::from(STEPS.len() as u32),
                );
                if let Err(e) = f.apply(&JsValue::NULL, &args) {
                    callback_error.get_or_insert(e);
                }
            }
        }
        Progress::End(step) => timings.push((step, (performance_now() - started) / 1000.0)),
    };
    let conversion = boardui_convert::convert_with_progress(xml, &opts, &mut on_progress)
        .map_err(|e| JsError::new(&e.to_string()))?;
    if let Some(e) = callback_error {
        return Err(JsError::new(&format!(
            "the progress callback threw: {}",
            e.as_string().unwrap_or_else(|| format!("{e:?}"))
        )));
    }

    let warnings: Vec<Value> = model_warnings
        .iter()
        .map(|message| json!({ "message": message, "occurrences": 1 }))
        .chain(conversion.warnings.iter().map(|w| {
            let mut value = json!({ "message": w.message, "occurrences": w.occurrences });
            if let Some(position) = w.position {
                value["line"] = position.line.into();
                value["offset"] = position.offset.into();
            }
            value
        }))
        .collect();
    let s = &conversion.stats;
    let info = json!({
        "warnings": warnings,
        "stats": {
            "layers": s.layers,
            "drills": s.drills,
            "features": s.features,
            "vertices": s.vertices,
            "triangles": s.triangles,
            "components": s.components,
            "nets": s.nets,
            "pins": s.pins,
            "instances": s.instances,
            "pinsChecked": s.pins_checked,
            "pinsMisplaced": s.pins_misplaced,
            "glbBytes": conversion.glb.len(),
        },
        "timings": timings
            .iter()
            .map(|(step, seconds)| json!({ "step": step, "seconds": seconds }))
            .collect::<Vec<_>>(),
    });
    let result = to_object(&info)?;
    let glb = js_sys::Uint8Array::from(conversion.glb.as_slice());
    drop(conversion);
    js_sys::Reflect::set(&result, &"glb".into(), &glb).map_err(js_error)?;
    Ok(result)
}

/// Checks a GLB against the profile rules (spec §10). The Khronos validator is not run.
///
/// Returns `{ valid, errors, issues: [{ severity, message }] }`.
#[wasm_bindgen]
pub fn validate(glb: &[u8]) -> Result<js_sys::Object, JsError> {
    let report = boardui_convert::validate(glb);
    let issues: Vec<Value> = report
        .issues
        .iter()
        .map(|issue| {
            let severity = match issue.severity {
                Severity::Error => "error",
                Severity::Warning => "warning",
            };
            json!({ "severity": severity, "message": issue.message })
        })
        .collect();
    to_object(&json!({
        "valid": report.is_valid(),
        "errors": report.errors(),
        "issues": issues,
    }))
}

impl ConvertOptions {
    /// A model file by the path the mapping gives, or the only file with its name.
    fn file(&self, path: &str) -> Result<Vec<u8>, String> {
        let path = normalize(path);
        if let Some(bytes) = self.files.get(&path) {
            return Ok(bytes.clone());
        }
        let name = file_name(&path);
        let mut matches = self.files.iter().filter(|(p, _)| file_name(p) == name);
        match (matches.next(), matches.next()) {
            (Some((_, bytes)), None) => Ok(bytes.clone()),
            (Some(_), Some(_)) => Err(format!("several files are named `{name}`")),
            (None, _) => Err("file not supplied".to_owned()),
        }
    }
}

/// A relative path with `\` as `/`, without `.` segments and with `..` applied.
fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    parts.join("/")
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn to_object(value: &Value) -> Result<js_sys::Object, JsError> {
    let parsed = js_sys::JSON::parse(&value.to_string()).map_err(js_error)?;
    Ok(parsed.unchecked_into())
}

fn js_error(value: JsValue) -> JsError {
    JsError::new(&value.as_string().unwrap_or_else(|| format!("{value:?}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_normalized() {
        assert_eq!(normalize("./models/r.glb"), "models/r.glb");
        assert_eq!(normalize("models\\sub\\..\\r.glb"), "models/r.glb");
        assert_eq!(normalize("/r.glb"), "r.glb");
    }

    #[test]
    fn model_files_fall_back_to_their_name() {
        let mut options = ConvertOptions::new();
        options.add_file("r.glb", vec![1]);
        options.add_file("a/c.glb", vec![2]);
        options.add_file("b/c.glb", vec![3]);
        assert_eq!(options.file("./r.glb"), Ok(vec![1]));
        assert_eq!(options.file("models/r.glb"), Ok(vec![1]));
        assert_eq!(options.file("b/c.glb"), Ok(vec![3]));
        assert!(options.file("x/c.glb").is_err());
        assert!(options.file("missing.glb").is_err());
    }
}
