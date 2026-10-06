//! Progress events of `convert_with_progress`.

use boardui_convert::{Options, Progress, STEPS, convert_with_progress};

#[test]
fn every_step_starts_and_ends_in_order() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../spec/samples/hand-written/minimal-2layer/minimal-2layer.xml"
    );
    let xml = std::fs::read(path).unwrap();
    let mut events = Vec::new();
    convert_with_progress(&xml, &Options::default(), &mut |e| events.push(e)).unwrap();
    let expected: Vec<Progress> = STEPS
        .iter()
        .flat_map(|s| [Progress::Start(s), Progress::End(s)])
        .collect();
    assert_eq!(events, expected);
}
