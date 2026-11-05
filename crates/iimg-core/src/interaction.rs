//! Deterministic toggle controls for the experimental 0.2 envelope.

use crate::visual::{self, Scene, SceneError, Shape};
use crate::Document;
use serde::Deserialize;

const MAX_CONTROLS: usize = 64;
const MAX_PAYLOAD: usize = 32 * 1024;
pub const MAX_TRACE_BYTES: usize = 64 * 1024;
const MAX_TRACE_EVENTS: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    ActivatePixel { x: u16, y: u16 },
    FocusNext,
    FocusPrevious,
    ActivateFocused,
    Reset,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum TraceEvent {
    ActivatePixel { x: u16, y: u16 },
    FocusNext {},
    FocusPrevious {},
    ActivateFocused {},
    Reset {},
}

impl From<TraceEvent> for Event {
    fn from(event: TraceEvent) -> Self {
        match event {
            TraceEvent::ActivatePixel { x, y } => Self::ActivatePixel { x, y },
            TraceEvent::FocusNext {} => Self::FocusNext,
            TraceEvent::FocusPrevious {} => Self::FocusPrevious,
            TraceEvent::ActivateFocused {} => Self::ActivateFocused,
            TraceEvent::Reset {} => Self::Reset,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Trace {
    version: u8,
    #[serde(deserialize_with = "crate::json::object_list")]
    events: Vec<TraceEvent>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ControlPayload {
    target: String,
    label: String,
    active_fill: [u8; 3],
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct InteractionPayload {
    #[serde(deserialize_with = "crate::json::object_list")]
    controls: Vec<ControlPayload>,
}

#[derive(Debug)]
struct Control {
    target: String,
    label: String,
    shape_index: usize,
    active_fill: [u8; 3],
    active: bool,
}

#[derive(Debug)]
pub struct Runtime {
    scene: Scene,
    controls: Vec<Control>,
    focus: Option<usize>,
}

impl Runtime {
    /// Replay a versioned trace from the initial state after validating it completely.
    pub fn replay(&mut self, bytes: &[u8]) -> Result<(), SceneError> {
        if bytes.len() > MAX_TRACE_BYTES {
            return Err(SceneError::InvalidTrace);
        }
        let trace: Trace = crate::json::from_slice(bytes).map_err(SceneError::InvalidJson)?;
        if trace.version != 1 || trace.events.len() > MAX_TRACE_EVENTS {
            return Err(SceneError::InvalidTrace);
        }
        self.dispatch(Event::Reset);
        for event in trace.events {
            self.dispatch(event.into());
        }
        Ok(())
    }

    /// Validate the visual scene, assets and controls and create unpressed state.
    ///
    /// Pass a document produced by [crate::decode] for envelope validation.
    /// Check the embedded preview separately with [visual::decode_preview].
    /// Rendering enforces the scene work budget when [Self::render_rgb] is called.
    pub fn new(document: &Document) -> Result<Self, SceneError> {
        let scene = visual::validate_profile_scene(document, true)?;
        let mut controls: Vec<Control> = Vec::new();
        if document.chunks.iter().any(|chunk| &chunk.kind == b"INTR") {
            let payload: InteractionPayload = visual::payload(document, b"INTR", MAX_PAYLOAD)?;
            if !(1..=MAX_CONTROLS).contains(&payload.controls.len()) {
                return Err(SceneError::InvalidInteraction);
            }
            for control in payload.controls {
                if control.label.trim().is_empty()
                    || control.label.len() > 256
                    || control.label.chars().any(char::is_control)
                    || controls.iter().any(|prior| prior.target == control.target)
                {
                    return Err(SceneError::InvalidInteraction);
                }
                let shape_index = scene
                    .objects()
                    .iter()
                    .position(|shape| match shape {
                        Shape::Rect { id, .. } | Shape::Circle { id, .. } => id == &control.target,
                        Shape::Image { .. } => false,
                    })
                    .ok_or(SceneError::InvalidInteraction)?;
                controls.push(Control {
                    target: control.target,
                    label: control.label,
                    shape_index,
                    active_fill: control.active_fill,
                    active: false,
                });
            }
        }
        Ok(Self {
            scene,
            controls,
            focus: None,
        })
    }

    pub fn dimensions(&self) -> (u16, u16) {
        self.scene.dimensions()
    }

    /// Target ID, accessible label and pressed state in keyboard focus order.
    pub fn controls(&self) -> impl Iterator<Item = (&str, &str, bool)> {
        self.controls.iter().map(|control| {
            (
                control.target.as_str(),
                control.label.as_str(),
                control.active,
            )
        })
    }

    pub fn focused_target(&self) -> Option<&str> {
        self.focus.map(|index| self.controls[index].target.as_str())
    }

    /// Synchronize host-managed focus with a control in the published focus order.
    pub fn focus_control(&mut self, index: Option<usize>) {
        self.focus = index.filter(|&index| index < self.controls.len());
    }

    /// Apply one normalized event synchronously.
    ///
    /// Pointer coordinates identify canvas pixels. Only the topmost covering
    /// shape can receive the activation, and a shape without a control blocks
    /// lower objects. Focus traversal follows control-array order.
    pub fn dispatch(&mut self, event: Event) {
        let count = self.controls.len();
        if count == 0 {
            return;
        }
        match event {
            Event::ActivatePixel { x, y } => {
                if let Some(shape) = self.scene.hit_test(x, y) {
                    if let Some(index) = self
                        .controls
                        .iter()
                        .position(|control| control.shape_index == shape)
                    {
                        self.focus = Some(index);
                        self.controls[index].active = !self.controls[index].active;
                    }
                }
            }
            Event::FocusNext => {
                self.focus = Some(self.focus.map_or(0, |index| (index + 1) % count))
            }
            Event::FocusPrevious => {
                self.focus = Some(
                    self.focus
                        .map_or(count - 1, |index| (index + count - 1) % count),
                )
            }
            Event::ActivateFocused => {
                if let Some(index) = self.focus {
                    self.controls[index].active = !self.controls[index].active;
                }
            }
            Event::Reset => {
                self.focus = None;
                for control in &mut self.controls {
                    control.active = false;
                }
            }
        }
    }

    /// Render the current state as owned row-major opaque sRGB triplets.
    ///
    /// Returns [SceneError::RenderBudgetExceeded] when shape bounding-box visits
    /// exceed the profile's work limit.
    pub fn render_rgb(&self) -> Result<Vec<u8>, SceneError> {
        self.scene.render_with_fills(|shape_index| {
            self.controls
                .iter()
                .find(|control| control.shape_index == shape_index && control.active)
                .map(|control| control.active_fill)
        })
    }
}
