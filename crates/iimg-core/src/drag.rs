//! Discrete slider values and constrained pointer capture (RFC 0005).
use crate::{
    interaction::valid_label,
    visual::{self, Scene, SceneError},
    Document,
};
use serde::Deserialize;
use std::collections::HashSet;
#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum Axis {
    X,
    Y,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Point {
    x: u16,
    y: u16,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    #[serde(deserialize_with = "crate::json::object_list")]
    sliders: Vec<SliderPayload>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SliderPayload {
    id: String,
    target: String,
    label: String,
    axis: Axis,
    min: u16,
    max: u16,
    step: u16,
    initial: u16,
    #[serde(deserialize_with = "crate::json::object")]
    from: Point,
    #[serde(deserialize_with = "crate::json::object")]
    to: Point,
}
#[derive(Debug)]
pub(crate) struct Slider {
    pub id: String,
    pub target: String,
    pub label: String,
    pub shape: usize,
    pub min: u16,
    pub max: u16,
    pub step: u16,
    pub value: u16,
    initial: u16,
    axis: Axis,
    from: Point,
    to: Point,
}
#[derive(Debug)]
struct Capture {
    index: usize,
    original: u16,
    offset: i64,
}
#[derive(Debug)]
pub(crate) struct Drag {
    sliders: Vec<Slider>,
    capture: Option<Capture>,
}
impl Drag {
    pub fn new(
        doc: &Document,
        scene: &Scene,
        occupied: impl Fn(usize) -> bool,
    ) -> Result<Self, SceneError> {
        let payload: Payload = visual::payload(doc, b"DRAG", 32 * 1024)?;
        if !(1..=32).contains(&payload.sliders.len()) {
            return Err(SceneError::InvalidInteraction);
        }
        let mut ids = HashSet::new();
        let mut targets = HashSet::new();
        let mut sliders = Vec::new();
        for item in payload.sliders {
            let shape = scene
                .objects()
                .iter()
                .position(|shape| shape.id() == item.target)
                .ok_or(SceneError::InvalidInteraction)?;
            let aligned = match item.axis {
                Axis::X => item.from.y == item.to.y && item.from.x != item.to.x,
                Axis::Y => item.from.x == item.to.x && item.from.y != item.to.y,
            };
            if !visual::valid_id(&item.id)
                || !valid_label(&item.label)
                || !ids.insert(item.id.clone())
                || !targets.insert(shape)
                || occupied(shape)
                || item.min >= item.max
                || item.max > 1024
                || item.step == 0
                || item.initial < item.min
                || item.initial > item.max
                || (item.max - item.min) % item.step != 0
                || (item.initial - item.min) % item.step != 0
                || !aligned
                || !scene.valid_placement(shape, item.from.x, item.from.y)
                || !scene.valid_placement(shape, item.to.x, item.to.y)
            {
                return Err(SceneError::InvalidInteraction);
            }
            sliders.push(Slider {
                id: item.id,
                target: item.target,
                label: item.label,
                shape,
                min: item.min,
                max: item.max,
                step: item.step,
                value: item.initial,
                initial: item.initial,
                axis: item.axis,
                from: item.from,
                to: item.to,
            });
        }
        Ok(Self {
            sliders,
            capture: None,
        })
    }
    pub fn sliders(&self) -> impl Iterator<Item = &Slider> {
        self.sliders.iter()
    }
    pub fn valid_value(&self, index: usize, value: u16) -> bool {
        self.sliders
            .get(index)
            .is_some_and(|s| value >= s.min && value <= s.max && (value - s.min) % s.step == 0)
    }
    pub fn set(&mut self, index: usize, value: u16) -> bool {
        if !self.valid_value(index, value) {
            return false;
        }
        self.cancel();
        self.sliders[index].value = value;
        true
    }
    pub fn placement(&self, shape: usize) -> Option<(u16, u16)> {
        let s = self.sliders.iter().find(|s| s.shape == shape)?;
        let point = |a: u16, b: u16| {
            (i64::from(a)
                + (i64::from(b) - i64::from(a)) * i64::from(s.value - s.min)
                    / i64::from(s.max - s.min)) as u16
        };
        Some((point(s.from.x, s.to.x), point(s.from.y, s.to.y)))
    }
    pub fn start(&mut self, shape: usize, x: u16, y: u16) -> bool {
        if self.capture.is_some() {
            return false;
        }
        let Some(index) = self.sliders.iter().position(|s| s.shape == shape) else {
            return false;
        };
        let s = &self.sliders[index];
        let (px, py) = self.placement(shape).unwrap();
        let offset = match s.axis {
            Axis::X => i64::from(x) - i64::from(px),
            Axis::Y => i64::from(y) - i64::from(py),
        };
        self.capture = Some(Capture {
            index,
            original: s.value,
            offset,
        });
        true
    }
    pub fn move_pointer(&mut self, x: u16, y: u16) -> bool {
        let Some(capture) = &self.capture else {
            return false;
        };
        let s = &mut self.sliders[capture.index];
        let (pointer, from, to) = match s.axis {
            Axis::X => (x, s.from.x, s.to.x),
            Axis::Y => (y, s.from.y, s.to.y),
        };
        let delta = i64::from(to) - i64::from(from);
        let distance = delta.abs();
        let offset = ((i64::from(pointer) - capture.offset - i64::from(from)) * delta.signum())
            .clamp(0, distance);
        let steps = i64::from((s.max - s.min) / s.step);
        let index = (offset * steps + distance / 2) / distance;
        s.value = s.min + (index as u16) * s.step;
        true
    }
    pub fn end(&mut self) {
        self.capture = None;
    }
    pub fn cancel(&mut self) {
        if let Some(capture) = self.capture.take() {
            self.sliders[capture.index].value = capture.original;
        }
    }
    pub fn reset(&mut self) {
        self.capture = None;
        for slider in &mut self.sliders {
            slider.value = slider.initial;
        }
    }
    pub fn dragging(&self) -> bool {
        self.capture.is_some()
    }
    pub fn index(&self) -> Option<usize> {
        self.capture.as_ref().map(|capture| capture.index)
    }
    pub fn cancel_hidden(&mut self, visible: impl Fn(usize) -> bool) {
        if self
            .capture
            .as_ref()
            .is_some_and(|capture| !visible(self.sliders[capture.index].shape))
        {
            self.cancel();
        }
    }
}
