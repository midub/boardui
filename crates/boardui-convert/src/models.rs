//! The model mapping file (`spec/schema/models.schema.json`, spec §6.9).

use std::fmt;
use std::path::Path;

use boardui_gltf::{Model, Transform};
use glam::{DQuat, EulerRot};
use serde::Deserialize;

/// The mapping file.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Mapping {
    version: u32,
    models: Vec<RawRule>,
}

/// A rule as written. Rules that only the viewer can apply (its runtime `mappingSource`:
/// wildcards, `refDes` and attribute matches, URLs, templates, STEP and OBJ models) are
/// skipped with a warning.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RawRule {
    #[serde(rename = "match")]
    matcher: serde_json::Map<String, serde_json::Value>,
    file: String,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    offset_mm: [f64; 3],
    #[serde(default)]
    rotation_deg: [f64; 3],
    #[serde(default = "one")]
    scale: f64,
}

impl RawRule {
    /// The rule as the converter applies it, or (`Ok(Err(reason))`) why only the viewer can
    /// apply it.
    fn resolve(self, index: usize) -> Result<Result<ModelRule, String>, MappingError> {
        let invalid = |what: &str| {
            MappingError(format!(
                "invalid model mapping: rule {index} (`{}`): {what}",
                self.file
            ))
        };
        if self.matcher.is_empty() {
            return Err(invalid("`match` is empty"));
        }
        for (key, value) in &self.matcher {
            let ok = match key.as_str() {
                "part" | "package" | "refDes" => value.is_string(),
                "attributes" => value
                    .as_object()
                    .is_some_and(|a| a.values().all(serde_json::Value::is_string)),
                _ => return Err(invalid(&format!("unknown match field `{key}`"))),
            };
            if !ok {
                return Err(invalid(&format!("`match.{key}` has the wrong type")));
            }
        }
        let format = self.format.clone().or_else(|| {
            Path::new(&self.file)
                .extension()
                .map(|e| e.to_string_lossy().to_ascii_lowercase())
        });
        let only = |reason: &str| Ok(Err(reason.to_owned()));
        let single = (self.matcher.len() == 1)
            .then(|| self.matcher.iter().next())
            .flatten();
        let matcher = match single {
            Some((key, serde_json::Value::String(value))) if key == "part" || key == "package" => {
                if value.contains(['*', '?']) {
                    return only("it matches with wildcards");
                }
                if key == "part" {
                    Match::Part {
                        part: value.clone(),
                    }
                } else {
                    Match::Package {
                        package: value.clone(),
                    }
                }
            }
            _ => return only("it matches on more than the part or the package"),
        };
        if self.file.contains("://") {
            return only("its file is a URL");
        }
        if self.file.contains('{') {
            return only("its file is a template");
        }
        // Without a `format`, any file but STEP and OBJ is read as glTF, as before.
        match (self.format.as_deref(), format.as_deref()) {
            (Some("glb" | "gltf"), _) => {}
            (Some(other), _) | (None, Some(other @ ("step" | "stp" | "obj"))) => {
                return only(&format!("its model is {other}"));
            }
            (None, _) => {}
        }
        Ok(Ok(ModelRule {
            matcher,
            file: self.file,
            offset_mm: self.offset_mm,
            rotation_deg: self.rotation_deg,
            scale: self.scale,
        }))
    }
}

/// One rule of the mapping file.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ModelRule {
    /// What the rule matches.
    #[serde(rename = "match")]
    pub matcher: Match,
    /// Path of the `.glb` or `.gltf` file, relative to the mapping file.
    pub file: String,
    /// Translation in the model frame, in millimetres.
    #[serde(default)]
    pub offset_mm: [f64; 3],
    /// Rotation about the model's X, then Y, then Z axis, in degrees.
    #[serde(default)]
    pub rotation_deg: [f64; 3],
    /// Uniform scale.
    #[serde(default = "one")]
    pub scale: f64,
}

fn one() -> f64 {
    1.0
}

/// The `match` of a [`ModelRule`].
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum Match {
    /// Matches components whose `part` equals this.
    Part {
        /// The part name.
        part: String,
    },
    /// Matches components whose package equals this.
    Package {
        /// The package name.
        package: String,
    },
}

impl ModelRule {
    /// The rule's correction as a node transform.
    pub fn transform(&self) -> Transform {
        let [x, y, z] = self.rotation_deg.map(f64::to_radians);
        // Fixed axes X, then Y, then Z.
        let rotation = DQuat::from_euler(EulerRot::ZYX, z, y, x);
        Transform {
            translation: self.offset_mm.map(|v| v * 1e-3),
            rotation: rotation.to_array(),
            scale: [self.scale; 3],
        }
    }
}

/// Why a mapping file can't be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MappingError(pub String);

impl fmt::Display for MappingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for MappingError {}

/// A mapping file with its models loaded.
#[derive(Debug, Clone)]
pub struct ModelLibrary {
    /// The rules, in file order.
    pub rules: Vec<ModelRule>,
    /// The distinct models.
    pub models: Vec<Model>,
    /// For each rule, its index into `models`.
    rule_models: Vec<usize>,
    /// Messages about parts of models that were dropped.
    pub warnings: Vec<String>,
}

impl ModelLibrary {
    /// Parses a mapping file and loads its models with `load`, which reads a path relative
    /// to the mapping file.
    ///
    /// # Errors
    ///
    /// Returns an error for a malformed mapping file or a model that can't be read.
    pub fn from_json(
        json: &str,
        mut load: impl FnMut(&str) -> Result<Vec<u8>, String>,
    ) -> Result<Self, MappingError> {
        let mapping: Mapping = serde_json::from_str(json)
            .map_err(|e| MappingError(format!("invalid model mapping: {e}")))?;
        if mapping.version != 1 {
            return Err(MappingError(format!(
                "unsupported model mapping version {} (expected 1)",
                mapping.version
            )));
        }
        let mut files: Vec<String> = Vec::new();
        let mut models = Vec::new();
        let mut rule_models = Vec::new();
        let mut warnings = Vec::new();
        let mut rules = Vec::new();
        for (index, raw) in mapping.models.into_iter().enumerate() {
            let file = raw.file.clone();
            match raw.resolve(index)? {
                Ok(rule) => rules.push(rule),
                Err(reason) => warnings.push(format!(
                    "model rule {index} (`{file}`) skipped: {reason}, which only the viewer's \
                     runtime models read"
                )),
            }
        }
        for rule in &rules {
            if !(rule.scale.is_finite() && rule.scale > 0.0)
                || !rule
                    .offset_mm
                    .iter()
                    .chain(&rule.rotation_deg)
                    .all(|v| v.is_finite())
            {
                return Err(MappingError(format!(
                    "the rule for `{}` has an invalid offset, rotation or scale",
                    rule.file
                )));
            }
            if let Some(i) = files.iter().position(|f| *f == rule.file) {
                rule_models.push(i);
                continue;
            }
            let bytes = load(&rule.file)
                .map_err(|e| MappingError(format!("cannot read model `{}`: {e}", rule.file)))?;
            let dir = rule.file.rsplit_once('/').map_or("", |(d, _)| d).to_owned();
            let name = Path::new(&rule.file)
                .file_stem()
                .map_or_else(|| rule.file.clone(), |s| s.to_string_lossy().into_owned());
            let model = Model::from_slice(&name, &bytes, |uri| {
                let path = if dir.is_empty() {
                    uri.to_owned()
                } else {
                    format!("{dir}/{uri}")
                };
                load(&path)
            })
            .map_err(|e| MappingError(format!("cannot read model `{}`: {e}", rule.file)))?;
            warnings.extend(model.warnings.iter().map(|w| format!("{}: {w}", rule.file)));
            files.push(rule.file.clone());
            rule_models.push(models.len());
            models.push(model);
        }
        Ok(Self {
            rules,
            models,
            rule_models,
            warnings,
        })
    }

    /// Reads a mapping file and its models from disk.
    ///
    /// # Errors
    ///
    /// See [`Self::from_json`]; also fails if the file can't be read.
    pub fn load(path: &Path) -> Result<Self, MappingError> {
        let json = std::fs::read_to_string(path)
            .map_err(|e| MappingError(format!("cannot read {}: {e}", path.display())))?;
        let dir = path.parent().unwrap_or(Path::new("."));
        Self::from_json(&json, |file| {
            std::fs::read(dir.join(file)).map_err(|e| e.to_string())
        })
    }

    /// The model for a component and the correction of the matching rule: rules matching
    /// the part first, then rules matching the package; the first match wins (spec §6.9).
    pub fn find(&self, part: Option<&str>, package: &str) -> Option<(usize, Transform)> {
        let by_part = part.and_then(|part| {
            self.rules
                .iter()
                .position(|r| matches!(&r.matcher, Match::Part { part: p } if p == part))
        });
        let index = by_part.or_else(|| {
            self.rules
                .iter()
                .position(|r| matches!(&r.matcher, Match::Package { package: p } if p == package))
        })?;
        Some((self.rule_models[index], self.rules[index].transform()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal glTF with one triangle, as a data URI buffer.
    pub(crate) fn triangle_gltf() -> String {
        use base64::Engine;
        let mut bin = Vec::new();
        for v in [0f32, 0.0, 0.0, 0.001, 0.0, 0.0, 0.0, 0.001, 0.0] {
            bin.extend_from_slice(&v.to_le_bytes());
        }
        let data = base64::engine::general_purpose::STANDARD.encode(&bin);
        format!(
            r#"{{"asset":{{"version":"2.0"}},"scene":0,"scenes":[{{"nodes":[0]}}],
            "nodes":[{{"mesh":0,"translation":[0,0.001,0]}}],
            "meshes":[{{"primitives":[{{"attributes":{{"POSITION":0}}}}]}}],
            "accessors":[{{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3",
              "min":[0,0,0],"max":[0.001,0.001,0]}}],
            "bufferViews":[{{"buffer":0,"byteLength":36}}],
            "buffers":[{{"byteLength":36,"uri":"data:application/octet-stream;base64,{data}"}}]}}"#
        )
    }

    #[test]
    fn rules_match_part_before_package() {
        let json = r#"{"version":1,"models":[
            {"match":{"package":"SOIC8"},"file":"a.gltf"},
            {"match":{"part":"LM358"},"file":"b.gltf","offsetMm":[1,0,0],"rotationDeg":[0,90,0],"scale":0.001},
            {"match":{"package":"0402"},"file":"a.gltf"}]}"#;
        let mut loads = Vec::new();
        let library = ModelLibrary::from_json(json, |f| {
            loads.push(f.to_owned());
            Ok(triangle_gltf().into_bytes())
        })
        .unwrap();
        assert_eq!(loads, ["a.gltf", "b.gltf"], "each file is read once");
        assert_eq!(library.models.len(), 2);
        let (model, t) = library.find(Some("LM358"), "SOIC8").unwrap();
        assert_eq!(model, 1);
        assert_eq!(t.translation, [1e-3, 0.0, 0.0]);
        assert_eq!(t.scale, [1e-3; 3]);
        let q = DQuat::from_array(t.rotation);
        assert!((q * glam::DVec3::X - glam::DVec3::NEG_Z).length() < 1e-12);
        assert_eq!(library.find(Some("other"), "SOIC8").unwrap().0, 0);
        assert_eq!(library.find(None, "0402").unwrap().0, 0);
        assert!(library.find(None, "QFN").is_none());
        let p = &library.models[0].primitives[0];
        assert_eq!(
            p.positions[2],
            [0.0, 0.002, 0.0],
            "node transforms are baked"
        );
    }

    #[test]
    fn runtime_only_rules_are_skipped_with_a_warning() {
        let json = r#"{"version":1,"models":[
            {"match":{"package":"C*"},"file":"c.glb"},
            {"match":{"refDes":"J1"},"file":"j1.glb"},
            {"match":{"part":"X","package":"Y"},"file":"x.glb"},
            {"match":{"attributes":{"MPN":"GRM155"}},"file":"m.glb"},
            {"match":{"package":"QFN"},"file":"https://models.example/qfn.glb"},
            {"match":{"package":"SOT"},"file":"{package}.glb"},
            {"match":{"package":"R0402"},"file":"r.step"},
            {"match":{"package":"R0603"},"file":"r.bin","format":"obj"},
            {"match":{"package":"0402"},"file":"a.gltf"}]}"#;
        let mut loads = Vec::new();
        let library = ModelLibrary::from_json(json, |f| {
            loads.push(f.to_owned());
            Ok(triangle_gltf().into_bytes())
        })
        .unwrap();
        assert_eq!(loads, ["a.gltf"]);
        assert_eq!(library.rules.len(), 1);
        assert!(library.find(None, "0402").is_some());
        let reasons: Vec<_> = library
            .warnings
            .iter()
            .map(|w| {
                w.split(" skipped: ")
                    .nth(1)
                    .unwrap()
                    .split(',')
                    .next()
                    .unwrap()
            })
            .collect();
        assert_eq!(
            reasons,
            [
                "it matches with wildcards",
                "it matches on more than the part or the package",
                "it matches on more than the part or the package",
                "it matches on more than the part or the package",
                "its file is a URL",
                "its file is a template",
                "its model is step",
                "its model is obj",
            ]
        );
        assert!(library.warnings[0].starts_with("model rule 0 (`c.glb`) skipped"));
    }

    #[test]
    fn bad_mappings_are_rejected() {
        let ok = |_: &str| Ok(triangle_gltf().into_bytes());
        assert!(ModelLibrary::from_json(r#"{"version":2,"models":[]}"#, ok).is_err());
        assert!(
            ModelLibrary::from_json(
                r#"{"version":1,"models":[{"match":{"x":"y"},"file":"a"}]}"#,
                ok
            )
            .is_err()
        );
        assert!(
            ModelLibrary::from_json(
                r#"{"version":1,"models":[{"match":{"part":"p"},"file":"a","scale":0}]}"#,
                ok
            )
            .is_err()
        );
        let missing = |_: &str| Err("no such file".to_owned());
        assert!(
            ModelLibrary::from_json(
                r#"{"version":1,"models":[{"match":{"part":"p"},"file":"a"}]}"#,
                missing
            )
            .is_err()
        );
    }
}
