//! Author a self-contained visual document from a source description.

use crate::interaction::Runtime;
use crate::visual::{self, SceneError};
use crate::{Chunk, Document};
use base64::{engine::general_purpose::STANDARD, Engine};
use miniz_oxide::deflate::compress_to_vec_zlib;
use serde::Deserialize;
use serde_json::value::RawValue;

pub const MAX_SOURCE_BYTES: usize = 12 * 1024 * 1024;

/// Upgrade a fully supported experimental 0.2 file to the 1.0 candidate.
pub fn upgrade_v1(bytes: &[u8]) -> Result<Vec<u8>, SceneError> {
    let mut document = crate::decode(bytes).map_err(SceneError::Envelope)?;
    if (document.major, document.minor) != (0, 2) {
        return Err(SceneError::UnsupportedVersion);
    }
    let runtime = Runtime::new(&document)?;
    visual::decode_preview(&document, runtime.dimensions())?;
    let mut metadata: serde_json::Value =
        serde_json::from_slice(&document.chunks[0].data).map_err(SceneError::InvalidJson)?;
    metadata["profile"] = "iimg-core-1".into();
    document.chunks[0].data = metadata.to_string().into_bytes();
    document.chunks.retain(|chunk| crate::known(&chunk.kind));
    document.major = 1;
    document.minor = 0;
    crate::encode(&document).map_err(SceneError::Envelope)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Source {
    width: u16,
    height: u16,
    scene: Box<RawValue>,
    interaction: Option<Box<RawValue>>,
    #[serde(default, deserialize_with = "crate::json::object_list")]
    assets: Vec<SourceAsset>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceAsset {
    id: String,
    png_base64: String,
}

/// Validate, render, generate a preview and encode an authored v0.2 file.
pub fn compile(source: &[u8]) -> Result<Vec<u8>, SceneError> {
    compile_visual(source, 0, 2)
}

/// Validate, render, generate a preview and encode an authored 1.0 candidate.
pub fn compile_v1(source: &[u8]) -> Result<Vec<u8>, SceneError> {
    compile_visual(source, 1, 0)
}

fn compile_visual(source: &[u8], major: u8, minor: u8) -> Result<Vec<u8>, SceneError> {
    let profile = crate::visual_profile(major, minor).ok_or(SceneError::UnsupportedVersion)?;
    if source.len() > MAX_SOURCE_BYTES {
        return Err(SceneError::PayloadTooLarge);
    }
    let source: Source = crate::json::from_slice(source).map_err(SceneError::InvalidJson)?;
    if source.scene.get().len() > 128 * 1024
        || source
            .interaction
            .as_ref()
            .is_some_and(|value| value.get().len() > 32 * 1024)
    {
        return Err(SceneError::PayloadTooLarge);
    }
    let mut required = Vec::new();
    let mut state_actions = false;
    if !source.assets.is_empty() {
        required.push("raster-png");
    }
    if source.interaction.is_some() {
        let interaction: serde_json::Value =
            serde_json::from_str(source.interaction.as_ref().unwrap().get())
                .map_err(SceneError::InvalidJson)?;
        state_actions =
            interaction.get("states").is_some() || interaction.get("bindings").is_some();
        required.push(if state_actions {
            "state-actions"
        } else {
            "toggle-fill"
        });
    }
    let metadata = serde_json::json!({
        "profile": profile,
        "width": source.width,
        "height": source.height,
        "required": required,
    });
    let mut doc = Document {
        major,
        minor,
        chunks: vec![
            Chunk {
                kind: *b"META",
                data: metadata.to_string().into_bytes(),
            },
            Chunk {
                kind: *b"PREV",
                data: Vec::new(),
            },
            Chunk {
                kind: *b"SCNE",
                data: source.scene.get().as_bytes().to_vec(),
            },
        ],
    };
    if !source.assets.is_empty() {
        doc.chunks.push(Chunk {
            kind: *b"ASST",
            data: encode_assets(&source.assets)?,
        });
    }
    if let Some(interaction) = source.interaction {
        doc.chunks.push(Chunk {
            kind: if state_actions { *b"STAC" } else { *b"INTR" },
            data: interaction.get().as_bytes().to_vec(),
        });
    }
    doc.chunks.push(Chunk {
        kind: *b"IEND",
        data: Vec::new(),
    });

    let runtime = Runtime::new(&doc)?;
    let (width, height) = runtime.dimensions();
    let pixels = runtime.render_rgb()?;
    doc.chunks[1].data = encode_png(width, height, &pixels);
    visual::preflight_preview(&doc, (width, height))?;
    crate::encode(&doc).map_err(SceneError::Envelope)
}

fn encode_assets(assets: &[SourceAsset]) -> Result<Vec<u8>, SceneError> {
    if assets.len() > visual::MAX_ASSET_COUNT {
        return Err(SceneError::InvalidAssetTable);
    }
    let mut table = (assets.len() as u16).to_be_bytes().to_vec();
    for asset in assets {
        if !visual::valid_id(&asset.id) {
            return Err(SceneError::InvalidAssetTable);
        }
        if asset.png_base64.len() > visual::MAX_PNG_BYTES.div_ceil(3) * 4 {
            return Err(SceneError::PayloadTooLarge);
        }
        let png = STANDARD
            .decode(&asset.png_base64)
            .map_err(|_| SceneError::InvalidAssetImage)?;
        if png.len() > visual::MAX_PNG_BYTES
            || table.len() + 5 + asset.id.len() + png.len() > crate::MAX_CHUNK
        {
            return Err(SceneError::PayloadTooLarge);
        }
        table.push(asset.id.len() as u8);
        table.extend(asset.id.as_bytes());
        table.extend((png.len() as u32).to_be_bytes());
        table.extend(png);
    }
    Ok(table)
}

fn encode_png(width: u16, height: u16, rgb: &[u8]) -> Vec<u8> {
    let stride = usize::from(width) * 3;
    let mut filtered = Vec::with_capacity((stride + 1) * usize::from(height));
    for row in rgb.chunks_exact(stride) {
        filtered.push(0);
        filtered.extend_from_slice(row);
    }
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut header = Vec::with_capacity(13);
    header.extend(u32::from(width).to_be_bytes());
    header.extend(u32::from(height).to_be_bytes());
    header.extend([8, 2, 0, 0, 0]);
    append_png_chunk(&mut png, b"IHDR", &header);
    append_png_chunk(&mut png, b"IDAT", &compress_to_vec_zlib(&filtered, 6));
    append_png_chunk(&mut png, b"IEND", &[]);
    png
}

fn append_png_chunk(png: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    png.extend((data.len() as u32).to_be_bytes());
    let start = png.len();
    png.extend(kind);
    png.extend(data);
    png.extend(crate::crc32(&png[start..]).to_be_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_candidate_matches_migrated_source() {
        let source = include_bytes!("../../../examples/lamp.source.json");
        let candidate = compile_v1(source).unwrap();
        assert_eq!(candidate, upgrade_v1(&compile(source).unwrap()).unwrap());
        let document = crate::decode(&candidate).unwrap();
        assert_eq!((document.major, document.minor), (1, 0));
    }

    #[test]
    fn authored_raster_keeps_asset_bytes_and_matches_preview() {
        let source = include_bytes!("../../../examples/raster-lamp.source.json");
        let candidate = crate::decode(&compile_v1(source).unwrap()).unwrap();
        let fixture = crate::decode(include_bytes!(
            "../../../tests/fixtures/v1.0/raster-toggle.iimg"
        ))
        .unwrap();
        assert_eq!(candidate.chunks[3], fixture.chunks[3]);
        let runtime = Runtime::new(&candidate).unwrap();
        let pixels = runtime.render_rgb().unwrap();
        assert_eq!(
            visual::decode_preview(&candidate, runtime.dimensions())
                .unwrap()
                .rgb,
            pixels
        );
        let offset = (15 * 32 + 6) * 3;
        assert_eq!(&pixels[offset..offset + 3], &[80, 175, 240]);
    }

    #[test]
    fn malformed_asset_base64_is_rejected() {
        let source = br#"{"width":1,"height":1,"scene":{"background":[0,0,0],"objects":[]},"assets":[{"id":"broken","png_base64":"?"}]}"#;
        assert!(matches!(
            compile_v1(source),
            Err(SceneError::InvalidAssetImage)
        ));
    }

    #[test]
    fn arrays_cannot_substitute_source_objects() {
        for source in [
            br#"[1,1,{"background":[0,0,0],"objects":[]},null,[]]"#.as_slice(),
            br#"{"width":1,"height":1,"scene":[[0,0,0],[]]}"#,
            br#"{"width":1,"height":1,"scene":{"background":[0,0,0],"objects":[]},"assets":[["tile",""]]}"#,
        ] {
            for compile in [compile, compile_v1] {
                assert!(matches!(compile(source), Err(SceneError::InvalidJson(_))));
            }
        }
    }

    #[test]
    fn authored_preview_matches_initial_render() {
        let bytes = compile(include_bytes!("../../../examples/lamp.source.json")).unwrap();
        let doc = crate::decode(&bytes).unwrap();
        let runtime = Runtime::new(&doc).unwrap();
        assert_eq!(
            visual::decode_preview(&doc, runtime.dimensions())
                .unwrap()
                .rgb,
            runtime.render_rgb().unwrap()
        );
        assert_eq!(
            runtime.controls().collect::<Vec<_>>(),
            [("lamp", "Lamp", false)]
        );
    }

    #[test]
    fn duplicate_nested_fields_and_missing_targets_are_rejected() {
        let duplicate = br#"{"width":1,"height":1,"scene":{"background":[0,0,0],"background":[1,1,1],"objects":[]}}"#;
        assert!(matches!(
            compile(duplicate),
            Err(SceneError::InvalidJson(_))
        ));
        let missing = br#"{"width":1,"height":1,"scene":{"background":[0,0,0],"objects":[]},"interaction":{"controls":[{"target":"missing","label":"Missing","active_fill":[1,2,3]}]}}"#;
        assert!(matches!(
            compile(missing),
            Err(SceneError::InvalidInteraction)
        ));
    }
}
