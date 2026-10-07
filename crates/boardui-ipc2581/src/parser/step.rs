//! `Step`: profile, padstacks, packages, components and layer features.

use std::io::BufRead;
use std::mem::take;

use super::{Parser, insert, missing_element};
use crate::{
    Component, DiagnosticKind, Error, Feature, FeatureElement, Features, Fiducial, FiducialKind,
    Hole, LayerFeature, LayerHole, LayerPad, Marking, Package, PackageDrawing, Pad, PadStack,
    PadUsage, PadstackDef, PadstackPad, Pin, PinRef, RefKind, Set, SlotCavity, Step, StepRepeat,
    Table,
};

/// The `pinOne` KiCad writes for a package whose pin 1 it can't tell.
const UNKNOWN_PIN_ONE: &str = "UNKNOWN";

impl<R: BufRead> Parser<R> {
    pub(super) fn read_step(&mut self) -> Result<(), Error> {
        let position = self.tag.position;
        self.step = Step {
            name: self.req_str("name")?,
            ..Step::default()
        };
        self.children("Step", |p| match p.tag.name() {
            "Datum" if p.step.datum.is_none() => {
                p.step.datum = Some(p.read_point("Datum")?);
                Ok(())
            }
            "Profile" if p.step.profile.is_none() => {
                p.step.profile = Some(p.read_contour("Profile")?);
                Ok(())
            }
            "Datum" | "Profile" => p.duplicate("Step"),
            "StepRepeat" => {
                let repeat = p.read_step_repeat()?;
                p.step.step_repeats.push(repeat);
                Ok(())
            }
            "PadStack" => {
                let pad_stack = p.read_pad_stack()?;
                p.step.pad_stacks.push(pad_stack);
                Ok(())
            }
            "PadStackDef" => {
                let position = p.tag.position;
                let def = p.read_padstack_def()?;
                let key = def.name.clone();
                insert(
                    &mut p.diagnostics,
                    &mut p.step.padstack_defs,
                    RefKind::PadstackDef,
                    key,
                    def,
                    position,
                );
                Ok(())
            }
            "Package" => {
                let position = p.tag.position;
                let package = p.read_package()?;
                let key = package.name.clone();
                insert(
                    &mut p.diagnostics,
                    &mut p.step.packages,
                    RefKind::Package,
                    key,
                    package,
                    position,
                );
                Ok(())
            }
            "Component" => {
                let position = p.tag.position;
                let component = p.read_component()?;
                let key = component.ref_des.clone();
                insert(
                    &mut p.diagnostics,
                    &mut p.step.components,
                    RefKind::Component,
                    key,
                    component,
                    position,
                );
                Ok(())
            }
            "LayerFeature" => p.read_layer_feature(),
            _ => p.unknown("Step"),
        })?;
        let refs = take(&mut self.step_refs);
        self.resolve_deferred(refs);
        let step = take(&mut self.step);
        let key = step.name.clone();
        insert(
            &mut self.diagnostics,
            &mut self.steps,
            RefKind::Step,
            key,
            step,
            position,
        );
        Ok(())
    }

    fn read_step_repeat(&mut self) -> Result<StepRepeat, Error> {
        let step_ref = self.req_ref("stepRef")?;
        self.check_ref(RefKind::Step, &step_ref);
        let repeat = StepRepeat {
            step_ref,
            location: self.point("x", "y")?,
            nx: self.opt_u32("nx")?.unwrap_or(1),
            ny: self.opt_u32("ny")?.unwrap_or(1),
            dx: self.opt_len("dx")?.unwrap_or(0.0),
            dy: self.opt_len("dy")?.unwrap_or(0.0),
            angle: self.opt_f64("angle")?.unwrap_or(0.0),
            mirror: self.opt_bool("mirror")?.unwrap_or(false),
        };
        self.leaf("StepRepeat")?;
        Ok(repeat)
    }

    fn read_pad_stack(&mut self) -> Result<PadStack, Error> {
        let mut pad_stack = PadStack {
            net: self.opt_str("net"),
            hole: None,
            pads: Vec::new(),
        };
        self.children("PadStack", |p| match p.tag.name() {
            "LayerHole" if pad_stack.hole.is_some() => p.duplicate("PadStack"),
            "LayerHole" => {
                pad_stack.hole = Some(p.read_layer_hole()?);
                Ok(())
            }
            "LayerPad" => {
                pad_stack.pads.push(p.read_layer_pad()?);
                Ok(())
            }
            _ => p.unknown("PadStack"),
        })?;
        Ok(pad_stack)
    }

    fn read_layer_hole(&mut self) -> Result<LayerHole, Error> {
        let hole = Hole {
            name: self.req_str("name")?,
            diameter: self.req_len("diameter")?,
            plating: self.req_enum("platingStatus")?,
            plus_tol: self.req_len("plusTol")?,
            minus_tol: self.req_len("minusTol")?,
            position: self.point("x", "y")?,
        };
        let mut span = None;
        self.children("LayerHole", |p| match p.tag.name() {
            "Span" if span.is_none() => {
                span = Some(p.read_span()?);
                Ok(())
            }
            "Span" => p.duplicate("LayerHole"),
            _ => p.unknown("LayerHole"),
        })?;
        Ok(LayerHole { hole, span })
    }

    fn read_layer_pad(&mut self) -> Result<LayerPad, Error> {
        let position = self.tag.position;
        let layer_ref = self.req_ref("layerRef")?;
        self.check_ref(RefKind::Layer, &layer_ref);
        let (mut location, mut xform, mut shape, mut pin_ref) = (None, None, None, None);
        self.children("LayerPad", |p| {
            if p.placement("LayerPad", &mut location, &mut xform)? {
                Ok(())
            } else if p.tag.name() == "PinRef" {
                if pin_ref.is_some() {
                    return p.duplicate("LayerPad");
                }
                pin_ref = Some(p.read_pin_ref()?);
                Ok(())
            } else {
                p.shape_slot("LayerPad", &mut shape)
            }
        })?;
        Ok(LayerPad {
            layer_ref,
            location: location.unwrap_or_default(),
            xform: xform.unwrap_or_default(),
            shape: shape.ok_or_else(|| missing_element("LayerPad", "a shape", position))?,
            pin_ref,
        })
    }

    fn read_padstack_def(&mut self) -> Result<PadstackDef, Error> {
        let mut def = PadstackDef {
            name: self.req_str("name")?,
            hole: None,
            pads: Vec::new(),
        };
        self.children("PadStackDef", |p| match p.tag.name() {
            "PadstackHoleDef" if def.hole.is_some() => p.duplicate("PadStackDef"),
            "PadstackHoleDef" => {
                def.hole = Some(p.read_hole("PadstackHoleDef")?);
                Ok(())
            }
            "PadstackPadDef" => {
                def.pads.push(p.read_padstack_pad()?);
                Ok(())
            }
            _ => p.unknown("PadStackDef"),
        })?;
        Ok(def)
    }

    fn read_padstack_pad(&mut self) -> Result<PadstackPad, Error> {
        let layer_ref = self.req_ref("layerRef")?;
        self.check_ref(RefKind::Layer, &layer_ref);
        let pad_use = self.req_enum("padUse")?;
        let (mut location, mut xform, mut shape) = (None, None, None);
        self.children("PadstackPadDef", |p| {
            if p.placement("PadstackPadDef", &mut location, &mut xform)? {
                Ok(())
            } else {
                p.shape_slot("PadstackPadDef", &mut shape)
            }
        })?;
        Ok(PadstackPad {
            layer_ref,
            pad_use,
            location: location.unwrap_or_default(),
            xform: xform.unwrap_or_default(),
            shape,
        })
    }

    fn read_package(&mut self) -> Result<Package, Error> {
        let position = self.tag.position;
        let mut package = Package {
            name: self.req_str("name")?,
            package_type: self.opt_str("type"),
            height: self.opt_len("height")?,
            pin_one: self.opt_str("pinOne"),
            outline: None,
            pins: Table::default(),
            silkscreen: None,
            assembly_drawing: None,
        };
        self.children("Package", |p| match p.tag.name() {
            "Outline" if package.outline.is_some() => p.duplicate("Package"),
            "Outline" => {
                package.outline = Some(p.read_outline()?);
                Ok(())
            }
            "SilkScreen" if package.silkscreen.is_some() => p.duplicate("Package"),
            "SilkScreen" => {
                package.silkscreen = Some(p.read_drawing("SilkScreen")?);
                Ok(())
            }
            "AssemblyDrawing" if package.assembly_drawing.is_some() => p.duplicate("Package"),
            "AssemblyDrawing" => {
                package.assembly_drawing = Some(p.read_drawing("AssemblyDrawing")?);
                Ok(())
            }
            "Pin" => {
                let position = p.tag.position;
                let pin = p.read_pin()?;
                let key = pin.number.clone();
                insert(
                    &mut p.diagnostics,
                    &mut package.pins,
                    RefKind::Pin,
                    key,
                    pin,
                    position,
                );
                Ok(())
            }
            _ => p.unknown("Package"),
        })?;
        // KiCad writes `pinOne="UNKNOWN"` when no pad has one of the numbers it takes for pin 1
        // (`1`, `A1`, `A`, `a`, `a1`, `Anode`, `ANODE`): pin 1 is not given. A pin that is
        // really numbered `UNKNOWN` is still pin 1.
        if package.pin_one.as_deref() == Some(UNKNOWN_PIN_ONE)
            && package.pins.get(UNKNOWN_PIN_ONE).is_none()
        {
            package.pin_one = None;
        }
        // A package without pins (a logo, a placeholder) has no pin 1 to point at.
        if let Some(pin_one) = &package.pin_one
            && !package.pins.is_empty()
            && package.pins.get(pin_one).is_none()
        {
            self.diagnostics.warn(
                DiagnosticKind::DanglingReference {
                    kind: RefKind::Pin,
                    key: format!("{}/{pin_one}", package.name),
                },
                position,
            );
        }
        Ok(package)
    }

    fn read_pin(&mut self) -> Result<Pin, Error> {
        let number = self.req_str("number")?;
        let name = self.opt_str("name");
        let (mut location, mut xform, mut shape) = (None, None, None);
        self.children("Pin", |p| {
            if p.placement("Pin", &mut location, &mut xform)? {
                Ok(())
            } else {
                p.shape_slot("Pin", &mut shape)
            }
        })?;
        Ok(Pin {
            number,
            name,
            location: location.unwrap_or_default(),
            xform: xform.unwrap_or_default(),
            shape,
        })
    }

    /// Reads a package `SilkScreen` or `AssemblyDrawing`.
    fn read_drawing(&mut self, element: &'static str) -> Result<PackageDrawing, Error> {
        let mut drawing = PackageDrawing::default();
        self.children(element, |p| match p.tag.name() {
            "Outline" => {
                drawing.outlines.push(p.read_outline()?);
                Ok(())
            }
            "Marking" => {
                drawing.markings.push(p.read_marking()?);
                Ok(())
            }
            _ => p.unknown(element),
        })?;
        Ok(drawing)
    }

    fn read_marking(&mut self) -> Result<Marking, Error> {
        let position = self.tag.position;
        let usage = self.opt_str("markingUsage");
        let (mut location, mut xform, mut shape) = (None, None, None);
        self.children("Marking", |p| {
            if p.placement("Marking", &mut location, &mut xform)? {
                Ok(())
            } else {
                p.shape_slot("Marking", &mut shape)
            }
        })?;
        Ok(Marking {
            usage,
            location: location.unwrap_or_default(),
            xform: xform.unwrap_or_default(),
            shape: shape.ok_or_else(|| missing_element("Marking", "a shape", position))?,
        })
    }

    fn read_component(&mut self) -> Result<Component, Error> {
        let ref_des = self.req_str("refDes")?;
        let package_ref = self.req_ref("packageRef")?;
        self.check_ref(RefKind::Package, &package_ref);
        let layer_ref = self.req_ref("layerRef")?;
        self.check_ref(RefKind::Layer, &layer_ref);
        let part = self.opt_str("part");
        let mount_type = self.opt_enum("mountType")?;
        let standoff = self.opt_len("standoff")?;
        let height = self.opt_len("height")?;
        let (mut location, mut xform) = (None, None);
        self.children("Component", |p| {
            if p.placement("Component", &mut location, &mut xform)? {
                Ok(())
            } else {
                p.unknown("Component")
            }
        })?;
        Ok(Component {
            ref_des,
            package_ref,
            layer_ref,
            part,
            mount_type,
            standoff,
            height,
            location: location.unwrap_or_default(),
            xform: xform.unwrap_or_default(),
        })
    }

    /// Reads a `LayerFeature`, merging it into the step's entry for its layer. Source indices
    /// continue from the features already read for that layer.
    fn read_layer_feature(&mut self) -> Result<(), Error> {
        let layer_ref = self.req_ref("layerRef")?;
        self.check_ref(RefKind::Layer, &layer_ref);
        let mut next_source = self
            .step
            .layer_features
            .get(&layer_ref)
            .map_or(0, LayerFeature::feature_count);
        let mut sets = Vec::new();
        self.children("LayerFeature", |p| match p.tag.name() {
            "Set" => {
                sets.push(p.read_set(&mut next_source)?);
                Ok(())
            }
            _ => p.unknown("LayerFeature"),
        })?;
        match self.step.layer_features.get_mut(&layer_ref) {
            Some(entry) => entry.sets.append(&mut sets),
            None => self
                .step
                .layer_features
                .insert(layer_ref.clone(), LayerFeature { layer_ref, sets }),
        }
        Ok(())
    }

    fn read_set(&mut self, next_source: &mut usize) -> Result<Set, Error> {
        let component_ref = self.opt_ref("componentRef")?;
        if let Some(component) = &component_ref {
            self.check_ref(RefKind::Component, component);
        }
        let mut set = Set {
            net: self.opt_str("net"),
            polarity: self.opt_enum("polarity")?.unwrap_or_default(),
            pad_usage: self.opt_str("padUsage").map(|s| PadUsage::from_attr(&s)),
            test_point: self.opt_bool("testPoint")?.unwrap_or(false),
            geometry: self.opt_str("geometry"),
            geometry_usage: self.opt_str("geometryUsage"),
            plate: self.opt_bool("plate")?.unwrap_or(false),
            component_ref,
            color_ref: None,
            features: Vec::new(),
        };
        self.children("Set", |p| {
            let element = match p.tag.name() {
                "Pad" => FeatureElement::Pad(p.read_pad()?),
                "Features" => FeatureElement::Features(p.read_features()?),
                "GlobalFiducial" => {
                    FeatureElement::Fiducial(p.read_fiducial(FiducialKind::Global)?)
                }
                "LocalFiducial" => FeatureElement::Fiducial(p.read_fiducial(FiducialKind::Local)?),
                "BadBoardMark" => {
                    FeatureElement::Fiducial(p.read_fiducial(FiducialKind::BadBoard)?)
                }
                "GoodPanelMark" => {
                    FeatureElement::Fiducial(p.read_fiducial(FiducialKind::GoodPanel)?)
                }
                "Hole" => FeatureElement::Hole(p.read_hole("Hole")?),
                "SlotCavity" => FeatureElement::SlotCavity(p.read_slot_cavity()?),
                "ColorRef" if set.color_ref.is_some() => return p.duplicate("Set"),
                "ColorRef" => {
                    set.color_ref = Some(p.read_ref("ColorRef", "id", RefKind::Color)?);
                    return Ok(());
                }
                _ => return p.unknown("Set"),
            };
            set.features.push(Feature {
                source: *next_source,
                element,
            });
            *next_source += 1;
            Ok(())
        })?;
        // Most sets hold a single feature; don't keep the growth reserve.
        set.features.shrink_to_fit();
        Ok(set)
    }

    fn read_pad(&mut self) -> Result<Pad, Error> {
        let padstack_def_ref = self.opt_ref("padstackDefRef")?;
        if let Some(def) = &padstack_def_ref {
            self.check_ref(RefKind::PadstackDef, def);
        }
        let (mut location, mut xform, mut shape) = (None, None, None);
        let mut pin_refs = Vec::new();
        self.children("Pad", |p| {
            if p.placement("Pad", &mut location, &mut xform)? {
                Ok(())
            } else if p.tag.name() == "PinRef" {
                pin_refs.push(p.read_pin_ref()?);
                Ok(())
            } else {
                p.shape_slot("Pad", &mut shape)
            }
        })?;
        pin_refs.shrink_to_fit();
        Ok(Pad {
            padstack_def_ref,
            location: location.unwrap_or_default(),
            xform: xform.unwrap_or_default(),
            shape,
            pin_refs,
        })
    }

    fn read_pin_ref(&mut self) -> Result<PinRef, Error> {
        let pin_ref = PinRef {
            component_ref: self.opt_ref("componentRef")?,
            pin: self.req_ref("pin")?,
            title: self.opt_str("title"),
        };
        if let Some(component) = &pin_ref.component_ref {
            self.check_ref(RefKind::Component, component);
            self.check_pin(component, &pin_ref.pin);
        }
        self.leaf("PinRef")?;
        Ok(pin_ref)
    }

    fn read_features(&mut self) -> Result<Features, Error> {
        let position = self.tag.position;
        let (mut location, mut xform, mut shape) = (None, None, None);
        self.children("Features", |p| {
            if p.placement("Features", &mut location, &mut xform)? {
                Ok(())
            } else {
                p.shape_slot("Features", &mut shape)
            }
        })?;
        Ok(Features {
            location: location.unwrap_or_default(),
            xform: xform.unwrap_or_default(),
            shape: shape.ok_or_else(|| missing_element("Features", "a shape", position))?,
        })
    }

    /// Reads a `GlobalFiducial`, `LocalFiducial`, `BadBoardMark` or `GoodPanelMark`.
    fn read_fiducial(&mut self, kind: FiducialKind) -> Result<Fiducial, Error> {
        let position = self.tag.position;
        let element = match kind {
            FiducialKind::Global => "GlobalFiducial",
            FiducialKind::Local => "LocalFiducial",
            FiducialKind::BadBoard => "BadBoardMark",
            FiducialKind::GoodPanel => "GoodPanelMark",
        };
        let (mut location, mut xform, mut shape) = (None, None, None);
        self.children(element, |p| {
            if p.placement(element, &mut location, &mut xform)? {
                Ok(())
            } else {
                p.shape_slot(element, &mut shape)
            }
        })?;
        Ok(Fiducial {
            kind,
            location: location.unwrap_or_default(),
            xform: xform.unwrap_or_default(),
            shape: shape.ok_or_else(|| missing_element(element, "a shape", position))?,
        })
    }

    /// Reads a `Hole` or `PadstackHoleDef`.
    fn read_hole(&mut self, element: &'static str) -> Result<Hole, Error> {
        let hole = Hole {
            name: self.req_str("name")?,
            diameter: self.req_len("diameter")?,
            plating: self.req_enum("platingStatus")?,
            plus_tol: self.req_len("plusTol")?,
            minus_tol: self.req_len("minusTol")?,
            position: self.point("x", "y")?,
        };
        self.leaf(element)?;
        Ok(hole)
    }

    fn read_slot_cavity(&mut self) -> Result<SlotCavity, Error> {
        let position = self.tag.position;
        let name = self.req_str("name")?;
        let plating = self.req_enum("platingStatus")?;
        let plus_tol = self.req_len("plusTol")?;
        let minus_tol = self.req_len("minusTol")?;
        let (mut location, mut xform, mut shape) = (None, None, None);
        self.children("SlotCavity", |p| {
            if p.placement("SlotCavity", &mut location, &mut xform)? {
                Ok(())
            } else {
                p.shape_slot("SlotCavity", &mut shape)
            }
        })?;
        Ok(SlotCavity {
            name,
            plating,
            plus_tol,
            minus_tol,
            location: location.unwrap_or_default(),
            xform: xform.unwrap_or_default(),
            shape: shape.ok_or_else(|| missing_element("SlotCavity", "a shape", position))?,
        })
    }
}
