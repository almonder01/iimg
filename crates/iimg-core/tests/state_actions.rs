use iimg_core::{
    author, decode,
    interaction::{Event, Runtime},
    visual::{self, SceneError},
};
use serde_json::{json, Value};

const SOURCE: &[u8] = include_bytes!("../../../examples/state-panel.source.json");
fn runtime() -> Runtime {
    Runtime::new(&decode(&author::compile_v1(SOURCE).unwrap()).unwrap()).unwrap()
}
fn pixel(runtime: &Runtime, x: usize, y: usize) -> [u8; 3] {
    runtime.render_rgb().unwrap()[(y * 64 + x) * 3..][..3]
        .try_into()
        .unwrap()
}

#[test]
fn grouped_actions_visibility_hit_focus_and_reset() {
    let bytes = author::compile_v1(SOURCE).unwrap();
    let doc = decode(&bytes).unwrap();
    let mut rt = Runtime::new(&doc).unwrap();
    let initial = rt.render_rgb().unwrap();
    assert_eq!(initial, visual::decode_preview(&doc, (64, 40)).unwrap().rgb);
    assert!(!rt.control_visible(0));
    assert_eq!(pixel(&rt, 2, 2), [0, 128, 0]);
    rt.dispatch(Event::FocusNext);
    assert_eq!(rt.focused_target(), Some("base"));
    rt.dispatch(Event::ActivatePixel { x: 2, y: 2 });
    assert_eq!(pixel(&rt, 32, 28), [40, 80, 220]);
    rt.dispatch(Event::ActivatePixel { x: 22, y: 2 });
    assert_eq!(pixel(&rt, 2, 2), [128, 0, 0]);
    assert_eq!(pixel(&rt, 32, 28), [0, 220, 220]);
    assert!(rt.control_visible(0));
    rt.dispatch(Event::ActivatePixel { x: 2, y: 2 });
    assert_eq!(pixel(&rt, 2, 2), [0, 0, 180]);
    assert_eq!(rt.focused_target(), None);
    rt.focus_control(Some(0));
    assert_eq!(rt.focused_target(), None);
    rt.dispatch(Event::ActivatePixel { x: 42, y: 2 });
    assert!(!rt.control_visible(3));
    assert_eq!(rt.focused_target(), None);
    assert_eq!(pixel(&rt, 42, 2), [12, 20, 32]);
    rt.dispatch(Event::Reset);
    assert_eq!(rt.render_rgb().unwrap(), initial);
    assert!(rt.control_visible(3));
}

#[test]
fn cycle_wrap_and_keyboard_pointer_replay_agree() {
    let mut rt = runtime();
    let initial = rt.render_rgb().unwrap();
    for _ in 0..3 {
        rt.dispatch(Event::ActivatePixel { x: 2, y: 2 });
    }
    assert_eq!(rt.render_rgb().unwrap(), initial);
    let pointer = br#"{"version":1,"events":[{"type":"activate_pixel","x":2,"y":2},{"type":"activate_pixel","x":22,"y":2},{"type":"activate_pixel","x":2,"y":2},{"type":"activate_pixel","x":42,"y":2}]}"#;
    let keyboard = br#"{"version":1,"events":[{"type":"focus_next"},{"type":"activate_focused"},{"type":"focus_next"},{"type":"activate_focused"},{"type":"focus_next"},{"type":"activate_focused"},{"type":"focus_next"},{"type":"activate_focused"}]}"#;
    rt.replay(pointer).unwrap();
    let expected = rt.render_rgb().unwrap();
    rt.replay(keyboard).unwrap();
    assert_eq!(rt.render_rgb().unwrap(), expected);
    assert!(author::compile(SOURCE).is_err());
}

#[test]
fn invalid_state_definitions_bindings_and_action_groups_are_rejected() {
    let original: Value = serde_json::from_slice(SOURCE).unwrap();
    let invalid = [
        ("/interaction/states/0/max", json!(0)),
        ("/interaction/states/0/max", json!(16)),
        ("/interaction/states/0/initial", json!(2)),
        ("/interaction/states/1/id", json!("panel")),
        ("/interaction/controls/0/target", json!("missing")),
        ("/interaction/controls/0/label", json!("\n")),
        ("/interaction/controls/0/actions", json!([])),
        ("/interaction/controls/0/actions/0/state", json!("missing")),
        ("/interaction/controls/0/actions/0/value", json!(2)),
        ("/interaction/controls/1/target", json!("cover")),
        (
            "/interaction/controls/1/actions",
            json!([{"type":"cycle","state":"tone"},{"type":"set","state":"tone","value":0}]),
        ),
        ("/interaction/bindings/0/target", json!("missing")),
        ("/interaction/bindings/1/target", json!("cover")),
        ("/interaction/bindings/0/values", json!([{"visible":true}])),
        ("/interaction/bindings/0/values/0/visible", json!(1)),
        (
            "/interaction/bindings/0/values/0",
            json!({"visible":false,"fill":[0,256,0]}),
        ),
    ];
    for (path, value) in invalid {
        let mut source = original.clone();
        *source.pointer_mut(path).unwrap() = value;
        assert!(
            author::compile_v1(&serde_json::to_vec(&source).unwrap()).is_err(),
            "accepted {path}"
        );
    }
}

#[test]
fn invisible_objects_still_count_toward_worst_case_render_work() {
    let source = json!({"width":2048,"height":2048,
        "scene":{"background":[0,0,0],"objects":(0..5).map(|i| json!({"type":"rect","id":format!("s{i}"),"x":0,"y":0,"width":2048,"height":2048,"fill":[1,2,3]})).collect::<Vec<_>>()},
        "interaction":{"states":[{"id":"show","initial":0,"max":1}],"controls":[{"target":"s0","label":"show","actions":[{"type":"cycle","state":"show"}]}],
        "bindings":(0..5).map(|i|json!({"target":format!("s{i}"),"state":"show","values":[{"visible":false},{"visible":true}]})).collect::<Vec<_>>()}});
    assert!(matches!(
        author::compile_v1(&serde_json::to_vec(&source).unwrap()),
        Err(SceneError::RenderBudgetExceeded)
    ));
}
