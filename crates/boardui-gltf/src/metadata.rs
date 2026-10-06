//! `EXT_mesh_features` and `EXT_structural_metadata` (spec §8.1, §8.2).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// The `EXT_structural_metadata` schema every boardui asset embeds
/// (`spec/schema/structural-metadata.json`).
pub const SCHEMA_JSON: &str = include_str!("../schema/structural-metadata.json");

/// The embedded schema, parsed.
pub fn schema() -> Value {
    serde_json::from_str(SCHEMA_JSON).expect("the embedded schema is valid JSON")
}

/// `null` for row references in the property tables (spec §8.2).
pub const NO_ROW: u32 = u32::MAX;

/// Root extension `EXT_structural_metadata`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralMetadata {
    /// `schema`, embedded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<Value>,
    /// `schemaUri`, if the schema is external.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_uri: Option<String>,
    /// `propertyTables`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub property_tables: Vec<PropertyTable>,
}

/// A property table.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyTable {
    /// `name`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// `class`.
    pub class: String,
    /// `count`: number of rows.
    pub count: u32,
    /// `properties`, by property name.
    #[serde(default)]
    pub properties: BTreeMap<String, PropertyTableProperty>,
}

/// A column of a property table.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyTableProperty {
    /// `values` buffer view.
    pub values: u32,
    /// `stringOffsets` buffer view, for strings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub string_offsets: Option<u32>,
    /// `stringOffsetType`. Absent: `UINT32`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub string_offset_type: Option<String>,
    /// `arrayOffsets` buffer view, not used by boardui.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub array_offsets: Option<u32>,
}

/// Primitive extension `EXT_mesh_features`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshFeatures {
    /// `featureIds`.
    pub feature_ids: Vec<FeatureIdSet>,
}

/// One entry of `featureIds`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureIdSet {
    /// `featureCount`: number of distinct feature IDs.
    pub feature_count: u32,
    /// `attribute`: `n` of `_FEATURE_ID_n`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribute: Option<u32>,
    /// `propertyTable`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub property_table: Option<u32>,
    /// `nullFeatureId`, not used by boardui.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub null_feature_id: Option<u32>,
    /// `texture`, not used by boardui.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub texture: Option<Value>,
    /// `label`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}
