//! WebAssembly bindings for the boardui converter, wrapped by the `@boardui/converter` npm
//! package.
//!
//! Conversion bindings arrive with milestone M5; see `docs/roadmap.md`.

use wasm_bindgen::prelude::wasm_bindgen;

/// Returns the converter version.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}
