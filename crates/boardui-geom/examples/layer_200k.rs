//! Builds a synthetic copper layer with about 200,000 small features and times each
//! step of the geometry pipeline.
//!
//! Run with `cargo run --release -p boardui-geom --example layer_200k`.
//!
//! The layer is a 316 × 316 grid of cells at 1 mm pitch. Each cell has a pad and a
//! trace to its neighbour; every tenth cell also has a plated via whose antipad clears
//! the copper pours, which cover the board in four quadrants beneath everything.

use boardui_geom::{
    ArcDirection, DVec2, Feature, Hole, HoleCutter, LayerMeshBuilder, LineCap, Path, Polarity,
    Priority, Region, Shape, Stroke, Tolerance, resolve_layer,
};
use std::time::Instant;

const CELLS: usize = 316;
const PITCH: f64 = 1e-3;
const COPPER: (f64, f64) = (0.765e-3, 0.8e-3);
const PLATING: f64 = 25e-6;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let tolerance = Tolerance::DEFAULT;
    let (features, holes) = layer();
    println!(
        "{} features ({} cells), {} plated holes",
        features.len(),
        CELLS * CELLS,
        holes.len()
    );
    let total = Instant::now();

    let start = Instant::now();
    let regions = resolve_layer(&features, tolerance)?;
    report("shapes → regions, polarity, overlaps", start);

    let start = Instant::now();
    let cutter = HoleCutter::new(
        holes
            .iter()
            .map(|hole| hole.cut_region(PLATING, tolerance))
            .collect::<Result<_, _>>()?,
    );
    let regions: Vec<Region> = regions.iter().map(|region| cutter.cut(region)).collect();
    report("hole cutting", start);

    let start = Instant::now();
    let mut builder = LayerMeshBuilder::new();
    for (id, region) in (0u32..).zip(&regions) {
        builder.push(id, &region.extrude(COPPER.0, COPPER.1)?)?;
    }
    let mesh = builder.finish();
    report("extrusion and mesh assembly", start);

    let start = Instant::now();
    let mut barrels = LayerMeshBuilder::new();
    for (id, hole) in (0u32..).zip(&holes) {
        barrels.push(id, &hole.barrel(PLATING, -COPPER.1, COPPER.1, tolerance)?)?;
    }
    let barrels = barrels.finish();
    report("barrels", start);
    report("total", total);

    for (name, mesh) in [("copper", &mesh), ("barrels", &barrels)] {
        let vertices: usize = mesh.primitives.iter().map(|p| p.positions.len()).sum();
        let triangles: usize = mesh.primitives.iter().map(|p| p.indices.len() / 3).sum();
        println!(
            "{name}: {vertices} vertices, {triangles} triangles, {} primitives",
            mesh.primitives.len()
        );
    }
    let empty = regions.iter().filter(|r| r.is_empty()).count();
    println!("{empty} features resolved to empty regions");
    Ok(())
}

fn report(step: &str, start: Instant) {
    println!("{step:>40}: {:>8.3} s", start.elapsed().as_secs_f64());
}

/// The layer's features in document order, and its holes.
fn layer() -> (Vec<Feature>, Vec<Hole>) {
    let size = CELLS as f64 * PITCH;
    let cell = |row: usize, col: usize| DVec2::new(col as f64, row as f64) * PITCH;
    let via = |row: usize, col: usize| (row * CELLS + col).is_multiple_of(10);
    let feature = |shape, priority, polarity| Feature {
        shape,
        priority,
        polarity,
    };
    let mut features = Vec::new();

    // Pours under everything.
    for (x, y) in [(0.0, 0.0), (0.5, 0.0), (0.0, 0.5), (0.5, 0.5)] {
        let (x0, y0) = (x * size - PITCH / 2.0, y * size - PITCH / 2.0);
        features.push(feature(
            rect(x0, y0, x0 + size / 2.0, y0 + size / 2.0),
            Priority::Fill,
            Polarity::Positive,
        ));
    }
    // Antipads clear the pours around vias.
    let mut holes = Vec::new();
    for row in 0..CELLS {
        for col in (0..CELLS).filter(|&col| via(row, col)) {
            let center = cell(row, col) + DVec2::new(0.0, 0.3e-3);
            features.push(feature(
                Shape::Circle {
                    center,
                    radius: 0.3e-3,
                },
                Priority::Other,
                Polarity::Negative,
            ));
            holes.push(Hole::Round {
                center,
                diameter: 0.2e-3,
            });
        }
    }
    // A pad per cell, alternately round and rectangular, and a trace that leaves it with
    // an arc and runs to the next cell.
    for row in 0..CELLS {
        for col in 0..CELLS {
            let c = cell(row, col);
            let pad = if (row + col).is_multiple_of(2) {
                Shape::Circle {
                    center: c,
                    radius: 0.2e-3,
                }
            } else {
                rect(c.x - 0.2e-3, c.y - 0.15e-3, c.x + 0.2e-3, c.y + 0.15e-3)
            };
            features.push(feature(pad, Priority::Pad, Polarity::Positive));
            let path = Path::new(c)
                .arc_to(
                    c + DVec2::new(0.3e-3, 0.3e-3),
                    c + DVec2::new(0.0, 0.3e-3),
                    ArcDirection::CounterClockwise,
                )
                .line_to(c + DVec2::new(PITCH, 0.3e-3));
            features.push(feature(
                Shape::Stroke(Stroke {
                    path,
                    width: 0.12e-3,
                    cap: LineCap::Round,
                }),
                Priority::Trace,
                Polarity::Positive,
            ));
        }
    }
    (features, holes)
}

fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
    Shape::Polygon {
        outline: Path::new(DVec2::new(x0, y0))
            .line_to(DVec2::new(x1, y0))
            .line_to(DVec2::new(x1, y1))
            .line_to(DVec2::new(x0, y1)),
        holes: Vec::new(),
    }
}
