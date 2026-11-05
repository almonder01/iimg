use iimg_core::interaction::{Event, Runtime};
use iimg_core::{decode, visual};

const LAMP: &[u8] = include_bytes!("../../../tests/fixtures/v0.2/interactive-lamp.iimg");
const TWO_CONTROLS: &[u8] = include_bytes!("../../../tests/fixtures/v0.2/two-controls.iimg");
const POINTER: &[u8] = include_bytes!("../../../tests/fixtures/v0.2/two-controls-pointer.json");
const KEYBOARD: &[u8] = include_bytes!("../../../tests/fixtures/v0.2/two-controls-keyboard.json");

#[test]
fn replay_resets_state_and_matches_pointer_and_keyboard_frames() {
    let document = decode(TWO_CONTROLS).unwrap();
    let mut runtime = Runtime::new(&document).unwrap();
    assert_eq!(
        runtime.render_rgb().unwrap(),
        visual::decode_preview(&document, (32, 32)).unwrap().rgb
    );
    runtime.replay(POINTER).unwrap();
    let frame = runtime.render_rgb().unwrap();
    assert_eq!(runtime.focused_target(), Some("switch"));
    assert_eq!(
        runtime.controls().collect::<Vec<_>>(),
        [("lamp", "Lamp", true), ("switch", "Switch", true),]
    );
    assert_eq!(&frame[..3], &[88, 210, 130]);
    runtime.replay(KEYBOARD).unwrap();
    assert_eq!(runtime.render_rgb().unwrap(), frame);
    assert!(runtime
        .replay(br#"{"version":1,"events":[{"type":"reset"},{"type":"unknown"}]}"#)
        .is_err());
    assert!(runtime
        .replay(br#"{"version":1,"events":[{"type":"reset","extra":true}]}"#)
        .is_err());
    for trace in [
        br#"[1,[{"type":"reset"}]]"#.as_slice(),
        br#"{"version":1,"events":[{"type":"reset"},["activate_pixel",16,16]]}"#,
        br#"{"version":1,"events":[["reset"]]}"#,
    ] {
        assert!(runtime.replay(trace).is_err());
        assert_eq!(runtime.focused_target(), Some("switch"));
        assert_eq!(runtime.render_rgb().unwrap(), frame);
    }
    assert_eq!(runtime.render_rgb().unwrap(), frame);
}

#[test]
fn pointer_and_keyboard_produce_the_same_frame_and_reset_restores_preview() {
    let doc = decode(LAMP).unwrap();
    let mut pointer = Runtime::new(&doc).unwrap();
    let mut keyboard = Runtime::new(&doc).unwrap();
    let initial = visual::decode_preview(&doc, pointer.dimensions())
        .unwrap()
        .rgb;
    assert_eq!(pointer.render_rgb().unwrap(), initial);
    pointer.dispatch(Event::ActivatePixel { x: 0, y: 0 });
    assert_eq!(pointer.focused_target(), None);
    pointer.dispatch(Event::ActivatePixel { x: 16, y: 16 });
    keyboard.dispatch(Event::FocusNext);
    keyboard.dispatch(Event::ActivateFocused);
    assert_eq!(pointer.focused_target(), Some("lamp"));
    assert_eq!(
        pointer.controls().collect::<Vec<_>>(),
        [("lamp", "Lamp", true)]
    );
    let pixels = pointer.render_rgb().unwrap();
    assert_eq!(pixels, keyboard.render_rgb().unwrap());
    let center = (16 * 32 + 16) * 3;
    assert_eq!(&pixels[center..center + 3], &[248, 113, 113]);
    pointer.dispatch(Event::Reset);
    assert_eq!(pointer.focused_target(), None);
    assert_eq!(pointer.render_rgb().unwrap(), initial);
}

#[test]
fn rejects_missing_targets_and_mismatched_capability() {
    let mut doc = decode(LAMP).unwrap();
    doc.chunks[3].data =
        br#"{"controls":[{"target":"missing","label":"Lamp","active_fill":[1,2,3]}]}"#.to_vec();
    assert!(matches!(
        Runtime::new(&doc),
        Err(visual::SceneError::InvalidInteraction)
    ));
    doc.chunks.remove(3);
    assert!(matches!(
        Runtime::new(&doc),
        Err(visual::SceneError::InvalidCapabilities)
    ));
}

#[test]
fn focus_wraps_in_control_order_and_topmost_shape_receives_pointer() {
    let mut doc = decode(LAMP).unwrap();
    doc.chunks[2].data = br#"{"background":[0,0,0],"objects":[
        {"type":"rect","id":"bottom","x":0,"y":0,"width":20,"height":20,"fill":[1,1,1]},
        {"type":"rect","id":"top","x":10,"y":10,"width":20,"height":20,"fill":[2,2,2]}
    ]}"#
    .to_vec();
    doc.chunks[3].data = br#"{"controls":[
        {"target":"top","label":"Top","active_fill":[3,3,3]},
        {"target":"bottom","label":"Bottom","active_fill":[4,4,4]}
    ]}"#
    .to_vec();
    let mut runtime = Runtime::new(&doc).unwrap();
    runtime.dispatch(Event::FocusPrevious);
    assert_eq!(runtime.focused_target(), Some("bottom"));
    runtime.dispatch(Event::FocusNext);
    assert_eq!(runtime.focused_target(), Some("top"));
    runtime.dispatch(Event::ActivatePixel { x: 15, y: 15 });
    assert_eq!(
        runtime.controls().collect::<Vec<_>>(),
        [("top", "Top", true), ("bottom", "Bottom", false),]
    );
}
