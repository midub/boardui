//! The conversion pipeline (`docs/architecture.md`, "Pipeline").

use std::collections::{HashMap, HashSet};

use boardui_geom::{
    self as geom, Bounds, DVec2, HoleCutter, LayerMesh, LayerMeshBuilder, Polarity, Priority,
    Region, Shape, Tolerance, par,
};
use boardui_gltf::{
    BoardAsset, DrillAsset, FeatureKind, FeatureRow, Fiducial, LayerAsset, PinRow, Role, Side,
    Source,
};
use boardui_ipc2581 as ipc;
use glam::DAffine2;

use crate::colours;
use crate::components::{self, PadRef};
use crate::shapes::{ShapeConverter, erases, is_stroke, point};
use crate::stackup::{self, LayerClass, Stack, Synthesize};
use crate::{Conversion, ConvertError, Options, Stats, Timings, Warning, Warnings};

/// A layer's source features, ready for `boardui-geom`.
#[derive(Default)]
struct Features {
    rows: Vec<FeatureRow>,
    shapes: Vec<geom::Feature>,
}

/// A hole of a drill layer.
struct DrillHole {
    hole: geom::Hole,
    plated: bool,
}

struct Drill {
    name: String,
    /// Stack indices of the span's upper and lower copper layer.
    from: usize,
    to: usize,
    rows: Vec<FeatureRow>,
    holes: Vec<Option<DrillHole>>,
}

pub(crate) fn run(
    doc: &ipc::Document,
    sha256: &str,
    options: &Options,
    timings: Timings<'_>,
) -> Result<Conversion, ConvertError> {
    let tolerance = Tolerance::new(options.tolerance)
        .map_err(|e| ConvertError::Input(format!("invalid tolerance: {e}")))?;
    let plating = options.plating_thickness;
    if !(plating.is_finite() && plating > 0.0) {
        return Err(ConvertError::Input(format!(
            "invalid plating thickness {plating}"
        )));
    }
    let mut warnings = Warnings::default();
    let features_step = timings.step("stack-up, features, components");
    let step = select_step(doc, options)?;
    let mut stack = stackup::build(&doc.ecad, &mut warnings).map_err(ConvertError::Input)?;
    let synthesize = package_layers(&doc.ecad, step, &stack);
    stackup::add_optional(&mut stack, &doc.ecad, step, synthesize, &mut warnings);
    let colours = colours::resolve(doc, &stack, &mut warnings);
    if doc
        .ecad
        .layers
        .values()
        .any(|l| l.polarity == ipc::Polarity::Negative)
    {
        warnings.push("negative layers are drawn as positive");
    }

    let nets: Vec<String> = step.nets().into_iter().map(str::to_owned).collect();
    let net_rows: HashMap<&str, u32> = nets
        .iter()
        .enumerate()
        .map(|(i, n)| (n.as_str(), i as u32))
        .collect();
    let component_rows: HashMap<&str, u32> = step
        .components
        .values()
        .enumerate()
        .map(|(i, c)| (c.ref_des.as_str(), i as u32))
        .collect();
    let pads = pads(step, &stack);
    let order = components::detect_mirror_order(step, &pads);
    tracing::debug!("mirror order: {order:?}");
    let mut ctx = Context {
        content: &doc.content,
        step,
        shapes: ShapeConverter::new(&doc.content, tolerance, order),
        net_rows,
        component_rows,
        pins: Vec::new(),
        pin_rows: HashMap::new(),
        tolerance,
        warnings: &mut warnings,
    };

    // Source features of every layer, in document order. The optional layers come last, so
    // that the pins table keeps the order of the physical layers' references.
    let mut layer_features: Vec<Features> = Vec::new();
    layer_features.resize_with(stack.layers.len(), Features::default);
    let mut order: Vec<usize> = (0..stack.layers.len()).collect();
    order.sort_by_key(|&i| stack.layers[i].role.is_optional());
    for i in order {
        let layer = &stack.layers[i];
        let source = (!layer.synthesized)
            .then(|| step.layer_features.get(&layer.name))
            .flatten();
        layer_features[i] = match (layer.role, source) {
            (Role::Dielectric, Some(lf)) if lf.feature_count() > 0 => {
                ctx.warnings.push(format!(
                    "features on dielectric layer `{}` were skipped",
                    layer.name
                ));
                Features::default()
            }
            (role, Some(lf)) if role != Role::Dielectric => ctx.features(lf, role),
            _ => Features::default(),
        };
    }
    ctx.package_drawings(&stack, &mut layer_features);
    let mut skipped = Vec::new();
    for (name, lf) in step.layer_features.iter() {
        // Optional layers that were left out have been reported already.
        let known =
            stack.index(name).is_some()
                || doc.ecad.layers.get(name).is_some_and(|l| {
                    match stackup::classify(&l.function) {
                        LayerClass::Drill => true,
                        LayerClass::Layer(role) => role.is_optional(),
                        LayerClass::Ignored => false,
                    }
                });
        if !known && lf.feature_count() > 0 {
            let function = doc
                .ecad
                .layers
                .get(name)
                .map_or("?", |l| l.function.as_str());
            skipped.push(format!("{name} ({function})"));
        }
    }
    if !skipped.is_empty() {
        ctx.warnings.push(format!(
            "layers outside the profile's scope were not converted: {}",
            skipped.join(", ")
        ));
    }
    let drills = ctx.drills(doc, &stack);
    let components = components::build(
        step,
        &stack,
        options.models.as_ref(),
        &mut ctx.shapes,
        &pads,
        ctx.warnings,
    );
    let outline_shape = step
        .profile
        .as_ref()
        .and_then(|p| ctx.shapes.contour(p, DAffine2::IDENTITY));
    let pins = std::mem::take(&mut ctx.pins);
    for message in std::mem::take(&mut ctx.shapes.warnings) {
        ctx.warnings.push(message);
    }
    drop(ctx);
    drop(features_step);

    // Overlap resolution, in parallel over layers.
    let resolved: Vec<(Vec<Region>, Vec<String>)> = {
        let _step = timings.step("resolve");
        par::map(&layer_features, |i, features| {
            resolve(&stack.layers[i].name, &features.shapes, tolerance)
        })
    };
    let mut regions = Vec::with_capacity(resolved.len());
    for (r, messages) in resolved {
        regions.push(r);
        messages.into_iter().for_each(|m| warnings.push(m));
    }

    // Holes.
    let hole_list: Vec<(usize, usize)> = drills
        .iter()
        .enumerate()
        .flat_map(|(d, drill)| (0..drill.holes.len()).map(move |h| (d, h)))
        .filter(|&(d, h)| drills[d].holes[h].is_some())
        .collect();
    let cuts: Vec<Option<Region>> = {
        let _step = timings.step("hole cuts");
        par::map(&hole_list, |_, &(d, h)| {
            let hole = drills[d].holes[h].as_ref().expect("filtered");
            let clearance = if hole.plated { plating } else { 0.0 };
            hole.hole.cut_region(clearance, tolerance).ok()
        })
    };
    let copper = stack.copper();
    let (first, last) = (copper[0], *copper.last().expect("copper"));
    let through = |layer: usize, drill: &Drill| {
        (drill.from..=drill.to).contains(&layer)
            || (layer < first && drill.from == first)
            || (layer > last && drill.to == last)
    };
    let layer_cuts = |layer: usize| -> Vec<Region> {
        hole_list
            .iter()
            .zip(&cuts)
            .filter(|((d, _), _)| through(layer, &drills[*d]))
            .filter_map(|(_, cut)| cut.clone())
            .collect()
    };

    // Board outline and soldermask openings.
    let outline = match outline_shape.and_then(|s| s.to_region(tolerance).ok()) {
        Some(region) if !region.is_empty() => region,
        _ => {
            warnings
                .push("the step has no usable profile; the outline is the copper's bounding box");
            bounding_outline(&stack, &regions)
        }
    };
    let openings = |side: Side| -> Vec<Region> {
        let mask = stack
            .layers
            .iter()
            .position(|l| l.role == Role::Soldermask && l.side == side);
        match mask {
            Some(m) if !stack.layers[m].synthesized => regions[m]
                .iter()
                .filter(|r| !r.is_empty())
                .cloned()
                .collect(),
            _ => match stack.outer_copper(side) {
                Some(c) => layer_features[c]
                    .rows
                    .iter()
                    .zip(&regions[c])
                    .filter(|(row, r)| {
                        matches!(row.kind, FeatureKind::Pad | FeatureKind::Fiducial)
                            && !r.is_empty()
                    })
                    .map(|(_, r)| r.clone())
                    .collect(),
                None => Vec::new(),
            },
        }
    };
    let side_openings = [openings(Side::Top), openings(Side::Bottom)];

    // Final regions per layer: holes cut, sheets built, silkscreen clipped.
    let finals: Vec<(Vec<FeatureRow>, Vec<Region>)> = {
        let _step = timings.step("cut and sheets");
        let indices: Vec<usize> = (0..stack.layers.len()).collect();
        let mut rows: Vec<Option<Vec<FeatureRow>>> =
            layer_features.into_iter().map(|f| Some(f.rows)).collect();
        let results = par::map(&indices, |_, &i| {
            let layer = &stack.layers[i];
            let holes = layer_cuts(i);
            let side = (layer.side == Side::Bottom) as usize;
            match layer.role {
                Role::Copper | Role::Paste => {
                    let cutter = HoleCutter::new(holes);
                    let cut: Vec<Region> = regions[i].iter().map(|r| cutter.cut(r)).collect();
                    (None, cut)
                }
                // Drawings are neither cut nor clipped (spec §6.12).
                Role::Courtyard | Role::Assembly | Role::Documentation => {
                    (None, regions[i].clone())
                }
                Role::Silkscreen => {
                    let mut clip = holes;
                    clip.extend(side_openings[side].iter().cloned());
                    let cutter = HoleCutter::new(clip);
                    let cut: Vec<Region> = regions[i].iter().map(|r| cutter.cut(r)).collect();
                    (None, cut)
                }
                Role::Soldermask => {
                    let mut clip = holes;
                    clip.extend(side_openings[side].iter().cloned());
                    let sheet = outline.difference(&Region::union_all(&clip));
                    (Some(sheet_row()), vec![sheet])
                }
                Role::Dielectric => {
                    let sheet = outline.difference(&Region::union_all(&holes));
                    (Some(sheet_row()), vec![sheet])
                }
            }
        });
        results
            .into_iter()
            .enumerate()
            .map(|(i, (sheet, regions))| {
                let rows = match sheet {
                    Some(row) => vec![row],
                    None => rows[i].take().expect("rows"),
                };
                (rows, regions)
            })
            .collect()
    };

    // Extrusion and mesh assembly, in parallel over layers and features.
    let mut layers = Vec::with_capacity(stack.layers.len());
    {
        let _step = timings.step("extrude");
        let meshes = par::map(&finals, |i, (_, regions)| {
            let layer = &stack.layers[i];
            extrude(&layer.name, regions, layer.z_min, layer.z_max)
        });
        let sources = stack.layers.iter().zip(colours);
        for (((layer, color), (rows, _)), (mesh, messages)) in sources.zip(finals).zip(meshes) {
            messages.into_iter().for_each(|m| warnings.push(m));
            layers.push(LayerAsset {
                name: layer.name.clone(),
                role: layer.role,
                ipc_function: layer.ipc_function.clone(),
                side: layer.side,
                z_min: layer.z_min,
                z_max: layer.z_max,
                thickness_source: layer.thickness_source,
                synthesized: layer.synthesized,
                visible: layer.visible(),
                color,
                mesh,
                features: rows,
            });
        }
    }
    let drill_assets: Vec<DrillAsset> = {
        let _step = timings.step("barrels");
        drills
            .into_iter()
            .map(|drill| {
                let (top, bottom) = (&stack.layers[drill.from], &stack.layers[drill.to]);
                let prisms = par::map(&drill.holes, |_, hole| match hole {
                    Some(h) if h.plated => h
                        .hole
                        .barrel(plating, bottom.z_min, top.z_max, tolerance)
                        .map_err(|e| e.to_string()),
                    _ => Ok(geom::Prism::default()),
                });
                let (mesh, messages) = assemble(&drill.name, prisms);
                messages.into_iter().for_each(|m| warnings.push(m));
                DrillAsset {
                    name: drill.name,
                    from: top.name.clone(),
                    to: bottom.name.clone(),
                    mesh,
                    features: drill.rows,
                }
            })
            .collect()
    };

    let mut stats = Stats {
        layers: layers.len(),
        drills: drill_assets.len(),
        components: components.components.len(),
        nets: nets.len(),
        pins: pins.len(),
        pins_checked: components.pins_checked,
        pins_misplaced: components.pins_misplaced,
        ..Stats::default()
    };
    let meshes = layers
        .iter()
        .map(|l| (&l.mesh, l.features.len()))
        .chain(drill_assets.iter().map(|d| (&d.mesh, d.features.len())));
    for (mesh, rows) in meshes {
        stats.features += rows;
        for p in &mesh.primitives {
            stats.vertices += p.positions.len();
            stats.triangles += p.indices.len() / 3;
        }
    }

    let asset = BoardAsset {
        generator: options.generator.clone(),
        source: Source {
            format: "IPC-2581".into(),
            revision: Some(doc.revision.clone()),
            step: Some(step.name.clone()),
            function_mode: doc.content.function_mode.clone(),
            sha256: sha256.to_owned(),
        },
        tolerance: tolerance.metres(),
        plating_thickness: plating,
        thickness: stack.thickness,
        layers,
        drills: drill_assets,
        nets,
        components: components.components,
        pins,
        placeholders: components.placeholders,
        models: components.models,
    };
    let glb = {
        let _step = timings.step("write");
        asset.to_glb()
    };

    let mut all: Vec<Warning> = doc
        .diagnostics
        .iter()
        .filter(|d| !colours::is_recovered_spec_ref(&doc.ecad, &d.kind))
        .map(|d| Warning {
            message: d.kind.to_string(),
            position: Some(d.position),
            occurrences: d.occurrences,
        })
        .collect();
    all.extend(warnings.into_vec());
    Ok(Conversion {
        glb,
        warnings: all,
        stats,
        timings: timings.into_vec(),
    })
}

/// Pads on copper layers that reference a component pin.
fn pads(step: &ipc::Step, stack: &Stack) -> Vec<PadRef> {
    let mut pads = Vec::new();
    for i in stack.copper() {
        let Some(lf) = step.layer_features.get(&stack.layers[i].name) else {
            continue;
        };
        for (set, feature) in lf.features() {
            let ipc::FeatureElement::Pad(pad) = &feature.element else {
                continue;
            };
            for pin_ref in &pad.pin_refs {
                if let Some(component) = pin_ref
                    .component_ref
                    .as_ref()
                    .or(set.component_ref.as_ref())
                {
                    pads.push(PadRef {
                        component: component.clone(),
                        pin: pin_ref.pin.clone(),
                        location: point(pad.location),
                    });
                }
            }
        }
    }
    pads
}

fn select_step<'a>(
    doc: &'a ipc::Document,
    options: &Options,
) -> Result<&'a ipc::Step, ConvertError> {
    let steps = &doc.ecad.steps;
    match &options.step {
        Some(name) => steps
            .get(name)
            .ok_or_else(|| ConvertError::Input(format!("the file has no step `{name}`"))),
        None => doc
            .content
            .step_refs
            .iter()
            .find_map(|name| steps.get(name))
            .or_else(|| steps.values().next())
            .ok_or_else(|| ConvertError::Input("the file has no step".into())),
    }
}

/// The synthesized layers that package drawings need (spec §6.13): per side, a silkscreen
/// layer if the side has none and one of its components' packages has a silkscreen, and an
/// assembly layer if the side has no assembly layer with features and one of its
/// components' packages has an assembly drawing.
fn package_layers(ecad: &ipc::Ecad, step: &ipc::Step, stack: &Stack) -> Synthesize {
    let mut out = Synthesize::default();
    let drawn = |d: &Option<ipc::PackageDrawing>| {
        d.as_ref()
            .is_some_and(|d| !d.outlines.is_empty() || !d.markings.is_empty())
    };
    for c in step.components.values() {
        let Some(package) = step.packages.get(&c.package_ref) else {
            continue;
        };
        let k = (components::component_side(c, stack) == Side::Bottom) as usize;
        out.silkscreen[k] |= drawn(&package.silkscreen);
        out.assembly[k] |= drawn(&package.assembly_drawing);
    }
    for (k, side) in [Side::Top, Side::Bottom].into_iter().enumerate() {
        if stack
            .layers
            .iter()
            .any(|l| l.role == Role::Silkscreen && l.side == side)
        {
            out.silkscreen[k] = false;
        }
    }
    for layer in ecad.layers.values() {
        if stackup::classify(&layer.function) == LayerClass::Layer(Role::Assembly)
            && stackup::has_features(step, &layer.name)
        {
            out.assembly[(stackup::optional_side(layer) == Side::Bottom) as usize] = false;
        }
    }
    out
}

/// A package silkscreen counts as present on the silkscreen layer when the layer's
/// features cover at least this share of its area (spec §6.13).
const SILKSCREEN_COVERED: f64 = 0.1;

/// Adds package drawing shapes to a layer as `MARKING` features of `component`, numbered on
/// from the layer's last feature.
fn push_drawing(out: &mut Features, shapes: Vec<Option<Shape>>, component: u32) {
    for shape in shapes {
        let source = out.rows.last().map_or(0, |r| r.source + 1);
        out.rows.push(FeatureRow {
            kind: FeatureKind::Marking,
            source,
            net: None,
            pin: None,
            component: Some(component),
            fiducial: None,
        });
        out.shapes.push(geom::Feature {
            shape: shape.unwrap_or(Shape::Union(Vec::new())),
            priority: Priority::Other,
            polarity: Polarity::Positive,
        });
    }
}

/// The regions of a layer's positive features, with their bounds.
fn regions_with_bounds(features: &Features, tolerance: Tolerance) -> Vec<(Region, Bounds)> {
    features
        .shapes
        .iter()
        .filter(|f| f.polarity == Polarity::Positive)
        .filter_map(|f| f.shape.to_region(tolerance).ok())
        .filter_map(|r| r.bounds().map(|b| (r, b)))
        .collect()
}

/// Whether a layer's regions cover at least [`SILKSCREEN_COVERED`] of a drawing's area. A
/// drawing without area counts as covered: it would draw nothing.
fn covers(layer: &[(Region, Bounds)], shapes: &[Option<Shape>], tolerance: Tolerance) -> bool {
    let parts: Vec<Region> = shapes
        .iter()
        .flatten()
        .filter_map(|s| s.to_region(tolerance).ok())
        .collect();
    let drawing = Region::union_all(&parts);
    let (Some(b), area) = (drawing.bounds(), drawing.area()) else {
        return true;
    };
    let near = layer.iter().filter(|(_, r)| {
        r.min.x <= b.max.x && r.max.x >= b.min.x && r.min.y <= b.max.y && r.max.y >= b.min.y
    });
    let near = Region::union_all(near.map(|(r, _)| r));
    drawing.intersection(&near).area() >= SILKSCREEN_COVERED * area
}

fn sheet_row() -> FeatureRow {
    FeatureRow {
        kind: FeatureKind::Sheet,
        source: 0,
        net: None,
        pin: None,
        component: None,
        fiducial: None,
    }
}

/// Resolves a layer's features (spec §6.2). A feature whose shape is invalid is dropped
/// with a warning and the layer is resolved again.
fn resolve(
    layer: &str,
    features: &[geom::Feature],
    tolerance: Tolerance,
) -> (Vec<Region>, Vec<String>) {
    let mut features = std::borrow::Cow::Borrowed(features);
    let mut messages = Vec::new();
    loop {
        match geom::resolve_layer(&features, tolerance) {
            Ok(regions) => return (regions, messages),
            Err(e) => {
                messages.push(format!(
                    "feature {} of layer `{layer}` has invalid geometry ({}) and was dropped",
                    e.index, e.error
                ));
                features.to_mut()[e.index].shape = Shape::Union(Vec::new());
            }
        }
    }
}

/// Extrudes a layer's regions and assembles its mesh; also returns warnings.
fn extrude(layer: &str, regions: &[Region], z_min: f64, z_max: f64) -> (LayerMesh, Vec<String>) {
    let prisms = par::map(regions, |_, r| {
        r.extrude(z_min, z_max).map_err(|e| e.to_string())
    });
    assemble(layer, prisms)
}

fn assemble(layer: &str, prisms: Vec<Result<geom::Prism, String>>) -> (LayerMesh, Vec<String>) {
    let mut builder = LayerMeshBuilder::new();
    let mut messages = Vec::new();
    for (id, prism) in prisms.into_iter().enumerate() {
        let prism = prism.unwrap_or_else(|e| {
            messages.push(format!(
                "feature {id} of layer `{layer}` can't be meshed ({e})"
            ));
            geom::Prism::default()
        });
        builder.push(id as u32, &prism).expect("feature IDs ascend");
    }
    (builder.finish(), messages)
}

/// A rectangle 1 mm around everything on the copper layers, for boards without a profile.
fn bounding_outline(stack: &Stack, regions: &[Vec<Region>]) -> Region {
    let mut min = DVec2::splat(f64::INFINITY);
    let mut max = DVec2::splat(f64::NEG_INFINITY);
    for i in stack.copper() {
        for b in regions[i].iter().filter_map(Region::bounds) {
            min = min.min(b.min);
            max = max.max(b.max);
        }
    }
    if !min.is_finite() {
        return Region::empty();
    }
    let (min, max) = (min - DVec2::splat(1e-3), max + DVec2::splat(1e-3));
    Shape::Polygon {
        outline: geom::Path::new(min)
            .line_to(DVec2::new(max.x, min.y))
            .line_to(max)
            .line_to(DVec2::new(min.x, max.y)),
        holes: Vec::new(),
    }
    .to_region(Tolerance::DEFAULT)
    .unwrap_or_default()
}

struct Context<'a> {
    content: &'a ipc::Content,
    step: &'a ipc::Step,
    shapes: ShapeConverter<'a>,
    net_rows: HashMap<&'a str, u32>,
    component_rows: HashMap<&'a str, u32>,
    pins: Vec<PinRow>,
    pin_rows: HashMap<(u32, String), u32>,
    tolerance: Tolerance,
    warnings: &'a mut Warnings,
}

impl<'a> Context<'a> {
    /// The features of a copper, silkscreen or soldermask layer.
    fn features(&mut self, lf: &ipc::LayerFeature, role: Role) -> Features {
        let mut out = Features::default();
        for (set, feature) in lf.features() {
            let net = set
                .net
                .as_deref()
                .and_then(|n| self.net_rows.get(n))
                .copied();
            let mut polarity = set.polarity;
            let mut fiducial = None;
            let (kind, shape, pin_ref) = match &feature.element {
                ipc::FeatureElement::Pad(pad) => {
                    let kind = match set.pad_usage {
                        Some(ipc::PadUsage::Via) => FeatureKind::Via,
                        _ => FeatureKind::Pad,
                    };
                    let shape = self.pad_shape(pad, &lf.layer_ref);
                    (kind, shape, pad.pin_refs.first())
                }
                ipc::FeatureElement::Features(f) => {
                    let at = self.shapes.placement(f.location, &f.xform);
                    let shape = self.shapes.area(&f.shape, at);
                    if erases(&f.shape, self.content) {
                        polarity = ipc::Polarity::Negative;
                    }
                    let kind = if is_stroke(&f.shape, self.content) {
                        FeatureKind::Trace
                    } else {
                        match set.pad_usage {
                            Some(ipc::PadUsage::Termination) => FeatureKind::Pad,
                            Some(ipc::PadUsage::Via) => FeatureKind::Via,
                            _ if is_fill(&f.shape, self.content) => FeatureKind::Fill,
                            _ => FeatureKind::Other,
                        }
                    };
                    (kind, shape, None)
                }
                ipc::FeatureElement::Fiducial(f) => {
                    let at = self.shapes.placement(f.location, &f.xform);
                    fiducial = Some(match f.kind {
                        ipc::FiducialKind::Global => Fiducial::Global,
                        ipc::FiducialKind::Local => Fiducial::Local,
                        ipc::FiducialKind::BadBoard => Fiducial::BadBoard,
                        ipc::FiducialKind::GoodPanel => Fiducial::GoodPanel,
                    });
                    (FeatureKind::Fiducial, self.shapes.area(&f.shape, at), None)
                }
                ipc::FeatureElement::Hole(_) | ipc::FeatureElement::SlotCavity(_) => {
                    (FeatureKind::Other, None, None)
                }
            };
            let kind = if role == Role::Silkscreen || role.is_drawing() {
                FeatureKind::Marking
            } else {
                kind
            };
            let component_ref = pin_ref
                .and_then(|p| p.component_ref.as_ref())
                .or(set.component_ref.as_ref());
            let component =
                component_ref.and_then(|c| self.component_rows.get(c.as_str()).copied());
            let pin = match (pin_ref, component, component_ref) {
                (Some(p), Some(row), Some(ref_des)) => {
                    Some(self.pin_row(row, ref_des, &p.pin, p.title.as_deref(), net))
                }
                _ => None,
            };
            out.rows.push(FeatureRow {
                kind,
                source: feature.source as u32,
                net,
                pin,
                component,
                fiducial: fiducial.filter(|_| kind == FeatureKind::Fiducial),
            });
            out.shapes.push(geom::Feature {
                shape: shape.unwrap_or(Shape::Union(Vec::new())),
                priority: match kind {
                    FeatureKind::Pad | FeatureKind::Fiducial => Priority::Pad,
                    FeatureKind::Via => Priority::ViaLand,
                    FeatureKind::Trace => Priority::Trace,
                    FeatureKind::Fill => Priority::Fill,
                    _ => Priority::Other,
                },
                polarity: match polarity {
                    ipc::Polarity::Positive => Polarity::Positive,
                    ipc::Polarity::Negative => Polarity::Negative,
                },
            });
        }
        out
    }

    /// Adds the features of package drawings (spec §6.13): assembly drawings to the
    /// synthesized assembly layer of the component's side, and silkscreens to the side's
    /// silkscreen layer where it has nothing for the component.
    fn package_drawings(&mut self, stack: &Stack, layer_features: &mut [Features]) {
        let layer_of = |role: Role, side: Side, synthesized: bool| {
            stack
                .layers
                .iter()
                .position(|l| l.role == role && l.side == side && (!synthesized || l.synthesized))
        };
        // A source silkscreen layer's own features: the components they reference, and
        // their regions (computed when first needed).
        let mut referenced: HashMap<usize, HashSet<u32>> = HashMap::new();
        let mut silk_regions: HashMap<usize, Vec<(Region, Bounds)>> = HashMap::new();
        for side in [Side::Top, Side::Bottom] {
            if let Some(i) = layer_of(Role::Silkscreen, side, false) {
                let rows = layer_features[i].rows.iter().filter_map(|r| r.component);
                referenced.insert(i, rows.collect());
            }
        }
        for c in self.step.components.values() {
            let Some(package) = self.step.packages.get(&c.package_ref) else {
                continue;
            };
            let Some(&row) = self.component_rows.get(c.ref_des.as_str()) else {
                continue;
            };
            let side = components::component_side(c, stack);
            let at = self.shapes.placement(c.location, &c.xform);
            if let (Some(drawing), Some(i)) = (
                &package.assembly_drawing,
                layer_of(Role::Assembly, side, true),
            ) {
                let shapes = self.drawing_shapes(drawing, at);
                push_drawing(&mut layer_features[i], shapes, row);
            }
            if let (Some(drawing), Some(i)) =
                (&package.silkscreen, layer_of(Role::Silkscreen, side, false))
            {
                let shapes = self.drawing_shapes(drawing, at);
                let draw = stack.layers[i].synthesized
                    || !referenced.get(&i).is_some_and(|r| r.contains(&row)) && {
                        let layer = silk_regions.entry(i).or_insert_with(|| {
                            regions_with_bounds(&layer_features[i], self.tolerance)
                        });
                        !covers(layer, &shapes, self.tolerance)
                    };
                if draw {
                    push_drawing(&mut layer_features[i], shapes, row);
                }
            }
        }
    }

    /// The `Outline`s and then the `Marking`s of a package drawing, placed at `at`.
    fn drawing_shapes(
        &mut self,
        drawing: &ipc::PackageDrawing,
        at: DAffine2,
    ) -> Vec<Option<Shape>> {
        let mut shapes = Vec::new();
        for outline in &drawing.outlines {
            shapes.push(self.shapes.drawing_outline(outline, at));
        }
        for marking in &drawing.markings {
            let inner = self.shapes.placement(marking.location, &marking.xform);
            shapes.push(self.shapes.area(&marking.shape, at * inner));
        }
        shapes
    }

    /// A pad's shape: its own, or its padstack's regular pad on this layer.
    fn pad_shape(&mut self, pad: &ipc::Pad, layer: &str) -> Option<Shape> {
        let at = self.shapes.placement(pad.location, &pad.xform);
        if let Some(shape) = &pad.shape {
            return self.shapes.area(shape, at);
        }
        let def = self
            .step
            .padstack_defs
            .get(pad.padstack_def_ref.as_deref()?)?;
        let pp = def
            .pads
            .iter()
            .find(|p| p.layer_ref == layer && p.pad_use == ipc::PadUse::Regular)?;
        let shape = pp.shape.as_ref()?;
        let inner = self.shapes.placement(pp.location, &pp.xform);
        self.shapes.area(shape, at * inner)
    }

    fn pin_row(
        &mut self,
        component: u32,
        ref_des: &str,
        number: &str,
        title: Option<&str>,
        net: Option<u32>,
    ) -> u32 {
        if let Some(&row) = self.pin_rows.get(&(component, number.to_owned())) {
            let pin = &mut self.pins[row as usize];
            pin.net = pin.net.or(net);
            return row;
        }
        let name = self
            .step
            .components
            .get(ref_des)
            .and_then(|c| self.step.packages.get(&c.package_ref))
            .and_then(|p| p.pins.get(number))
            .and_then(|p| p.name.clone())
            .or_else(|| title.map(str::to_owned));
        let row = self.pins.len() as u32;
        self.pins.push(PinRow {
            number: number.to_owned(),
            name,
            component,
            net,
        });
        self.pin_rows.insert((component, number.to_owned()), row);
        row
    }

    /// Drill and rout layers with their holes and slots (spec §6.3).
    fn drills(&mut self, doc: &ipc::Document, stack: &Stack) -> Vec<Drill> {
        let copper = stack.copper();
        let (first, last) = (copper[0], *copper.last().expect("copper"));
        let mut drills = Vec::new();
        for layer in doc.ecad.layers.values() {
            if stackup::classify(&layer.function) != LayerClass::Drill {
                continue;
            }
            let Some(lf) = self.step.layer_features.get(&layer.name) else {
                continue;
            };
            let span = layer.span.as_ref().and_then(|span| {
                let a = stack.index(&span.from_layer)?;
                let b = stack.index(&span.to_layer)?;
                let ok =
                    stack.layers[a].role == Role::Copper && stack.layers[b].role == Role::Copper;
                ok.then(|| (a.min(b), a.max(b)))
            });
            if layer.span.is_some() && span.is_none() {
                self.warnings.push(format!(
                    "the span of drill layer `{}` doesn't name copper layers; it runs through the board",
                    layer.name
                ));
            }
            let (from, to) = span.unwrap_or((first, last));
            let mut rows = Vec::new();
            let mut holes = Vec::new();
            for (set, feature) in lf.features() {
                let net = set
                    .net
                    .as_deref()
                    .and_then(|n| self.net_rows.get(n))
                    .copied();
                let component = set
                    .component_ref
                    .as_deref()
                    .and_then(|c| self.component_rows.get(c))
                    .copied();
                let hole = match &feature.element {
                    ipc::FeatureElement::Hole(h) => Some(DrillHole {
                        hole: geom::Hole::Round {
                            center: point(h.position),
                            diameter: h.diameter,
                        },
                        plated: h.plating != ipc::PlatingStatus::NonPlated,
                    }),
                    ipc::FeatureElement::SlotCavity(slot) => self
                        .shapes
                        .filled(
                            &slot.shape,
                            self.shapes.placement(slot.location, &slot.xform),
                        )
                        .map(|shape| DrillHole {
                            hole: geom::Hole::Slot(shape),
                            plated: slot.plating != ipc::PlatingStatus::NonPlated,
                        }),
                    _ => None,
                };
                let kind = match &hole {
                    Some(h) if h.plated => FeatureKind::Barrel,
                    _ => FeatureKind::Other,
                };
                rows.push(FeatureRow {
                    kind,
                    source: feature.source as u32,
                    net,
                    pin: None,
                    component,
                    fiducial: None,
                });
                holes.push(hole);
            }
            drills.push(Drill {
                name: layer.name.clone(),
                from,
                to,
                rows,
                holes,
            });
        }
        drills
    }
}

/// Whether a shape is a filled area (contour, polygon): a fill in the sense of spec §6.2.
fn is_fill(shape: &ipc::Shape, content: &ipc::Content) -> bool {
    match shape {
        ipc::Shape::Polygon(_) => true,
        ipc::Shape::Standard(p) => matches!(p.kind, ipc::PrimitiveKind::Contour(_)),
        ipc::Shape::StandardRef(id) => content
            .standard_primitives
            .get(id)
            .is_some_and(|p| matches!(p.kind, ipc::PrimitiveKind::Contour(_))),
        ipc::Shape::UserSpecial(shapes) => {
            !shapes.is_empty() && shapes.iter().all(|s| is_fill(s, content))
        }
        ipc::Shape::UserRef(id) => content
            .user_primitives
            .get(id)
            .is_some_and(|s| matches!(s, ipc::Shape::UserSpecial(_)) && is_fill(s, content)),
        _ => false,
    }
}
