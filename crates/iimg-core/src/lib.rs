//! Experimental IIMG v0.1 container. Not yet an official format.
use std::fmt;
pub const MAGIC: &[u8; 8] = b"IIMG\r\n\x1a\n";
pub const MAX_FILE: usize = 16 * 1024 * 1024;
pub const MAX_CHUNKS: usize = 1024;
pub const MAX_CHUNK: usize = 8 * 1024 * 1024;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk { pub kind: [u8;4], pub data: Vec<u8> }
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document { pub major: u8, pub minor: u8, pub chunks: Vec<Chunk> }
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error { Truncated, BadMagic, UnsupportedVersion, Oversize, TooManyChunks, BadChunkType, BadCrc, MissingEnd, TrailingBytes, BadOrdering, UnknownCriticalChunk }
impl fmt::Display for Error { fn fmt(&self,f:&mut fmt::Formatter<'_>)->fmt::Result { write!(f,"{self:?}") } }
impl std::error::Error for Error {}
fn crc32(bytes: &[u8]) -> u32 {
 let mut crc = !0u32;
 for &b in bytes { crc ^= u32::from(b); for _ in 0..8 { crc = if crc & 1 != 0 { (crc >> 1) ^ 0xedb88320 } else { crc >> 1 }; } }
 !crc
}
fn valid_kind(k:&[u8;4])->bool { k.iter().all(|b| b.is_ascii_uppercase() || b.is_ascii_lowercase()) }
fn known(k:&[u8;4])->bool { matches!(k,b"META"|b"PREV"|b"SCNE"|b"INTR"|b"ASST"|b"IEND") }
pub fn decode(buf:&[u8])->Result<Document,Error> {
 if buf.len()>MAX_FILE {return Err(Error::Oversize)}
 if buf.len()<12 {return Err(Error::Truncated)}
 if &buf[..8]!=MAGIC {return Err(Error::BadMagic)}
 let major=buf[8]; let minor=buf[9];
 if major!=0 || minor!=1 {return Err(Error::UnsupportedVersion)}
 if buf[10]!=0 || buf[11]!=0 {return Err(Error::UnsupportedVersion)}
 let mut pos=12; let mut chunks=Vec::new(); let mut seen_meta=false; let mut seen_end=false;
 while pos<buf.len() {
  if chunks.len()>=MAX_CHUNKS {return Err(Error::TooManyChunks)}
  if buf.len()-pos<12 {return Err(Error::Truncated)}
  let len=u32::from_be_bytes(buf[pos..pos+4].try_into().unwrap()) as usize;
  let kind:[u8;4]=buf[pos+4..pos+8].try_into().unwrap();
  if !valid_kind(&kind) {return Err(Error::BadChunkType)}
  if len>MAX_CHUNK {return Err(Error::Oversize)}
  let end=pos.checked_add(12).and_then(|x|x.checked_add(len)).ok_or(Error::Oversize)?;
  if end>buf.len() {return Err(Error::Truncated)}
  let data=&buf[pos+8..pos+8+len];
  let expected=u32::from_be_bytes(buf[pos+8+len..end].try_into().unwrap());
  if crc32(&buf[pos+4..pos+8+len])!=expected {return Err(Error::BadCrc)}
  if !known(&kind) && kind[0].is_ascii_uppercase() {return Err(Error::UnknownCriticalChunk)}
  if chunks.is_empty() && &kind!=b"META" {return Err(Error::BadOrdering)}
  if &kind==b"META" {if seen_meta {return Err(Error::BadOrdering)} seen_meta=true;}
  if &kind==b"IEND" {if len!=0 {return Err(Error::BadOrdering)} seen_end=true; if end!=buf.len(){return Err(Error::TrailingBytes)}}
  chunks.push(Chunk{kind,data:data.to_vec()}); pos=end;
  if seen_end {break}
 }
 if !seen_meta || !seen_end {return Err(Error::MissingEnd)}
 Ok(Document{major,minor,chunks})
}
pub fn encode(doc:&Document)->Result<Vec<u8>,Error> {
 if doc.major!=0 || doc.minor!=1 {return Err(Error::UnsupportedVersion)}
 if doc.chunks.len()>MAX_CHUNKS {return Err(Error::TooManyChunks)}
 if doc.chunks.first().map(|c|&c.kind)!=Some(b"META") || doc.chunks.last().map(|c|&c.kind)!=Some(b"IEND") {return Err(Error::BadOrdering)}
 let mut out=MAGIC.to_vec(); out.extend_from_slice(&[doc.major,doc.minor,0,0]);
 for c in &doc.chunks {
  if c.data.len()>MAX_CHUNK {return Err(Error::Oversize)}
  if !valid_kind(&c.kind) {return Err(Error::BadChunkType)}
  out.extend_from_slice(&(c.data.len() as u32).to_be_bytes());out.extend_from_slice(&c.kind);out.extend_from_slice(&c.data);
  let crc=crc32(&out[out.len()-c.data.len()-4..]);out.extend_from_slice(&crc.to_be_bytes());
  if out.len()>MAX_FILE {return Err(Error::Oversize)}
 }
 decode(&out)?; Ok(out)
}
pub fn sample()->Document {
 Document {major:0,minor:1,chunks:vec![
 Chunk{kind:*b"META",data:br#"{"width":320,"height":180,"title":"Hello IIMG"}"#.to_vec()},
 Chunk{kind:*b"SCNE",data:br#"{"objects":[{"id":"lamp","type":"circle","cx":160,"cy":90,"r":40}]}"#.to_vec()},
 Chunk{kind:*b"INTR",data:br#"{"initial":{"lamp":"off"},"events":[{"on":"tap","target":"lamp","action":"toggle","state":"lamp"}]}"#.to_vec()},
 Chunk{kind:*b"IEND",data:vec![]}
 ]}
}
#[cfg(test)] mod tests {
 use super::*;
 #[test] fn round_trip(){let s=sample();assert_eq!(decode(&encode(&s).unwrap()).unwrap(),s);}
 #[test] fn corruption(){let mut b=encode(&sample()).unwrap();b[25]^=1;assert_eq!(decode(&b),Err(Error::BadCrc));}
 #[test] fn truncated(){let b=encode(&sample()).unwrap();for n in 0..b.len(){assert!(decode(&b[..n]).is_err());}}
 #[test] fn trailing(){let mut b=encode(&sample()).unwrap();b.push(0);assert_eq!(decode(&b),Err(Error::TrailingBytes));}
 #[test] fn unknown_critical(){let mut s=sample();s.chunks.insert(1,Chunk{kind:*b"XXXX",data:vec![]});assert_eq!(encode(&s),Err(Error::UnknownCriticalChunk));}
 #[test] fn unknown_ancillary(){let mut s=sample();s.chunks.insert(1,Chunk{kind:*b"xABC",data:vec![]});assert!(decode(&encode(&s).unwrap()).is_ok());}
}
