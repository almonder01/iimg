#[path = "../../../fuzz/author_exercise.rs"]
mod exercise;

#[test]
fn author_fuzz_contract_includes_candidate_only_capabilities() {
    exercise::exercise(include_bytes!("../../../examples/lamp.source.json"));
    exercise::exercise(include_bytes!("../../../examples/raster-lamp.source.json"));
    exercise::exercise(include_bytes!("../../../examples/state-panel.source.json"));
    exercise::exercise(include_bytes!("../../../examples/motion.source.json"));
    exercise::exercise(include_bytes!("../../../examples/drag.source.json"));
    exercise::exercise(b"{invalid");
}
