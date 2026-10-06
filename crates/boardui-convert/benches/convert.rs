//! Conversion benchmarks on the largest real samples (`docs/architecture.md`, "Testing").
//!
//! `cargo bench -p boardui-convert`. For the ~200k-feature target, see
//! `examples/synthetic.rs`.

// criterion's macros generate undocumented items.
#![allow(missing_docs)]

use std::path::Path;

use boardui_convert::{Options, convert};
use criterion::{Criterion, criterion_group, criterion_main};

fn bench(c: &mut Criterion) {
    let samples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spec/samples");
    let mut group = c.benchmark_group("convert");
    group.sample_size(10);
    for (name, file) in [
        ("testcase10", "ipc-testcases/testcase10-RevC-Assembly.xml"),
        ("testcase1", "ipc-testcases/testcase1-RevC-Assembly.xml"),
        (
            "kicad-royalblue54l-feather",
            "kicad-royalblue54l-feather/royalblue54l-feather.xml",
        ),
    ] {
        let xml = std::fs::read(samples.join(file)).expect("sample");
        group.bench_function(name, |b| {
            b.iter(|| convert(&xml, &Options::default()).expect("converts"));
        });
    }
    group.finish();
}

criterion_group!(benches, bench);
criterion_main!(benches);
