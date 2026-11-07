//! Finite integer-clock motion; see RFC 0004.
use crate::{
    state::Machine,
    visual::{self, Scene, SceneError},
    Document,
};
use serde::Deserialize;
use std::collections::HashSet;
pub const MAX_CLOCK: u32 = 86_400_000;
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Point {
    x: u16,
    y: u16,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrackPayload {
    target: String,
    state: String,
    equals: u8,
    duration_ms: u32,
    repeat: u8,
    #[serde(deserialize_with = "crate::json::object")]
    from: Point,
    #[serde(deserialize_with = "crate::json::object")]
    to: Point,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    #[serde(deserialize_with = "crate::json::object_list")]
    tracks: Vec<TrackPayload>,
}
#[derive(Debug)]
struct Track {
    shape: usize,
    state: usize,
    expected: u8,
    duration: u32,
    total: u32,
    from: Point,
    to: Point,
    active: bool,
    origin: u32,
}
#[derive(Debug)]
pub(crate) struct Motion {
    tracks: Vec<Track>,
    clock: u32,
    reduced: bool,
}
impl Motion {
    pub fn owns(&self, shape: usize) -> bool {
        self.tracks.iter().any(|track| track.shape == shape)
    }
    pub fn new(document: &Document, scene: &Scene, state: &Machine) -> Result<Self, SceneError> {
        let payload: Payload = visual::payload(document, b"MOTN", 32 * 1024)?;
        if !(1..=64).contains(&payload.tracks.len()) {
            return Err(SceneError::InvalidInteraction);
        }
        let mut targets = HashSet::new();
        let mut tracks = Vec::new();
        for entry in payload.tracks {
            let shape = scene
                .objects()
                .iter()
                .position(|shape| shape.id() == entry.target)
                .ok_or(SceneError::InvalidInteraction)?;
            let (variable, maximum) = state
                .definition(&entry.state)
                .ok_or(SceneError::InvalidInteraction)?;
            if !targets.insert(shape)
                || entry.equals > maximum
                || !(1..=60_000).contains(&entry.duration_ms)
                || !(1..=16).contains(&entry.repeat)
                || entry.duration_ms * u32::from(entry.repeat) > 600_000
                || !scene.valid_placement(shape, entry.from.x, entry.from.y)
                || !scene.valid_placement(shape, entry.to.x, entry.to.y)
            {
                return Err(SceneError::InvalidInteraction);
            }
            tracks.push(Track {
                shape,
                state: variable,
                expected: entry.equals,
                duration: entry.duration_ms,
                total: entry.duration_ms * u32::from(entry.repeat),
                from: entry.from,
                to: entry.to,
                active: state.value(variable) == entry.equals,
                origin: 0,
            });
        }
        Ok(Self {
            tracks,
            clock: 0,
            reduced: false,
        })
    }
    pub fn sync(&mut self, state: &Machine) {
        for track in &mut self.tracks {
            let active = state.value(track.state) == track.expected;
            if active && !track.active {
                track.origin = self.clock;
            }
            track.active = active;
        }
    }
    pub fn advance(&mut self, milliseconds: u32) -> bool {
        if milliseconds < self.clock || milliseconds > MAX_CLOCK {
            return false;
        }
        self.clock = milliseconds;
        true
    }
    pub fn clock(&self) -> u32 {
        self.clock
    }
    pub fn preference(&mut self, reduced: bool) {
        self.reduced = reduced;
    }
    pub fn reset(&mut self, state: &Machine) {
        self.clock = 0;
        for track in &mut self.tracks {
            track.origin = 0;
            track.active = state.value(track.state) == track.expected;
        }
    }
    pub fn running(&self) -> bool {
        !self.reduced
            && self.clock < MAX_CLOCK
            && self
                .tracks
                .iter()
                .any(|track| track.active && self.clock - track.origin < track.total)
    }
    pub fn placement(&self, index: usize) -> Option<(u16, u16)> {
        let track = self
            .tracks
            .iter()
            .find(|track| track.shape == index && track.active)?;
        let elapsed = self.clock - track.origin;
        if self.reduced || self.clock == MAX_CLOCK || elapsed >= track.total {
            return Some((track.to.x, track.to.y));
        }
        let phase = i64::from(elapsed % track.duration);
        let coordinate = |from, to| {
            (i64::from(from)
                + (i64::from(to) - i64::from(from)) * phase / i64::from(track.duration))
                as u16
        };
        Some((
            coordinate(track.from.x, track.to.x),
            coordinate(track.from.y, track.to.y),
        ))
    }
}
