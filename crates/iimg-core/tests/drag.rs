use iimg_core::{
    author, decode,
    interaction::{Event, Runtime},
    visual::SceneError,
};
use serde_json::{json, Value};
const SOURCE: &[u8] = include_bytes!("../../../examples/drag.source.json");
fn runtime() -> Runtime {
    Runtime::new(&decode(&author::compile_v1(SOURCE).unwrap()).unwrap()).unwrap()
}
fn values(rt: &Runtime) -> Vec<u16> {
    rt.sliders().map(|slider| slider.value).collect()
}
fn pixel(rt: &Runtime, x: usize, y: usize) -> [u8; 3] {
    rt.render_rgb().unwrap()[(y * 128 + x) * 3..][..3]
        .try_into()
        .unwrap()
}
#[test]
fn drag_capture_snap_commit_cancel_reverse_and_reset() {
    let mut rt = runtime();
    let initial = rt.render_rgb().unwrap();
    assert_eq!(values(&rt), vec![25, 20]);
    assert!(rt.drag_start(40, 32));
    assert!(rt.drag_move(88, 32));
    assert_eq!(values(&rt), vec![75, 20]);
    assert_eq!(pixel(&rt, 88, 32), [250, 200, 0]);
    rt.drag_end();
    assert!(!rt.dragging());
    assert!(rt.drag_start(88, 32));
    rt.drag_move(16, 32);
    assert_eq!(values(&rt)[0], 0);
    rt.drag_cancel();
    assert_eq!(values(&rt)[0], 75);
    rt.dispatch(Event::Reset);
    assert_eq!(rt.render_rgb().unwrap(), initial);
    assert!(rt.drag_start(40, 32));
    rt.drag_move(28, 32);
    assert_eq!(values(&rt)[0], 15);
    rt.drag_cancel();
    assert!(rt.drag_start(40, 32));
    rt.drag_move(65535, 32);
    assert_eq!(values(&rt)[0], 100);
    rt.drag_end();
    assert!(rt.drag_start(102, 46));
    rt.drag_move(102, 0);
    assert_eq!(values(&rt)[1], 30);
    rt.drag_move(102, 65535);
    assert_eq!(values(&rt)[1], 10);
    rt.drag_cancel();
    assert_eq!(values(&rt)[1], 20);
    assert!(!rt.drag_start(0, 0));
}
#[test]
fn direct_value_and_trace_validation_are_atomic() {
    let mut rt = runtime();
    assert!(rt.drag_start(40, 32));
    rt.drag_move(88, 32);
    assert!(rt.set_slider_value(0, 101).is_err());
    assert!(rt.dragging());
    assert_eq!(values(&rt)[0], 75);
    rt.drag_cancel();
    assert_eq!(values(&rt)[0], 25);
    assert!(rt.set_slider_value(1, 11).is_err());
    rt.set_slider_value(0, 100).unwrap();
    assert_eq!(pixel(&rt, 112, 32), [250, 200, 0]);
    let before = rt.render_rgb().unwrap();
    assert!(matches!(rt.replay(br#"{"version":1,"events":[{"type":"reset"},{"type":"set_slider","index":0,"value":26}]}"#),Err(SceneError::InvalidTrace)));
    assert_eq!(rt.render_rgb().unwrap(), before);
    rt.replay(br#"{"version":1,"events":[{"type":"drag_start","x":40,"y":32},{"type":"drag_move","x":88,"y":32},{"type":"drag_cancel"}]}"#).unwrap();
    assert_eq!(values(&rt), vec![25, 20]);
    assert!(author::compile(SOURCE).is_err());
}
#[test]
fn state_hiding_cancels_capture_and_hidden_values_are_inert() {
    let mut source: Value = serde_json::from_slice(SOURCE).unwrap();
    source["scene"]["objects"].as_array_mut().unwrap().push(
        json!({"type":"rect","id":"hide","x":4,"y":4,"width":24,"height":16,"fill":[80,120,160]}),
    );
    source["interaction"] = json!({"states":[{"id":"show","initial":1,"max":1}],"controls":[{"target":"hide","label":"hide","actions":[{"type":"cycle","state":"show"}]}],"bindings":[{"target":"handleX","state":"show","values":[{"visible":false},{"visible":true}]}]});
    let mut rt = Runtime::new(
        &decode(&author::compile_v1(&serde_json::to_vec(&source).unwrap()).unwrap()).unwrap(),
    )
    .unwrap();
    assert!(rt.drag_start(40, 32));
    rt.drag_move(88, 32);
    rt.dispatch(Event::ActivatePixel { x: 5, y: 5 });
    assert!(!rt.dragging());
    assert_eq!(values(&rt)[0], 25);
    assert!(!rt.sliders().next().unwrap().visible);
    rt.set_slider_value(0, 100).unwrap();
    assert_eq!(values(&rt)[0], 25);
}
#[test]
fn invalid_slider_ranges_steps_references_and_points_are_rejected() {
    let source: Value = serde_json::from_slice(SOURCE).unwrap();
    for (path, value) in [
        ("/drag/sliders/0/min", json!(100)),
        ("/drag/sliders/0/max", json!(1025)),
        ("/drag/sliders/0/step", json!(0)),
        ("/drag/sliders/0/step", json!(3)),
        ("/drag/sliders/0/initial", json!(26)),
        ("/drag/sliders/0/initial", json!(101)),
        ("/drag/sliders/0/axis", json!("z")),
        ("/drag/sliders/0/target", json!("missing")),
        ("/drag/sliders/0/from", json!([8, 24])),
        ("/drag/sliders/0/to/y", json!(25)),
        ("/drag/sliders/0/to/x", json!(8)),
        ("/drag/sliders/0/to/x", json!(113)),
        ("/drag/sliders/1/id", json!("horizontal")),
        ("/drag/sliders/1/target", json!("handleX")),
    ] {
        let mut changed = source.clone();
        *changed.pointer_mut(path).unwrap() = value;
        assert!(
            author::compile_v1(&serde_json::to_vec(&changed).unwrap()).is_err(),
            "accepted {path}"
        );
    }
}

#[test]
fn slider_targets_have_one_owner_and_hidden_sets_cancel_other_capture() {
    let source: Value = serde_json::from_slice(SOURCE).unwrap();
    let mut conflicting = source.clone();
    conflicting["interaction"] =
        json!({"controls":[{"target":"handleX","label":"conflict","active_fill":[1,2,3]}]});
    assert!(author::compile_v1(&serde_json::to_vec(&conflicting).unwrap()).is_err());
    conflicting["interaction"] = json!({"states":[{"id":"show","initial":0,"max":1}],"controls":[{"target":"railX","label":"show","actions":[{"type":"cycle","state":"show"}]}],"bindings":[{"target":"handleY","state":"show","values":[{"visible":false},{"visible":true}]}]});
    conflicting["motion"] = json!({"tracks":[{"target":"handleX","state":"show","equals":1,"duration_ms":1000,"repeat":1,"from":{"x":8,"y":24},"to":{"x":104,"y":24}}]});
    assert!(author::compile_v1(&serde_json::to_vec(&conflicting).unwrap()).is_err());
    conflicting.as_object_mut().unwrap().remove("motion");
    let mut rt = Runtime::new(
        &decode(&author::compile_v1(&serde_json::to_vec(&conflicting).unwrap()).unwrap()).unwrap(),
    )
    .unwrap();
    assert!(rt.drag_start(40, 32));
    rt.drag_move(88, 32);
    rt.set_slider_value(1, 30).unwrap();
    assert!(!rt.dragging());
    assert_eq!(values(&rt), vec![25, 20]);
    let before = rt.render_rgb().unwrap();
    assert!(rt
        .replay(br#"{"version":1,"events":[{"type":"set_slider","index":2,"value":0}]}"#)
        .is_err());
    assert_eq!(rt.render_rgb().unwrap(), before);
}
