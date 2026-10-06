//! `BOARDUI_board` (spec §8.3), component `extras` (spec §8.4) and the enums of the embedded
//! metadata schema.
//!
//! The types mirror `spec/schema/BOARDUI_board.schema.json` and
//! `spec/schema/component-extras.schema.json`: deserializing rejects unknown properties.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The profile version written by this crate (spec §11).
pub const PROFILE_VERSION: &str = "0.3";

/// Root extension `BOARDUI_board`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Board {
    /// `profileVersion`, `major.minor`.
    pub profile_version: String,
    /// `source`.
    pub source: Source,
    /// `tolerance`: chord deviation of arc tessellation, in metres.
    pub tolerance: f64,
    /// `platingThickness`: barrel wall, in metres.
    pub plating_thickness: f64,
    /// `thickness`: copper-to-copper board thickness, in metres.
    pub thickness: f64,
    /// `layers`, top to bottom.
    pub layers: Vec<BoardLayer>,
    /// `drills`.
    pub drills: Vec<BoardDrill>,
    /// `tables`: indices of the shared property tables.
    pub tables: Tables,
    /// `extensions`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Value>,
    /// `extras`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extras: Option<Value>,
}

/// `BOARDUI_board.source`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    /// `format`, always `IPC-2581`.
    pub format: String,
    /// `revision`, for example `C`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    /// `step`: the converted step.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    /// `functionMode`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function_mode: Option<String>,
    /// `sha256` of the source file, lowercase hex.
    pub sha256: String,
}

/// An entry of `BOARDUI_board.layers`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardLayer {
    /// `id`: `layer/<name>`.
    pub id: String,
    /// `name`.
    pub name: String,
    /// `role`.
    pub role: Role,
    /// `ipcFunction`: the source `layerFunction`; absent for synthesized layers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ipc_function: Option<String>,
    /// `side`.
    pub side: Side,
    /// `zMin`, metres.
    pub z_min: f64,
    /// `zMax`, metres.
    pub z_max: f64,
    /// `thicknessSource`.
    pub thickness_source: ThicknessSource,
    /// `synthesized`.
    pub synthesized: bool,
    /// `visible`: suggested default visibility.
    pub visible: bool,
    /// `node`: the layer node.
    pub node: u32,
    /// `featureTable`: index into `EXT_structural_metadata.propertyTables`; absent when the
    /// layer has no features (property tables can't be empty).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature_table: Option<u32>,
}

/// An entry of `BOARDUI_board.drills`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardDrill {
    /// `id`: `layer/<name>`.
    pub id: String,
    /// `name`.
    pub name: String,
    /// `from`: layer ID of the upper copper layer of the span.
    pub from: String,
    /// `to`: layer ID of the lower copper layer of the span.
    pub to: String,
    /// `node`: the drill node.
    pub node: u32,
    /// `featureTable`; absent when the drill layer has no features.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature_table: Option<u32>,
}

/// `BOARDUI_board.tables`. A table without rows is omitted, because property tables can't
/// be empty.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tables {
    /// The `nets` table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nets: Option<u32>,
    /// The `components` table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub components: Option<u32>,
    /// The `pins` table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pins: Option<u32>,
}

/// `role` of a layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Role {
    /// Copper.
    Copper,
    /// Dielectric.
    Dielectric,
    /// Soldermask.
    Soldermask,
    /// Silkscreen.
    Silkscreen,
}

/// `side` of a layer or component, and the `Side` enum of the metadata schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Side {
    /// Top.
    Top,
    /// Bottom.
    Bottom,
    /// Inner layers.
    Internal,
}

impl Side {
    /// Value in the `Side` enum of the metadata schema.
    pub fn value(self) -> u8 {
        match self {
            Self::Top => 0,
            Self::Bottom => 1,
            Self::Internal => 2,
        }
    }

    /// The side for an enum value.
    pub fn from_value(value: u8) -> Option<Self> {
        Some(match value {
            0 => Self::Top,
            1 => Self::Bottom,
            2 => Self::Internal,
            _ => return None,
        })
    }
}

/// `thicknessSource` of a layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ThicknessSource {
    /// From the IPC-2581 stack-up.
    File,
    /// From the profile defaults (spec §6.4).
    Default,
}

/// `Mount` enum of the metadata schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Mount {
    /// Surface mount.
    Smt,
    /// Through-hole.
    Thmt,
    /// Anything else, or unknown.
    Other,
}

impl Mount {
    /// Value in the `Mount` enum of the metadata schema.
    pub fn value(self) -> u8 {
        match self {
            Self::Smt => 0,
            Self::Thmt => 1,
            Self::Other => 255,
        }
    }

    /// The mount type for an enum value.
    pub fn from_value(value: u8) -> Option<Self> {
        Some(match value {
            0 => Self::Smt,
            1 => Self::Thmt,
            255 => Self::Other,
            _ => return None,
        })
    }
}

/// `FeatureKind` enum of the metadata schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum FeatureKind {
    /// Component pad.
    Pad,
    /// Via land.
    Via,
    /// Trace: line, arc or polyline.
    Trace,
    /// Fill: contour or plane.
    Fill,
    /// Plated barrel of a hole.
    Barrel,
    /// Silkscreen marking.
    Marking,
    /// Soldermask or dielectric sheet.
    Sheet,
    /// Fiducial; its type is in [`FeatureRow::fiducial`](crate::FeatureRow::fiducial).
    Fiducial,
    /// Anything else.
    Other,
}

impl FeatureKind {
    /// Value in the `FeatureKind` enum of the metadata schema.
    pub fn value(self) -> u8 {
        match self {
            Self::Pad => 0,
            Self::Via => 1,
            Self::Trace => 2,
            Self::Fill => 3,
            Self::Barrel => 4,
            Self::Marking => 5,
            Self::Sheet => 6,
            Self::Fiducial => 7,
            Self::Other => 255,
        }
    }

    /// The kind for an enum value.
    pub fn from_value(value: u8) -> Option<Self> {
        Some(match value {
            0 => Self::Pad,
            1 => Self::Via,
            2 => Self::Trace,
            3 => Self::Fill,
            4 => Self::Barrel,
            5 => Self::Marking,
            6 => Self::Sheet,
            7 => Self::Fiducial,
            255 => Self::Other,
            _ => return None,
        })
    }
}

/// `Fiducial` enum of the metadata schema: the IPC-2581 fiducial element.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Fiducial {
    /// `GlobalFiducial`.
    Global,
    /// `LocalFiducial`.
    Local,
    /// `BadBoardMark`.
    BadBoard,
    /// `GoodPanelMark`.
    GoodPanel,
}

impl Fiducial {
    /// Value in the `Fiducial` enum of the metadata schema. `NONE` (no fiducial) is 255.
    pub fn value(self) -> u8 {
        match self {
            Self::Global => 0,
            Self::Local => 1,
            Self::BadBoard => 2,
            Self::GoodPanel => 3,
        }
    }

    /// The fiducial type for an enum value; `None` for `NONE` and unknown values.
    pub fn from_value(value: u8) -> Option<Self> {
        Some(match value {
            0 => Self::Global,
            1 => Self::Local,
            2 => Self::BadBoard,
            3 => Self::GoodPanel,
            _ => return None,
        })
    }
}

/// `extras` of a component node (spec §8.4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentExtras {
    /// `boardui`.
    pub boardui: ComponentInfo,
}

/// `extras.boardui` of a component node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComponentInfo {
    /// `id`: `cmp/<refDes>`.
    pub id: String,
    /// `row` in the `components` table.
    pub row: u32,
    /// `refDes`.
    pub ref_des: String,
    /// `part`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
    /// `package`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
    /// `side`: `TOP` or `BOTTOM`.
    pub side: Side,
    /// `mount`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mount: Option<Mount>,
}
