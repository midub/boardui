//! Parses an IPC-2581 file and prints a summary, the parse time and the peak memory use.
//!
//! ```text
//! cargo run --release -p boardui-ipc2581 --example parse -- spec/samples/ipc-testcases/testcase1-RevC-Assembly.xml
//! ```

use std::fs::File;
use std::io::BufReader;
use std::process::ExitCode;
use std::time::Instant;

fn main() -> ExitCode {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: parse <file.xml>");
        return ExitCode::FAILURE;
    };
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(e) => {
            eprintln!("{path}: {e}");
            return ExitCode::FAILURE;
        }
    };
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start = Instant::now();
    let doc = match boardui_ipc2581::parse(BufReader::new(file)) {
        Ok(doc) => doc,
        Err(e) => {
            eprintln!("{path}: {e}");
            return ExitCode::FAILURE;
        }
    };
    let elapsed = start.elapsed();

    println!("{path}: {:.1} MB", size as f64 / 1e6);
    println!(
        "revision {}, units {:?}, {} layers, {} steps",
        doc.revision,
        doc.ecad.units,
        doc.ecad.layers.len(),
        doc.ecad.steps.len()
    );
    for step in doc.ecad.steps.values() {
        println!(
            "step {}: {} packages, {} components, {} padstacks, {} nets",
            step.name,
            step.packages.len(),
            step.components.len(),
            step.padstack_defs.len(),
            step.nets().len()
        );
        for lf in step.layer_features.values() {
            println!("  {}: {} features", lf.layer_ref, lf.feature_count());
        }
    }
    println!("{} diagnostics", doc.diagnostics.len());
    for d in &doc.diagnostics {
        println!("  {d}");
    }
    println!("parsed in {:.0} ms", elapsed.as_secs_f64() * 1e3);
    // Peak resident memory of the whole process, where the OS reports it.
    if let Ok(status) = std::fs::read_to_string("/proc/self/status")
        && let Some(line) = status.lines().find(|l| l.starts_with("VmHWM"))
    {
        println!("peak memory {}", line.trim_start_matches("VmHWM:").trim());
    }
    ExitCode::SUCCESS
}
