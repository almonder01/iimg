use iimg_core::{
    author, decode,
    interaction::{Event, Runtime},
    visual::SceneError,
};
use serde_json::{json, Value};
const SOURCE: &[u8] = include_bytes!("../../../examples/motion.source.json");
fn runtime() -> Runtime {
    Runtime::new(&decode(&author::compile_v1(SOURCE).unwrap()).unwrap()).unwrap()
}
fn pixel(rt: &Runtime, x: usize, y: usize) -> [u8; 3] {
    rt.render_rgb().unwrap()[(y * 96 + x) * 3..][..3]
        .try_into()
        .unwrap()
}
#[test]
fn integer_motion_boundaries_negative_deltas_retrigger_and_reset() {
    let mut rt = runtime();
    let initial = rt.render_rgb().unwrap();
    assert!(!rt.motion_running());
    rt.dispatch(Event::ActivatePixel { x: 5, y: 5 });
    assert!(rt.motion_running());
    rt.advance_time(500).unwrap();
    assert_eq!(pixel(&rt, 48, 40), [250, 200, 0]);
    assert_eq!(pixel(&rt, 56, 12), [40, 200, 220]);
    rt.advance_time(1000).unwrap();
    assert_eq!(pixel(&rt, 16, 40), [250, 200, 0]);
    rt.advance_time(2000).unwrap();
    assert_eq!(pixel(&rt, 80, 40), [250, 200, 0]);
    assert!(!rt.motion_running());
    let final_frame = rt.render_rgb().unwrap();
    assert!(rt.advance_time(1999).is_err());
    assert_eq!(rt.render_rgb().unwrap(), final_frame);
    rt.dispatch(Event::ActivatePixel { x: 5, y: 5 });
    assert_eq!(pixel(&rt, 16, 40), [250, 200, 0]);
    rt.dispatch(Event::ActivatePixel { x: 5, y: 5 });
    rt.advance_time(2500).unwrap();
    assert_eq!(pixel(&rt, 48, 40), [250, 200, 0]);
    rt.dispatch(Event::Reset);
    assert_eq!(rt.clock_milliseconds(), 0);
    assert_eq!(rt.render_rgb().unwrap(), initial);
}
#[test]
fn reduced_motion_and_invalid_replay_are_atomic() {
    let mut rt = runtime();
    rt.set_motion_preference(true);
    rt.dispatch(Event::ActivatePixel { x: 5, y: 5 });
    assert_eq!(pixel(&rt, 80, 40), [250, 200, 0]);
    assert!(!rt.motion_running());
    rt.dispatch(Event::Reset);
    rt.dispatch(Event::ActivatePixel { x: 5, y: 5 });
    assert_eq!(pixel(&rt, 80, 40), [250, 200, 0]);
    let before = rt.render_rgb().unwrap();
    let invalid=br#"{"version":1,"events":[{"type":"reset"},{"type":"advance_time","milliseconds":100},{"type":"advance_time","milliseconds":99}]}"#;
    assert!(matches!(rt.replay(invalid), Err(SceneError::InvalidTrace)));
    assert_eq!(rt.render_rgb().unwrap(), before);
    rt.replay(br#"{"version":1,"events":[{"type":"activate_pixel","x":5,"y":5},{"type":"advance_time","milliseconds":500}]}"#).unwrap();
    assert_eq!(pixel(&rt, 48, 40), [250, 200, 0]); // replay's preference starts false
    assert!(rt.advance_time(86_400_001).is_err());
    rt.advance_time(86_400_000).unwrap();
    assert!(!rt.motion_running());
    assert_eq!(pixel(&rt, 80, 40), [250, 200, 0]);
}
#[test]
fn motion_ranges_references_duplicates_and_placements_are_rejected() {
    let source: Value = serde_json::from_slice(SOURCE).unwrap();
    for (path, value) in [
        ("/motion/tracks/0/duration_ms", json!(0)),
        ("/motion/tracks/0/duration_ms", json!(60001)),
        ("/motion/tracks/0/duration_ms", json!(4294967295_u32)),
        ("/motion/tracks/0/repeat", json!(17)),
        ("/motion/tracks/0/repeat", json!(0)),
        ("/motion/tracks/0/state", json!("missing")),
        ("/motion/tracks/0/equals", json!(2)),
        ("/motion/tracks/0/to/x", json!(81)),
        ("/motion/tracks/1/target", json!("orb")),
        ("/motion/tracks/0/from/x", json!(65535)),
        ("/motion/tracks/0/from", json!([8, 32])),
    ] {
        let mut changed = source.clone();
        *changed.pointer_mut(path).unwrap() = value;
        assert!(
            author::compile_v1(&serde_json::to_vec(&changed).unwrap()).is_err(),
            "accepted {path}"
        );
    }
}
