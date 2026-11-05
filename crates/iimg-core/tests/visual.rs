use iimg_core::{decode, encode, visual, Chunk, Error};

const LAMP: &[u8] = include_bytes!("../../../tests/fixtures/v0.2/lamp.iimg");
const RASTER_LAMP: &[u8] = include_bytes!("../../../tests/fixtures/v0.2/raster-lamp.iimg");

#[test]
fn raster_and_vector_layers_match_independent_preview() {
    let doc = decode(RASTER_LAMP).unwrap();
    assert_eq!(encode(&doc).unwrap(), RASTER_LAMP);
    let pixels = visual::validate_scene(&doc).unwrap().render_rgb().unwrap();
    assert_eq!(pixels, visual::decode_preview(&doc, (32, 32)).unwrap().rgb);
    let offset = (15 * 32 + 6) * 3;
    assert_eq!(&pixels[offset..offset + 3], &[80, 175, 240]);
    assert_eq!(&pixels[offset + 6..offset + 9], &[250, 204, 21]);
}

#[test]
fn rejects_invalid_assets_and_unresolved_image() {
    let mut doc = decode(RASTER_LAMP).unwrap();
    let original = doc.chunks[3].data.clone();
    doc.chunks[3].data.push(0);
    assert!(matches!(
        visual::validate_scene(&doc),
        Err(visual::SceneError::InvalidAssetTable)
    ));
    doc.chunks[3].data = original.clone();
    doc.chunks[3].data[1] = 2;
    doc.chunks[3].data.extend_from_slice(&original[2..]);
    assert!(matches!(
        visual::validate_scene(&doc),
        Err(visual::SceneError::InvalidAssetTable)
    ));
    doc.chunks[3].data = original.clone();
    *doc.chunks[3].data.last_mut().unwrap() ^= 1;
    assert!(matches!(
        visual::validate_scene(&doc),
        Err(visual::SceneError::InvalidAssetImage)
    ));
    doc.chunks[3].data = original;
    let scene = String::from_utf8(doc.chunks[2].data.clone()).unwrap();
    doc.chunks[2].data = scene.replace("\"tile\"", "\"missing\"").into_bytes();
    assert!(matches!(
        visual::validate_scene(&doc),
        Err(visual::SceneError::MissingAsset)
    ));
    doc.chunks[2].data = scene.replace("\"x\":6", "\"x\":65535").into_bytes();
    assert!(matches!(
        visual::validate_scene(&doc),
        Err(visual::SceneError::InvalidGeometry)
    ));
}

#[test]
fn asset_pixel_budget_is_checked_before_inflating_any_asset() {
    let mut doc = decode(RASTER_LAMP).unwrap();
    let mut entry = doc.chunks[3].data[2..].to_vec();
    let dimensions = 1 + 4 + 4 + 16;
    entry[dimensions..dimensions + 4].copy_from_slice(&2048u32.to_be_bytes());
    entry[dimensions + 4..dimensions + 8].copy_from_slice(&2048u32.to_be_bytes());
    let mut table = vec![0, 2];
    table.extend_from_slice(&entry);
    entry[1] = b'f';
    table.extend_from_slice(&entry);
    doc.chunks[3].data = table;
    assert!(matches!(
        visual::validate_scene(&doc),
        Err(visual::SceneError::AssetBudgetExceeded)
    ));
}

#[test]
fn static_preview_ignores_unsupported_capabilities_and_opaque_scene() {
    let mut doc = decode(LAMP).unwrap();
    doc.chunks[0].data =
        br#"{"profile":"iimg-visual-0.2","width":32,"height":32,"required":["motion"]}"#.to_vec();
    doc.chunks[2].data = vec![0xff];
    assert!(matches!(
        visual::validate_scene(&doc),
        Err(visual::SceneError::UnsupportedProfile)
    ));
    assert_eq!(
        visual::extract_static_preview(&encode(&doc).unwrap()).unwrap(),
        doc.chunks[1].data
    );
}

#[test]
fn independent_visual_fixture() {
    let doc = decode(LAMP).unwrap();
    assert_eq!(encode(&doc).unwrap(), LAMP);
    let scene = visual::validate_scene(&doc).unwrap();
    assert_eq!(scene.dimensions(), (32, 32));
    assert_eq!(scene.background(), [26, 32, 44]);
    assert_eq!(scene.objects().len(), 1);
    let preview = visual::decode_preview(&doc, scene.dimensions()).unwrap();
    assert_eq!(preview.rgb, scene.render_rgb().unwrap());
    assert_eq!(
        visual::preflight_preview(&doc, scene.dimensions())
            .unwrap()
            .len(),
        148
    );
}

#[test]
fn duplicate_visual_chunk_is_rejected() {
    let mut doc = decode(LAMP).unwrap();
    doc.chunks.insert(2, doc.chunks[1].clone());
    assert_eq!(encode(&doc), Err(Error::BadOrdering));
}

#[test]
fn duplicate_fields_and_out_of_bounds_shapes_are_rejected() {
    let mut doc = decode(LAMP).unwrap();
    doc.chunks[2] = Chunk {
        kind: *b"SCNE",
        data: br#"{"background":[0,0,0],"background":[1,1,1],"objects":[]}"#.to_vec(),
    };
    assert!(matches!(
        visual::validate_scene(&doc),
        Err(visual::SceneError::InvalidJson(_))
    ));
    doc.chunks[2].data =
        br#"{"background":[0,0,0],"objects":[{"type":"circle","id":"lamp","cx":31,"cy":16,"radius":8,"fill":[0,0,0]}]}"#.to_vec();
    assert!(matches!(
        visual::validate_scene(&doc),
        Err(visual::SceneError::InvalidGeometry)
    ));
}

#[test]
fn preview_corruption_inside_a_valid_envelope_is_rejected() {
    let mut doc = decode(LAMP).unwrap();
    assert!(visual::preflight_preview(&doc, (31, 32)).is_err());
    doc.chunks[1].data[16] ^= 1;
    let doc = decode(&encode(&doc).unwrap()).unwrap();
    assert!(visual::preflight_preview(&doc, (32, 32)).is_err());
}

#[test]
fn overlapping_shapes_respect_order_and_render_budget() {
    let mut doc = decode(LAMP).unwrap();
    doc.chunks[2].data = br#"{"background":[1,2,3],"objects":[
        {"type":"rect","id":"back","x":0,"y":0,"width":2,"height":1,"fill":[10,20,30]},
        {"type":"rect","id":"front","x":1,"y":0,"width":1,"height":1,"fill":[40,50,60]}
    ]}"#
    .to_vec();
    let pixels = visual::validate_scene(&doc).unwrap().render_rgb().unwrap();
    assert_eq!(&pixels[..9], &[10, 20, 30, 40, 50, 60, 1, 2, 3]);

    doc.chunks[0].data =
        br#"{"profile":"iimg-visual-0.2","width":2048,"height":2048,"required":[]}"#.to_vec();
    let shapes = (0..5)
        .map(|id| format!(r#"{{"type":"rect","id":"rect{id}","x":0,"y":0,"width":2048,"height":2048,"fill":[0,0,0]}}"#))
        .collect::<Vec<_>>()
        .join(",");
    doc.chunks[2].data = format!(r#"{{"background":[0,0,0],"objects":[{shapes}]}}"#).into_bytes();
    let scene = visual::validate_scene(&doc).unwrap();
    assert!(matches!(
        scene.render_rgb(),
        Err(visual::SceneError::RenderBudgetExceeded)
    ));
}
