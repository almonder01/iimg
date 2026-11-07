use iimg_core::{author, decode, encode, interaction::Runtime};
use serde_json::{json, Value};
#[test]
fn alternative_description_is_bounded_optional_and_pixel_neutral() {
    let mut source: Value =
        serde_json::from_slice(include_bytes!("../../../examples/raster-lamp.source.json"))
            .unwrap();
    let plain = author::compile_v1(&serde_json::to_vec(&source).unwrap()).unwrap();
    source["accessibility"] = json!({"description":"مصباح قابل للتفاعل","language":"ar-SA"});
    let bytes = author::compile_v1(&serde_json::to_vec(&source).unwrap()).unwrap();
    let document = decode(&bytes).unwrap();
    let rt = Runtime::new(&document).unwrap();
    assert_eq!(rt.accessibility().unwrap().language, "ar-SA");
    assert_eq!(
        rt.render_rgb().unwrap(),
        Runtime::new(&decode(&plain).unwrap())
            .unwrap()
            .render_rgb()
            .unwrap()
    );
    let mut duplicate = document.clone();
    duplicate.chunks.insert(
        3,
        document
            .chunks
            .iter()
            .find(|c| &c.kind == b"aTXT")
            .unwrap()
            .clone(),
    );
    assert!(encode(&duplicate).is_err());
    for value in [
        json!({"description":" ","language":"en"}),
        json!({"description":"x\n","language":"en"}),
        json!({"description":"x","language":"x"}),
        json!({"description":"x","language":"ar-"}),
        json!({"description":"x","language":"en_Us"}),
        json!({"description":"x","language":"en\n"}),
        json!({"description":"ض".repeat(1025),"language":"ar"}),
        json!(["text", "en"]),
    ] {
        source["accessibility"] = value;
        assert!(author::compile_v1(&serde_json::to_vec(&source).unwrap()).is_err());
    }
}
#[test]
fn source_text_hints_are_validated_but_not_compiled_into_assets() {
    let mut source: Value =
        serde_json::from_slice(include_bytes!("../../../examples/raster-lamp.source.json"))
            .unwrap();
    let plain = author::compile_v1(&serde_json::to_vec(&source).unwrap()).unwrap();
    let hint = json!({"text":"مرحبا\nHello","font_family":"sans-serif","font_size":32,"direction":"rtl","color":[255,255,255],"background":[0,0,0]});
    source["assets"][0]["text"] = hint.clone();
    assert_eq!(
        author::compile_v1(&serde_json::to_vec(&source).unwrap()).unwrap(),
        plain
    );
    for (field, value) in [
        ("text", json!("x\n".repeat(9))),
        ("text", json!("ض".repeat(513))),
        ("text", json!("x\t")),
        ("font_family", json!("url(evil)")),
        ("font_size", json!(129)),
        ("direction", json!("auto")),
        ("color", json!([256, 0, 0])),
    ] {
        source["assets"][0]["text"] = hint.clone();
        source["assets"][0]["text"][field] = value;
        assert!(
            author::compile_v1(&serde_json::to_vec(&source).unwrap()).is_err(),
            "accepted {field}"
        );
    }
    source["assets"][0]["text"] = json!(["x", "serif", 32, "ltr", [0, 0, 0], [1, 1, 1]]);
    assert!(author::compile_v1(&serde_json::to_vec(&source).unwrap()).is_err());
}
