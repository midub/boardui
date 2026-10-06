//! Enumerated attribute values.

use super::xml::AttrEnum;
use crate::{
    ButterflyShape, FillProperty, LineEnd, LineProperty, MountType, PadUsage, PadUse, PlatingStatus, Polarity,
    RingShape, Side, Units, WhereMeasured,
};

macro_rules! attr_enum {
    ($ty:ty { $($value:literal => $variant:expr),+ $(,)? }) => {
        impl AttrEnum for $ty {
            const EXPECTED: &'static str = concat!("one of" $(, " ", $value)+);

            fn from_attr(value: &str) -> Option<Self> {
                match value {
                    $($value => Some($variant),)+
                    _ => None,
                }
            }
        }
    };
}

attr_enum!(Units {
    "INCH" => Units::Inch,
    "MILLIMETER" => Units::Millimeter,
    "MICRON" => Units::Micron,
});

attr_enum!(Side {
    "TOP" => Side::Top,
    "BOTTOM" => Side::Bottom,
    "BOTH" => Side::Both,
    "INTERNAL" => Side::Internal,
    "ALL" => Side::All,
    "NONE" => Side::None,
});

attr_enum!(Polarity {
    "POSITIVE" => Polarity::Positive,
    "NEGATIVE" => Polarity::Negative,
});

attr_enum!(WhereMeasured {
    "METAL" => WhereMeasured::Metal,
    "MASK" => WhereMeasured::Mask,
    "LAMINATE" => WhereMeasured::Laminate,
    "OTHER" => WhereMeasured::Other,
});

attr_enum!(PlatingStatus {
    "PLATED" => PlatingStatus::Plated,
    "NONPLATED" => PlatingStatus::NonPlated,
    "VIA" => PlatingStatus::Via,
});

attr_enum!(PadUse {
    "REGULAR" => PadUse::Regular,
    "ANTIPAD" => PadUse::Antipad,
    "THERMAL" => PadUse::Thermal,
    "OTHER" => PadUse::Other,
});

attr_enum!(MountType {
    "SMT" => MountType::Smt,
    "THMT" => MountType::Thmt,
    "OTHER" => MountType::Other,
});

attr_enum!(LineEnd {
    "ROUND" => LineEnd::Round,
    "SQUARE" => LineEnd::Square,
    "NONE" => LineEnd::None,
});

attr_enum!(LineProperty {
    "SOLID" => LineProperty::Solid,
    "DOTTED" => LineProperty::Dotted,
    "DASHED" => LineProperty::Dashed,
    "CENTER" => LineProperty::Center,
    "PHANTOM" => LineProperty::Phantom,
    "ERASE" => LineProperty::Erase,
});

attr_enum!(FillProperty {
    "FILL" => FillProperty::Fill,
    "HOLLOW" => FillProperty::Hollow,
    "HATCH" => FillProperty::Hatch,
    "MESH" => FillProperty::Mesh,
    "VOID" => FillProperty::Void,
});

attr_enum!(RingShape {
    "ROUND" => RingShape::Round,
    "SQUARE" => RingShape::Square,
    "HEXAGON" => RingShape::Hexagon,
    "OCTAGON" => RingShape::Octagon,
});

attr_enum!(ButterflyShape {
    "ROUND" => ButterflyShape::Round,
    "SQUARE" => ButterflyShape::Square,
});

impl PadUsage {
    /// `padUsage` is an open list: values other than `TERMINATION` and `VIA` are kept as written.
    pub(super) fn from_attr(value: &str) -> Self {
        match value.trim() {
            "TERMINATION" => Self::Termination,
            "VIA" => Self::Via,
            other => Self::Other(other.to_owned()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_values_and_rejects_others() {
        assert_eq!(Units::from_attr("MICRON"), Some(Units::Micron));
        assert_eq!(Units::from_attr("inch"), None);
        assert_eq!(Side::from_attr("INTERNAL"), Some(Side::Internal));
        assert_eq!(
            PlatingStatus::from_attr("NONPLATED"),
            Some(PlatingStatus::NonPlated)
        );
        assert_eq!(Units::EXPECTED, "one of INCH MILLIMETER MICRON");
    }

    #[test]
    fn pad_usage_keeps_unknown_values() {
        assert_eq!(PadUsage::from_attr("VIA"), PadUsage::Via);
        assert_eq!(PadUsage::from_attr("TERMINATION"), PadUsage::Termination);
        assert_eq!(
            PadUsage::from_attr("PLANE"),
            PadUsage::Other("PLANE".to_owned())
        );
    }
}
