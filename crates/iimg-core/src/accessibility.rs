//! Optional bounded alternative description. This never changes pixels or behavior.
use crate::{
    visual::{self, SceneError},
    Document,
};
use serde::{Deserialize, Serialize};
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Accessibility {
    pub description: String,
    pub language: String,
}
pub(crate) fn read(document: &Document) -> Result<Option<Accessibility>, SceneError> {
    if !document.chunks.iter().any(|chunk| &chunk.kind == b"aTXT") {
        return Ok(None);
    }
    let value: Accessibility = visual::payload(document, b"aTXT", 4096)?;
    let mut parts = value.language.split('-');
    let base = parts.next().unwrap_or("");
    if value.description.trim().is_empty()
        || value.description.len() > 2048
        || value.description.chars().any(|c| c.is_control())
        || value.language.len() > 35
        || !(2..=8).contains(&base.len())
        || !base.bytes().all(|c| c.is_ascii_alphabetic())
        || !parts.all(|part| {
            (1..=8).contains(&part.len()) && part.bytes().all(|c| c.is_ascii_alphanumeric())
        })
    {
        return Err(SceneError::InvalidInteraction);
    }
    Ok(Some(value))
}
