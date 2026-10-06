//! Component placement, placeholder bodies and user models (spec §6.8, §6.9).

use std::collections::HashMap;

use boardui_geom::{DVec2, Region, Shape, Tolerance};
use boardui_gltf::{
    BodyRef, BuiltinMaterial, ComponentAsset, Model, Mount, PlaceholderBody, Side, Transform,
};
use boardui_ipc2581 as ipc;
use glam::{DAffine2, DMat3, DQuat, DVec3};

use crate::Warnings;
use crate::models::ModelLibrary;
use crate::shapes::{ShapeConverter, placement, point};
use crate::stackup::Stack;

/// Body height used when neither the component nor its package gives one: half the
/// smaller side of the outline, within these bounds.
const DEFAULT_HEIGHT_RANGE: (f64, f64) = (0.2e-3, 2e-3);
/// Thickness of the pin-1 marker on top of the body.
const PIN1_THICKNESS: f64 = 20e-6;
/// Pads farther than this from their package pin count as misplaced.
const PAD_TOLERANCE: f64 = 0.1e-3;

/// A pad that references a component pin, for checking placements.
pub(crate) struct PadRef {
    pub component: String,
    pub pin: String,
    pub location: DVec2,
}

pub(crate) struct Components {
    pub components: Vec<ComponentAsset>,
    pub placeholders: Vec<PlaceholderBody>,
    pub models: Vec<Model>,
    pub pads_checked: usize,
    pub pads_misplaced: usize,
}

pub(crate) fn build(
    step: &ipc::Step,
    stack: &Stack,
    library: Option<&ModelLibrary>,
    shapes: &mut ShapeConverter<'_>,
    pads: &[PadRef],
    warnings: &mut Warnings,
) -> Components {
    let mut out = Components {
        components: Vec::with_capacity(step.components.len()),
        placeholders: Vec::new(),
        models: Vec::new(),
        pads_checked: 0,
        pads_misplaced: 0,
    };
    let mut placeholder_keys: HashMap<(String, u64, u64), Option<usize>> = HashMap::new();
    let mut model_indices: HashMap<usize, usize> = HashMap::new();
    let mut pads_by_component: HashMap<&str, Vec<&PadRef>> = HashMap::new();
    for pad in pads {
        pads_by_component.entry(&pad.component).or_default().push(pad);
    }

    for c in step.components.values() {
        let side = component_side(c, stack);
        let surface = match side {
            Side::Bottom => stack.outer_copper(Side::Bottom).map(|i| stack.layers[i].z_min),
            _ => stack.outer_copper(Side::Top).map(|i| stack.layers[i].z_max),
        }
        .unwrap_or(0.0);
        let at = placement(c.location, &c.xform);
        let package = step.packages.get(&c.package_ref);
        if package.is_none() {
            warnings.push(format!(
                "component `{}` uses undefined package `{}`",
                c.ref_des, c.package_ref
            ));
        }

        // Check the placement convention against the pads (spec §6.8).
        if let (Some(package), Some(pads)) = (package, pads_by_component.get(c.ref_des.as_str())) {
            let mut misplaced = 0;
            for pad in pads {
                let Some(pin) = package.pins.get(&pad.pin) else {
                    continue;
                };
                out.pads_checked += 1;
                let expected = at.transform_point2(point(pin.location));
                if expected.distance(pad.location) > PAD_TOLERANCE {
                    misplaced += 1;
                }
            }
            if misplaced > 0 {
                out.pads_misplaced += misplaced;
                warnings.push(format!(
                    "{misplaced} pads of component `{}` are not at their package pins",
                    c.ref_des
                ));
            }
        }

        let model = library.and_then(|l| l.find(c.part.as_deref(), &c.package_ref));
        let body = if let Some((index, transform)) = model {
            let next = out.models.len();
            let local = *model_indices.entry(index).or_insert(next);
            if local == next {
                let library = library.expect("matched a rule");
                out.models.push(library.models[index].clone());
            }
            Some(BodyRef::Model {
                model: local,
                transform,
            })
        } else if let Some(package) = package {
            let dims = body_range(c, package, shapes);
            match dims {
                Some((standoff, height, outline)) => {
                    let key = (c.package_ref.clone(), standoff.to_bits(), height.to_bits());
                    let index = placeholder_keys.entry(key).or_insert_with(|| {
                        let body = placeholder(package, &outline, standoff, height, shapes)?;
                        out.placeholders.push(body);
                        Some(out.placeholders.len() - 1)
                    });
                    index.map(BodyRef::Placeholder)
                }
                None => None,
            }
        } else {
            None
        };

        out.components.push(ComponentAsset {
            ref_des: c.ref_des.clone(),
            part: c.part.clone().filter(|p| !p.is_empty()),
            package: Some(c.package_ref.clone()),
            side,
            mount: c.mount_type.map(|m| match m {
                ipc::MountType::Smt => Mount::Smt,
                ipc::MountType::Thmt => Mount::Thmt,
                ipc::MountType::Other => Mount::Other,
            }),
            transform: transform(at, side, surface),
            body,
        });
    }
    // Placeholder names must tell variants of one package apart.
    let mut seen: HashMap<String, usize> = HashMap::new();
    for body in &mut out.placeholders {
        let n = seen.entry(body.name.clone()).or_insert(0);
        *n += 1;
        if *n > 1 {
            body.name = format!("{}#{}", body.name, *n);
        }
    }
    out
}

fn component_side(c: &ipc::Component, stack: &Stack) -> Side {
    match stack.index(&c.layer_ref).map(|i| stack.layers[i].side) {
        Some(Side::Bottom) => Side::Bottom,
        Some(_) => Side::Top,
        None if c.xform.mirror => Side::Bottom,
        None => Side::Top,
    }
}

/// The node transform of a component (spec §6.8).
///
/// The package frame (x, y, height) maps to the node frame (x, height, −y). The component's
/// in-plane transform `L` (rotation and, for mirrored components, mirroring about Y) maps
/// node x and z; node y points away from the board on the mounting side. A placement that is
/// a reflection in 3D (a mirrored top-side or unmirrored bottom-side component) gets a
/// negative Y scale.
pub(crate) fn transform(at: DAffine2, side: Side, surface: f64) -> Transform {
    let l = at.matrix2;
    let s = l.determinant().abs().sqrt();
    let up = if side == Side::Bottom { -s } else { s };
    let m = DMat3::from_cols(
        DVec3::new(l.x_axis.x, 0.0, -l.x_axis.y),
        DVec3::new(0.0, up, 0.0),
        DVec3::new(-l.y_axis.x, 0.0, l.y_axis.y),
    );
    let flip = m.determinant() < 0.0;
    let scale = DVec3::new(s, if flip { -s } else { s }, s);
    let rotation = DQuat::from_mat3(&(m * DMat3::from_diagonal(scale.recip()))).normalize();
    Transform {
        translation: [at.translation.x, surface, -at.translation.y],
        rotation: rotation.to_array(),
        scale: scale.to_array(),
    }
}

/// The body's Z range above the seating plane and its outline, or `None` for no body.
fn body_range(
    c: &ipc::Component,
    package: &ipc::Package,
    shapes: &mut ShapeConverter<'_>,
) -> Option<(f64, f64, Region)> {
    let outline = package_outline(package, shapes)?;
    let standoff = c.standoff.filter(|s| s.is_finite() && *s > 0.0).unwrap_or(0.0);
    let height = c.height.or(package.height).filter(|h| h.is_finite() && *h > 0.0);
    let height = match height {
        Some(h) => h,
        // Without a height, only real components (not fiducials, test points, …) get one.
        None if matches!(
            c.mount_type,
            Some(ipc::MountType::Smt | ipc::MountType::Thmt)
        ) =>
        {
            let b = outline.bounds()?;
            let size = b.max - b.min;
            (size.min_element() / 2.0).clamp(DEFAULT_HEIGHT_RANGE.0, DEFAULT_HEIGHT_RANGE.1)
        }
        None => return None,
    };
    let standoff = if standoff < height { standoff } else { 0.0 };
    Some((standoff, height, outline))
}

/// The package outline as a filled region, in the package frame.
fn package_outline(package: &ipc::Package, shapes: &mut ShapeConverter<'_>) -> Option<Region> {
    let outline = package.outline.as_ref()?;
    let shape = shapes.filled(&ipc::Shape::Outline(outline.clone()), DAffine2::IDENTITY)?;
    let region = shape.to_region(Tolerance::DEFAULT).ok()?;
    (!region.is_empty()).then_some(region)
}

fn placeholder(
    package: &ipc::Package,
    outline: &Region,
    standoff: f64,
    height: f64,
    shapes: &mut ShapeConverter<'_>,
) -> Option<PlaceholderBody> {
    let body = outline.extrude(standoff, height).ok()?;
    let mut parts = vec![(BuiltinMaterial::Body, body)];
    if let Some(marker) = pin1_marker(package, outline, shapes) {
        if let Ok(prism) = marker.extrude(height, height + PIN1_THICKNESS) {
            parts.push((BuiltinMaterial::Pin1, prism));
        }
    }
    Some(PlaceholderBody {
        name: package.name.clone(),
        parts,
    })
}

/// A disc on the top face over pin 1, moved towards the body centre until it fits.
fn pin1_marker(
    package: &ipc::Package,
    outline: &Region,
    _shapes: &mut ShapeConverter<'_>,
) -> Option<Region> {
    let pin = package.pins.get(package.pin_one.as_deref()?)?;
    let bounds = outline.bounds()?;
    let size = bounds.max - bounds.min;
    let radius = (size.min_element() * 0.12).clamp(0.1e-3, 0.5e-3);
    let center = (bounds.min + bounds.max) / 2.0;
    let pin = point(pin.location);
    for k in 0..=10 {
        let c = pin + (center - pin) * (f64::from(k) / 10.0);
        let disc = Shape::Circle { center: c, radius }
            .to_region(Tolerance::DEFAULT)
            .ok()?;
        if disc.difference(outline).area() <= disc.area() * 1e-3 {
            return Some(disc);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(t: &Transform, p: DVec3) -> DVec3 {
        let q = DQuat::from_array(t.rotation);
        q * (p * DVec3::from_array(t.scale)) + DVec3::from_array(t.translation)
    }

    /// Board point (x, y) at height z in glTF.
    fn gltf(x: f64, y: f64, z: f64) -> DVec3 {
        DVec3::new(x, z, -y)
    }

    fn assert_close(a: DVec3, b: DVec3) {
        assert!(a.distance(b) < 1e-12, "{a} vs {b}");
    }

    #[test]
    fn top_side_rotates_counter_clockwise() {
        let xform = ipc::Xform {
            rotation: 90.0,
            ..ipc::Xform::default()
        };
        let at = placement(ipc::Point { x: 0.01, y: 0.02 }, &xform);
        let t = transform(at, Side::Top, 0.0008);
        assert_eq!(t.scale, [1.0; 3]);
        // Package point (1, 0) at height 0.5 mm: rotated to (0, 1) in the board.
        let p = apply(&t, DVec3::new(1e-3, 0.5e-3, 0.0));
        assert_close(p, gltf(0.01, 0.021, 0.0013));
    }

    #[test]
    fn bottom_side_mirrors_and_points_down() {
        for rotation in [0.0, 30.0, 90.0, 270.0] {
            let xform = ipc::Xform {
                rotation,
                mirror: true,
                ..ipc::Xform::default()
            };
            let at = placement(ipc::Point { x: 0.01, y: 0.02 }, &xform);
            let t = transform(at, Side::Bottom, -0.0008);
            assert_eq!(t.scale, [1.0; 3], "a proper rotation");
            for (px, py) in [(1e-3, 0.0), (0.0, 1e-3), (2e-3, -1e-3)] {
                // The package's footprint lands where the pads are…
                let pad = at.transform_point2(DVec2::new(px, py));
                let p = apply(&t, DVec3::new(px, 0.0, -py));
                assert_close(p, gltf(pad.x, pad.y, -0.0008));
                // …and its height points away from the board.
                let up = apply(&t, DVec3::new(px, 1e-3, -py));
                assert_close(up, gltf(pad.x, pad.y, -0.0018));
            }
        }
    }

    #[test]
    fn unmirrored_bottom_placement_is_a_reflection() {
        let at = placement(ipc::Point::default(), &ipc::Xform::default());
        let t = transform(at, Side::Bottom, -1.0);
        assert_eq!(t.scale, [1.0, -1.0, 1.0]);
        assert_close(apply(&t, DVec3::new(1.0, 1.0, 0.0)), gltf(1.0, 0.0, -2.0));
    }
}
