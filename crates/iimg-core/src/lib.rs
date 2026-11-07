//! IIMG candidate parsing, visual validation, authoring and interaction.
//!
//! Decode a bounded byte buffer with [decode], build an [interaction::Runtime],
//! and validate its preview with [visual::decode_preview]. Rendered frames are
//! opaque sRGB bytes in row-major RGB order.
//!
//! ```
//! use iimg_core::{author, decode, interaction::{Event, Runtime}, visual};
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! let source = br#"{
//!   "width": 2, "height": 2,
//!   "scene": {
//!     "background": [0, 0, 0],
//!     "objects": [
//!       {"type":"rect","id":"lamp","x":0,"y":0,"width":2,"height":2,"fill":[255,200,0]}
//!     ]
//!   },
//!   "interaction": {
//!     "controls": [{"target":"lamp","label":"Lamp","active_fill":[0,200,255]}]
//!   }
//! }"#;
//! let bytes = author::compile_v1(source)?;
//! let document = decode(&bytes)?;
//! let mut runtime = Runtime::new(&document)?;
//! let preview = visual::decode_preview(&document, runtime.dimensions())?;
//! assert_eq!(runtime.render_rgb()?, preview.rgb);
//!
//! runtime.dispatch(Event::ActivatePixel { x: 0, y: 0 });
//! assert_eq!(&runtime.render_rgb()?[..3], &[0, 200, 255]);
//! assert_eq!(runtime.controls().next(), Some(("lamp", "Lamp", true)));
//!
//! runtime.replay(br#"{"version":1,"events":[{"type":"reset"}]}"#)?;
//! assert_eq!(runtime.render_rgb()?, preview.rgb);
//! assert!(visual::extract_static_preview(&bytes)?.starts_with(b"\x89PNG\r\n\x1a\n"));
//! # Ok(())
//! # }
//! ```
//!
//! Hosts enforce stream limits before allocating file contents and map their
//! pointer, keyboard and accessibility actions into normalized events. Consult
//! [Error] and [visual::SceneError] for structured failures. The SDK and wire
//! profile remain candidates under review.
use std::fmt;

pub mod author;
mod drag;
pub mod interaction;
mod json;
mod motion;
mod state;
pub mod visual;
pub const MAGIC: &[u8; 8] = b"IIMG\r\n\x1a\n";
pub const MAX_FILE: usize = 16 * 1024 * 1024;
pub const MAX_CHUNKS: usize = 1024;
pub const MAX_CHUNK: usize = 8 * 1024 * 1024;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub kind: [u8; 4],
    pub data: Vec<u8>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document {
    pub major: u8,
    pub minor: u8,
    pub chunks: Vec<Chunk>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Truncated,
    BadMagic,
    UnsupportedVersion,
    Oversize,
    TooManyChunks,
    BadChunkType,
    BadCrc,
    MissingEnd,
    TrailingBytes,
    BadOrdering,
    UnknownCriticalChunk,
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for Error {}
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in bytes {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xedb88320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}
fn valid_kind(k: &[u8; 4]) -> bool {
    k.iter()
        .all(|b| b.is_ascii_uppercase() || b.is_ascii_lowercase())
}
fn known(k: &[u8; 4]) -> bool {
    matches!(
        k,
        b"META" | b"PREV" | b"SCNE" | b"INTR" | b"STAC" | b"MOTN" | b"DRAG" | b"ASST" | b"IEND"
    )
}

fn check_chunk(
    kind: &[u8; 4],
    len: usize,
    first: bool,
    last: bool,
    preview_only: bool,
) -> Result<(), Error> {
    if !preview_only && !known(kind) && kind[0].is_ascii_uppercase() {
        return Err(Error::UnknownCriticalChunk);
    }
    if (kind == b"META") != first || (kind == b"IEND" && len != 0) {
        return Err(Error::BadOrdering);
    }
    if kind == b"IEND" && !last {
        return Err(Error::TrailingBytes);
    }
    Ok(())
}

fn check_visual_order(chunks: &[Chunk]) -> Result<(), Error> {
    if chunks.get(1).map(|chunk| &chunk.kind) != Some(b"PREV") {
        return Err(Error::BadOrdering);
    }
    let mut stage = 0;
    for chunk in &chunks[2..] {
        stage = match &chunk.kind {
            b"SCNE" if stage == 0 => 1,
            b"ASST" if stage == 1 => 2,
            b"INTR" | b"STAC" if (1..=2).contains(&stage) => 3,
            b"MOTN" if stage == 3 => 4,
            b"DRAG" if (1..=4).contains(&stage) => 5,
            b"IEND" if stage > 0 => return Ok(()),
            kind if !known(kind) => stage,
            _ => return Err(Error::BadOrdering),
        };
    }
    Err(Error::MissingEnd)
}

/// Validate the complete envelope and copy its chunks into an owned document.
///
/// Enforces [MAX_FILE], [MAX_CHUNK], [MAX_CHUNKS], framing, versions, ordering
/// and CRCs. Unknown critical chunks are rejected. Visual payload validation
/// is provided by [interaction::Runtime::new] and [visual::decode_preview].
pub fn decode(buf: &[u8]) -> Result<Document, Error> {
    decode_envelope(buf, false)
}

pub(crate) fn visual_profile(major: u8, minor: u8) -> Option<&'static str> {
    match (major, minor) {
        (0, 2) => Some("iimg-visual-0.2"),
        (1, 0) => Some("iimg-core-1"),
        _ => None,
    }
}

fn decode_envelope(buf: &[u8], preview_only: bool) -> Result<Document, Error> {
    if buf.len() > MAX_FILE {
        return Err(Error::Oversize);
    }
    if buf.len() < 12 {
        return Err(Error::Truncated);
    }
    if &buf[..8] != MAGIC {
        return Err(Error::BadMagic);
    }
    let major = buf[8];
    let minor = buf[9];
    let visual = visual_profile(major, minor).is_some();
    if !visual && (major, minor) != (0, 1) {
        return Err(Error::UnsupportedVersion);
    }
    if buf[10] != 0 || buf[11] != 0 {
        return Err(Error::UnsupportedVersion);
    }
    let mut pos = 12;
    let mut chunks = Vec::new();
    let mut seen_end = false;
    while pos < buf.len() {
        if chunks.len() >= MAX_CHUNKS {
            return Err(Error::TooManyChunks);
        }
        if buf.len() - pos < 12 {
            return Err(Error::Truncated);
        }
        let len = u32::from_be_bytes(buf[pos..pos + 4].try_into().unwrap()) as usize;
        let kind: [u8; 4] = buf[pos + 4..pos + 8].try_into().unwrap();
        if !valid_kind(&kind) {
            return Err(Error::BadChunkType);
        }
        if len > MAX_CHUNK {
            return Err(Error::Oversize);
        }
        let end = pos
            .checked_add(12)
            .and_then(|x| x.checked_add(len))
            .ok_or(Error::Oversize)?;
        if end > buf.len() {
            return Err(Error::Truncated);
        }
        let data = &buf[pos + 8..pos + 8 + len];
        let expected = u32::from_be_bytes(buf[pos + 8 + len..end].try_into().unwrap());
        if crc32(&buf[pos + 4..pos + 8 + len]) != expected {
            return Err(Error::BadCrc);
        }
        check_chunk(
            &kind,
            len,
            chunks.is_empty(),
            end == buf.len(),
            preview_only && visual,
        )?;
        seen_end = &kind == b"IEND";
        chunks.push(Chunk {
            kind,
            data: data.to_vec(),
        });
        pos = end;
        if seen_end {
            break;
        }
    }
    if !seen_end {
        return Err(Error::MissingEnd);
    }
    if visual {
        check_visual_order(&chunks)?;
    }
    Ok(Document {
        major,
        minor,
        chunks,
    })
}
/// Check envelope structure and bounds, then serialize chunks with fresh CRCs.
///
/// The payload bytes are preserved. Use [author::compile_v1] to create a
/// document from validated source and generate its initial preview.
pub fn encode(doc: &Document) -> Result<Vec<u8>, Error> {
    let visual = visual_profile(doc.major, doc.minor).is_some();
    if !visual && (doc.major, doc.minor) != (0, 1) {
        return Err(Error::UnsupportedVersion);
    }
    if doc.chunks.len() > MAX_CHUNKS {
        return Err(Error::TooManyChunks);
    }
    if doc.chunks.first().map(|c| &c.kind) != Some(b"META")
        || doc.chunks.last().map(|c| &c.kind) != Some(b"IEND")
    {
        return Err(Error::BadOrdering);
    }
    let mut size = 12;
    for (index, c) in doc.chunks.iter().enumerate() {
        if c.data.len() > MAX_CHUNK {
            return Err(Error::Oversize);
        }
        if !valid_kind(&c.kind) {
            return Err(Error::BadChunkType);
        }
        size += 12 + c.data.len();
        if size > MAX_FILE {
            return Err(Error::Oversize);
        }
        check_chunk(
            &c.kind,
            c.data.len(),
            index == 0,
            index + 1 == doc.chunks.len(),
            false,
        )?;
    }
    if visual {
        check_visual_order(&doc.chunks)?;
    }

    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&[doc.major, doc.minor, 0, 0]);
    for c in &doc.chunks {
        out.extend_from_slice(&(c.data.len() as u32).to_be_bytes());
        out.extend_from_slice(&c.kind);
        out.extend_from_slice(&c.data);
        let crc = crc32(&out[out.len() - c.data.len() - 4..]);
        out.extend_from_slice(&crc.to_be_bytes());
    }
    Ok(out)
}
pub fn sample() -> Document {
    Document {major:0,minor:1,chunks:vec![
 Chunk{kind:*b"META",data:br#"{"width":320,"height":180,"title":"Hello IIMG"}"#.to_vec()},
 Chunk{kind:*b"SCNE",data:br#"{"objects":[{"id":"lamp","type":"circle","cx":160,"cy":90,"r":40}]}"#.to_vec()},
 Chunk{kind:*b"INTR",data:br#"{"initial":{"lamp":"off"},"events":[{"on":"tap","target":"lamp","action":"toggle","state":"lamp"}]}"#.to_vec()},
 Chunk{kind:*b"IEND",data:vec![]}
 ]}
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crc32_standard_vector() {
        assert_eq!(crc32(b"123456789"), 0xcbf43926);
    }
    #[test]
    fn checked_in_sample() {
        let bytes = include_bytes!("../../../examples/hello.iimg");
        let decoded = decode(bytes).unwrap();
        assert_eq!(decoded, sample());
        assert_eq!(encode(&sample()).unwrap(), bytes);
    }
    #[test]
    fn encode_rejects_oversized_document_with_valid_chunk_lengths() {
        let mut doc = sample();
        for _ in 0..2 {
            doc.chunks.insert(
                1,
                Chunk {
                    kind: *b"xABC",
                    data: vec![0; MAX_CHUNK],
                },
            );
        }
        assert_eq!(encode(&doc), Err(Error::Oversize));
    }
    #[test]
    fn encode_rejects_duplicate_meta_and_nonempty_end() {
        let mut doc = sample();
        doc.chunks.insert(1, doc.chunks[0].clone());
        assert_eq!(encode(&doc), Err(Error::BadOrdering));
        doc.chunks.remove(1);
        doc.chunks.last_mut().unwrap().data.push(0);
        assert_eq!(encode(&doc), Err(Error::BadOrdering));
    }
    #[test]
    fn round_trip() {
        let s = sample();
        assert_eq!(decode(&encode(&s).unwrap()).unwrap(), s);
    }
    #[test]
    fn corruption() {
        let mut b = encode(&sample()).unwrap();
        b[25] ^= 1;
        assert_eq!(decode(&b), Err(Error::BadCrc));
    }
    #[test]
    fn truncated() {
        let b = encode(&sample()).unwrap();
        for n in 0..b.len() {
            assert!(decode(&b[..n]).is_err());
        }
    }
    #[test]
    fn trailing() {
        let mut b = encode(&sample()).unwrap();
        b.push(0);
        assert_eq!(decode(&b), Err(Error::TrailingBytes));
    }
    #[test]
    fn unknown_critical() {
        let mut s = sample();
        s.chunks.insert(
            1,
            Chunk {
                kind: *b"XXXX",
                data: vec![],
            },
        );
        assert_eq!(encode(&s), Err(Error::UnknownCriticalChunk));
    }
    #[test]
    fn unknown_ancillary() {
        let mut s = sample();
        s.chunks.insert(
            1,
            Chunk {
                kind: *b"xABC",
                data: vec![],
            },
        );
        assert!(decode(&encode(&s).unwrap()).is_ok());
    }
}
