//! Typed vector scene for the experimental 0.2 profile.

use crate::Document;
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    fmt,
};

const MAX_SIDE: u16 = 2048;
const MAX_META_BYTES: usize = 4096;
const MAX_SCENE_BYTES: usize = 128 * 1024;
const MAX_OBJECTS: usize = 256;
const MAX_SHAPE_PIXELS: usize = 16 * 1024 * 1024;
pub(crate) const MAX_ASSET_COUNT: usize = 32;
pub(crate) const MAX_PNG_BYTES: usize = 1024 * 1024;

#[derive(Debug)]
pub enum SceneError {
    Envelope(crate::Error),
    UnsupportedVersion,
    UnsupportedProfile,
    InvalidCapabilities,
    MissingChunk,
    PayloadTooLarge,
    InvalidJson(serde_json::Error),
    InvalidCanvas,
    TooManyObjects,
    InvalidObjectId,
    DuplicateObjectId,
    InvalidGeometry,
    InvalidPreview,
    InvalidAssetTable,
    InvalidAssetImage,
    InvalidInteraction,
    InvalidTrace,
    MissingAsset,
    AssetBudgetExceeded,
    RenderBudgetExceeded,
}

impl fmt::Display for SceneError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

impl std::error::Error for SceneError {}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Metadata {
    profile: String,
    width: u16,
    height: u16,
    required: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ScenePayload {
    background: [u8; 3],
    #[serde(deserialize_with = "crate::json::object_list")]
    objects: Vec<Shape>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Shape {
    Image {
        id: String,
        asset: String,
        x: u16,
        y: u16,
    },
    Rect {
        id: String,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        fill: [u8; 3],
    },
    Circle {
        id: String,
        cx: u16,
        cy: u16,
        radius: u16,
        fill: [u8; 3],
    },
}

#[derive(Debug)]
pub struct Scene {
    width: u16,
    height: u16,
    background: [u8; 3],
    objects: Vec<Shape>,
    assets: HashMap<String, Raster>,
}

#[derive(Debug)]
struct Raster {
    width: u16,
    height: u16,
    pixels: Vec<u8>,
}

impl Scene {
    pub fn dimensions(&self) -> (u16, u16) {
        (self.width, self.height)
    }

    pub fn background(&self) -> [u8; 3] {
        self.background
    }

    pub fn objects(&self) -> &[Shape] {
        &self.objects
    }

    /// Render row-major opaque RGB pixels using the visual profile's sample points.
    pub fn render_rgb(&self) -> Result<Vec<u8>, SceneError> {
        self.render_with_fills(|_| None)
    }

    pub(crate) fn render_with_fills(
        &self,
        override_fill: impl Fn(usize) -> Option<[u8; 3]>,
    ) -> Result<Vec<u8>, SceneError> {
        let width = usize::from(self.width);
        let height = usize::from(self.height);
        let mut work = 0;
        for shape in &self.objects {
            let (left, top, right, bottom) = shape.bounds(&self.assets);
            work += (right - left) * (bottom - top);
            if work > MAX_SHAPE_PIXELS {
                return Err(SceneError::RenderBudgetExceeded);
            }
        }

        let mut pixels = self.background.repeat(width * height);
        for (index, shape) in self.objects.iter().enumerate() {
            let (left, top, right, bottom) = shape.bounds(&self.assets);
            if let Shape::Image { asset, .. } = shape {
                let stride = (right - left) * 3;
                for (y, row) in (top..bottom).zip(self.assets[asset].pixels.chunks_exact(stride)) {
                    let start = (y * width + left) * 3;
                    pixels[start..start + stride].copy_from_slice(row);
                }
                continue;
            }
            let replacement = override_fill(index);
            for y in top..bottom {
                for x in left..right {
                    if let Some(fill) = shape.sample(x as i32, y as i32) {
                        let offset = (y * width + x) * 3;
                        pixels[offset..offset + 3]
                            .copy_from_slice(replacement.as_ref().unwrap_or(fill));
                    }
                }
            }
        }
        Ok(pixels)
    }

    pub(crate) fn hit_test(&self, x: u16, y: u16) -> Option<usize> {
        self.objects.iter().rposition(|shape| {
            let (left, top, right, bottom) = shape.bounds(&self.assets);
            (left..right).contains(&usize::from(x))
                && (top..bottom).contains(&usize::from(y))
                && (matches!(shape, Shape::Image { .. })
                    || shape.sample(x.into(), y.into()).is_some())
        })
    }
}

impl Shape {
    // Used only with validated coordinates from a Scene.
    fn bounds(&self, assets: &HashMap<String, Raster>) -> (usize, usize, usize, usize) {
        match *self {
            Self::Image {
                ref asset, x, y, ..
            } => {
                let raster = &assets[asset];
                (
                    x.into(),
                    y.into(),
                    (x + raster.width).into(),
                    (y + raster.height).into(),
                )
            }
            Self::Rect {
                x,
                y,
                width,
                height,
                ..
            } => (x.into(), y.into(), (x + width).into(), (y + height).into()),
            Self::Circle { cx, cy, radius, .. } => (
                (cx - radius).into(),
                (cy - radius).into(),
                (cx + radius).into(),
                (cy + radius).into(),
            ),
        }
    }

    fn sample(&self, x: i32, y: i32) -> Option<&[u8; 3]> {
        match self {
            Self::Image { .. } => None,
            Self::Rect { fill, .. } => Some(fill),
            Self::Circle {
                cx,
                cy,
                radius,
                fill,
                ..
            } => {
                let dx = 2 * (x - i32::from(*cx)) + 1;
                let dy = 2 * (y - i32::from(*cy)) + 1;
                let diameter = 2 * i32::from(*radius);
                (dx * dx + dy * dy <= diameter * diameter).then_some(fill)
            }
        }
    }
}

pub(crate) fn payload<T: serde::de::DeserializeOwned>(
    doc: &Document,
    kind: &[u8; 4],
    limit: usize,
) -> Result<T, SceneError> {
    let chunk = doc
        .chunks
        .iter()
        .find(|chunk| &chunk.kind == kind)
        .ok_or(SceneError::MissingChunk)?;
    if chunk.data.len() > limit {
        return Err(SceneError::PayloadTooLarge);
    }
    crate::json::from_slice(&chunk.data).map_err(SceneError::InvalidJson)
}

fn validate_metadata(doc: &Document) -> Result<Metadata, SceneError> {
    let profile =
        crate::visual_profile(doc.major, doc.minor).ok_or(SceneError::UnsupportedVersion)?;
    let meta: Metadata = payload(doc, b"META", MAX_META_BYTES)?;
    if meta.profile != profile {
        return Err(SceneError::UnsupportedProfile);
    }
    if !(1..=MAX_SIDE).contains(&meta.width) || !(1..=MAX_SIDE).contains(&meta.height) {
        return Err(SceneError::InvalidCanvas);
    }
    Ok(meta)
}

/// Validate metadata, visual objects and embedded raster assets.
pub fn validate_scene(doc: &Document) -> Result<Scene, SceneError> {
    validate_profile_scene(doc, false)
}

pub(crate) fn validate_profile_scene(
    doc: &Document,
    interactive: bool,
) -> Result<Scene, SceneError> {
    let meta = validate_metadata(doc)?;
    let required: HashSet<_> = meta.required.iter().map(String::as_str).collect();
    if required.len() != meta.required.len() {
        return Err(SceneError::InvalidCapabilities);
    }
    let asset_chunk = doc.chunks.iter().find(|chunk| &chunk.kind == b"ASST");
    let has_interaction = doc.chunks.iter().any(|chunk| &chunk.kind == b"INTR");
    if required.contains("raster-png") != asset_chunk.is_some()
        || required.contains("toggle-fill") != has_interaction
    {
        return Err(SceneError::InvalidCapabilities);
    }
    if required.iter().any(|&name| match name {
        "raster-png" => false,
        "toggle-fill" => !interactive,
        _ => true,
    }) {
        return Err(SceneError::UnsupportedProfile);
    }
    let assets = match asset_chunk {
        Some(chunk) => decode_assets(&chunk.data)?,
        None => HashMap::new(),
    };
    let scene: ScenePayload = payload(doc, b"SCNE", MAX_SCENE_BYTES)?;
    if scene.objects.len() > MAX_OBJECTS {
        return Err(SceneError::TooManyObjects);
    }
    let mut ids = HashSet::new();
    for shape in &scene.objects {
        let (id, valid_bounds) = match shape {
            Shape::Image { id, asset, x, y } => {
                let raster = assets.get(asset).ok_or(SceneError::MissingAsset)?;
                (
                    id,
                    u32::from(*x) + u32::from(raster.width) <= u32::from(meta.width)
                        && u32::from(*y) + u32::from(raster.height) <= u32::from(meta.height),
                )
            }
            Shape::Rect {
                id,
                x,
                y,
                width,
                height,
                ..
            } => (
                id,
                *width > 0
                    && *height > 0
                    && u32::from(*x) + u32::from(*width) <= u32::from(meta.width)
                    && u32::from(*y) + u32::from(*height) <= u32::from(meta.height),
            ),
            Shape::Circle {
                id, cx, cy, radius, ..
            } => (
                id,
                *radius > 0
                    && cx >= radius
                    && cy >= radius
                    && u32::from(*cx) + u32::from(*radius) <= u32::from(meta.width)
                    && u32::from(*cy) + u32::from(*radius) <= u32::from(meta.height),
            ),
        };
        if !valid_id(id) {
            return Err(SceneError::InvalidObjectId);
        }
        if !ids.insert(id) {
            return Err(SceneError::DuplicateObjectId);
        }
        if !valid_bounds {
            return Err(SceneError::InvalidGeometry);
        }
    }
    Ok(Scene {
        width: meta.width,
        height: meta.height,
        background: scene.background,
        objects: scene.objects,
        assets,
    })
}

pub(crate) fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn take<'a>(bytes: &mut &'a [u8], count: usize) -> Result<&'a [u8], SceneError> {
    let (head, tail) = bytes
        .split_at_checked(count)
        .ok_or(SceneError::InvalidAssetTable)?;
    *bytes = tail;
    Ok(head)
}

fn decode_assets(mut bytes: &[u8]) -> Result<HashMap<String, Raster>, SceneError> {
    let count = u16::from_be_bytes(take(&mut bytes, 2)?.try_into().unwrap());
    if !(1..=MAX_ASSET_COUNT).contains(&usize::from(count)) {
        return Err(SceneError::InvalidAssetTable);
    }
    let mut entries = HashMap::new();
    let mut total_pixels = 0;
    for _ in 0..count {
        let id_len = usize::from(take(&mut bytes, 1)?[0]);
        let id = std::str::from_utf8(take(&mut bytes, id_len)?)
            .map_err(|_| SceneError::InvalidAssetTable)?;
        if !valid_id(id) {
            return Err(SceneError::InvalidAssetTable);
        }
        let len = u32::from_be_bytes(take(&mut bytes, 4)?.try_into().unwrap()) as usize;
        if len > MAX_PNG_BYTES {
            return Err(SceneError::PayloadTooLarge);
        }
        let png = take(&mut bytes, len)?;
        let header = png
            .strip_prefix(b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR")
            .and_then(|data| data.get(..8))
            .ok_or(SceneError::InvalidAssetImage)?;
        let side = |bytes: &[u8]| {
            let value = u32::from_be_bytes(bytes.try_into().unwrap());
            (1..=u32::from(MAX_SIDE))
                .contains(&value)
                .then_some(value as u16)
                .ok_or(SceneError::InvalidAssetImage)
        };
        let (width, height) = (side(&header[..4])?, side(&header[4..])?);
        total_pixels += usize::from(width) * usize::from(height);
        if total_pixels > 4 * 1024 * 1024 {
            return Err(SceneError::AssetBudgetExceeded);
        }
        if entries.insert(id, (png, width, height)).is_some() {
            return Err(SceneError::InvalidAssetTable);
        }
    }
    if !bytes.is_empty() {
        return Err(SceneError::InvalidAssetTable);
    }
    entries
        .into_iter()
        .map(|(id, (png, width, height))| {
            let pixels =
                decode_png(png, (width, height)).map_err(|_| SceneError::InvalidAssetImage)?;
            Ok((
                id.to_owned(),
                Raster {
                    width,
                    height,
                    pixels,
                },
            ))
        })
        .collect()
}

/// Recover a static PNG from a fully checked envelope without interpreting scene payloads.
pub fn extract_static_preview(bytes: &[u8]) -> Result<Vec<u8>, SceneError> {
    let mut doc = crate::decode_envelope(bytes, true).map_err(SceneError::Envelope)?;
    let meta = validate_metadata(&doc)?;
    decode_preview(&doc, (meta.width, meta.height))?;
    Ok(std::mem::take(&mut doc.chunks[1].data))
}

/// Check PNG framing and dimensions before handing bytes to a bounded PNG decoder.
/// Compressed image data is opaque to this preflight.
pub fn preflight_preview(doc: &Document, dimensions: (u16, u16)) -> Result<&[u8], SceneError> {
    let png = preview_bytes(doc)?;
    parse_png(png, dimensions, &mut |_| {})?;
    Ok(png)
}

fn preview_bytes(doc: &Document) -> Result<&[u8], SceneError> {
    if crate::visual_profile(doc.major, doc.minor).is_none() {
        return Err(SceneError::UnsupportedVersion);
    }
    Ok(&doc
        .chunks
        .iter()
        .find(|chunk| &chunk.kind == b"PREV")
        .ok_or(SceneError::MissingChunk)?
        .data)
}

fn parse_png(
    png: &[u8],
    dimensions: (u16, u16),
    idat: &mut impl FnMut(&[u8]),
) -> Result<(), SceneError> {
    if png.len() > MAX_PNG_BYTES {
        return Err(SceneError::PayloadTooLarge);
    }
    let mut remaining = png
        .strip_prefix(b"\x89PNG\r\n\x1a\n")
        .ok_or(SceneError::InvalidPreview)?;
    let mut data_bytes = 0;
    for index in 0..crate::MAX_CHUNKS {
        if remaining.len() < 12 {
            return Err(SceneError::InvalidPreview);
        }
        let size = u32::from_be_bytes(remaining[..4].try_into().unwrap()) as usize;
        if size > remaining.len() - 12 {
            return Err(SceneError::InvalidPreview);
        }
        let data_end = 8 + size;
        let expected = u32::from_be_bytes(remaining[data_end..data_end + 4].try_into().unwrap());
        if crate::crc32(&remaining[4..data_end]) != expected {
            return Err(SceneError::InvalidPreview);
        }
        let kind = &remaining[4..8];
        let data = &remaining[8..data_end];
        remaining = &remaining[data_end + 4..];
        match kind {
            b"IHDR" if index == 0 && data.len() == 13 => {
                let width = u32::from_be_bytes(data[..4].try_into().unwrap());
                let height = u32::from_be_bytes(data[4..8].try_into().unwrap());
                if (width, height) != (u32::from(dimensions.0), u32::from(dimensions.1))
                    || !(1..=u32::from(MAX_SIDE)).contains(&width)
                    || !(1..=u32::from(MAX_SIDE)).contains(&height)
                    || data[8..] != [8, 2, 0, 0, 0]
                {
                    return Err(SceneError::InvalidPreview);
                }
            }
            b"IDAT" if index > 0 => {
                data_bytes += size;
                idat(data);
            }
            b"IEND" if data_bytes > 0 && size == 0 && remaining.is_empty() => return Ok(()),
            _ => return Err(SceneError::InvalidPreview),
        }
    }
    Err(SceneError::InvalidPreview)
}

/// Decode an embedded preview after checking its framing, compressed stream and filters.
pub fn decode_preview(doc: &Document, dimensions: (u16, u16)) -> Result<Preview<'_>, SceneError> {
    let png = preview_bytes(doc)?;
    let rgb = decode_png(png, dimensions)?;
    Ok(Preview { png, rgb })
}

fn decode_png(png: &[u8], dimensions: (u16, u16)) -> Result<Vec<u8>, SceneError> {
    use miniz_oxide::inflate::core::{decompress, inflate_flags, DecompressorOxide};
    use miniz_oxide::inflate::TINFLStatus;

    let mut compressed = Vec::new();
    parse_png(png, dimensions, &mut |data| {
        compressed.extend_from_slice(data)
    })?;
    let stride = usize::from(dimensions.0) * 3;
    let height = usize::from(dimensions.1);
    let mut filtered = vec![0; (stride + 1) * height];
    let result = decompress(
        &mut DecompressorOxide::new(),
        &compressed,
        &mut filtered,
        0,
        inflate_flags::TINFL_FLAG_PARSE_ZLIB_HEADER
            | inflate_flags::TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF,
    );
    if result != (TINFLStatus::Done, compressed.len(), filtered.len()) {
        return Err(SceneError::InvalidPreview);
    }

    for y in 0..height {
        let row = y * (stride + 1);
        let output = y * stride;
        let filter = filtered[row];
        if filter > 4 {
            return Err(SceneError::InvalidPreview);
        }
        if filter == 0 {
            filtered.copy_within(row + 1..row + 1 + stride, output);
            continue;
        }
        // Removing one filter byte per row keeps every write behind its input byte.
        for x in 0..stride {
            let value = filtered[row + 1 + x];
            let offset = output + x;
            let left = if x >= 3 { filtered[offset - 3] } else { 0 };
            let up = if y > 0 { filtered[offset - stride] } else { 0 };
            let upper_left = if x >= 3 && y > 0 {
                filtered[offset - stride - 3]
            } else {
                0
            };
            let predictor = match filter {
                1 => left,
                2 => up,
                3 => ((u16::from(left) + u16::from(up)) / 2) as u8,
                _ => paeth(left, up, upper_left),
            };
            filtered[offset] = value.wrapping_add(predictor);
        }
    }
    filtered.truncate(stride * height);
    Ok(filtered)
}

pub struct Preview<'a> {
    pub png: &'a [u8],
    pub rgb: Vec<u8>,
}

fn paeth(left: u8, up: u8, upper_left: u8) -> u8 {
    let a = i16::from(left);
    let b = i16::from(up);
    let c = i16::from(upper_left);
    let p = a + b - c;
    let da = (p - a).abs();
    let db = (p - b).abs();
    let dc = (p - c).abs();
    if da <= db && da <= dc {
        left
    } else if db <= dc {
        up
    } else {
        upper_left
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Chunk;
    use miniz_oxide::deflate::compress_to_vec_zlib;

    #[test]
    fn static_preview_checks_crc_after_preview_even_for_unknown_critical_chunks() {
        let mut doc =
            crate::decode(include_bytes!("../../../tests/fixtures/v0.2/lamp.iimg")).unwrap();
        doc.chunks.insert(
            2,
            Chunk {
                kind: *b"xNEW",
                data: vec![42],
            },
        );
        let offset = 12
            + doc.chunks[..2]
                .iter()
                .map(|chunk| 12 + chunk.data.len())
                .sum::<usize>();
        let mut bytes = crate::encode(&doc).unwrap();
        bytes[offset + 4] = b'X';
        let checksum = crate::crc32(&bytes[offset + 4..offset + 9]);
        bytes[offset + 9..offset + 13].copy_from_slice(&checksum.to_be_bytes());

        assert_eq!(
            crate::decode(&bytes),
            Err(crate::Error::UnknownCriticalChunk)
        );
        assert_eq!(extract_static_preview(&bytes).unwrap(), doc.chunks[1].data);
        bytes[offset + 8] ^= 1;
        assert!(matches!(
            extract_static_preview(&bytes),
            Err(SceneError::Envelope(crate::Error::BadCrc))
        ));
    }

    fn preview_with(compressed: &[u8], (width, height): (u16, u16)) -> Document {
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut append = |kind: &[u8; 4], data: &[u8]| {
            png.extend((data.len() as u32).to_be_bytes());
            let start = png.len();
            png.extend(kind);
            png.extend(data);
            png.extend(crate::crc32(&png[start..]).to_be_bytes());
        };
        let mut header = [0, 0, 0, 0, 0, 0, 0, 0, 8, 2, 0, 0, 0];
        header[..4].copy_from_slice(&u32::from(width).to_be_bytes());
        header[4..8].copy_from_slice(&u32::from(height).to_be_bytes());
        append(b"IHDR", &header);
        let split = compressed.len() / 2;
        append(b"IDAT", &compressed[..split]);
        append(b"IDAT", &compressed[split..]);
        append(b"IEND", &[]);
        Document {
            major: 0,
            minor: 2,
            chunks: vec![Chunk {
                kind: *b"PREV",
                data: png,
            }],
        }
    }

    #[test]
    fn reconstructs_all_rgb_filters_across_split_idat() {
        let filtered = [
            0, 10, 20, 30, 30, 40, 50, 1, 10, 20, 30, 20, 20, 20, 2, 0, 0, 0, 0, 0, 0, 3, 5, 10,
            15, 10, 10, 10, 4, 0, 0, 0, 0, 0, 0,
        ];
        let doc = preview_with(&compress_to_vec_zlib(&filtered, 6), (2, 5));
        let preview = decode_preview(&doc, (2, 5)).unwrap();
        let mut expected = vec![10, 20, 30, 30, 40, 50];
        expected.extend([10, 20, 30, 30, 40, 50].repeat(4));
        assert_eq!(preview.rgb, expected);
    }

    #[test]
    fn reconstructs_maximum_canvas_with_overlapping_scanlines() {
        let dimensions = (MAX_SIDE, MAX_SIDE);
        let stride = usize::from(dimensions.0) * 3;
        let height = usize::from(dimensions.1);
        let mut filtered = vec![0; (stride + 1) * height];
        let penultimate = (stride + 1) * (height - 2);
        let last = penultimate + stride + 1;
        filtered[penultimate + stride - 2..last].copy_from_slice(&[240, 20, 30]);
        filtered[last] = 2;
        filtered[last + stride - 2..].copy_from_slice(&[20, 2, 3]);
        let doc = preview_with(&compress_to_vec_zlib(&filtered, 6), dimensions);
        let preview = decode_preview(&doc, dimensions).unwrap();
        let end = stride * height;
        assert_eq!(preview.rgb.len(), end);
        assert_eq!(&preview.rgb[end - stride - 3..end - stride], &[240, 20, 30]);
        assert_eq!(&preview.rgb[end - 3..], &[4, 22, 33]);
    }

    #[test]
    fn rejects_bad_zlib_size_checksum_trailing_bytes_and_filter() {
        let valid = compress_to_vec_zlib(&[0; 35], 6);
        let mut trailing = valid.clone();
        trailing.push(0);
        let mut bad_checksum = valid;
        *bad_checksum.last_mut().unwrap() ^= 1;
        let mut bad_filter = [0; 35];
        bad_filter[0] = 5;
        for compressed in [
            compress_to_vec_zlib(&[0; 34], 6),
            compress_to_vec_zlib(&[0; 36], 6),
            compress_to_vec_zlib(&bad_filter, 6),
            trailing,
            bad_checksum,
        ] {
            assert!(matches!(
                decode_preview(&preview_with(&compressed, (2, 5)), (2, 5)),
                Err(SceneError::InvalidPreview)
            ));
        }
    }
}
