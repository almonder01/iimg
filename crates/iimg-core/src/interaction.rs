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
    AdvanceTime { milliseconds: u32 },
    MotionPreference { reduced: bool },
}

#[derive(Deserialize, Clone, Copy)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum TraceEvent {
    ActivatePixel { x: u16, y: u16 },
    FocusNext {},
    FocusPrevious {},
    ActivateFocused {},
    Reset {},
    AdvanceTime { milliseconds: u32 },
    MotionPreference { reduced: bool },
}

impl From<TraceEvent> for Event {
    fn from(event: TraceEvent) -> Self {
        match event {
            TraceEvent::ActivatePixel { x, y } => Self::ActivatePixel { x, y },
            TraceEvent::FocusNext {} => Self::FocusNext,
            TraceEvent::FocusPrevious {} => Self::FocusPrevious,
            TraceEvent::ActivateFocused {} => Self::ActivateFocused,
            TraceEvent::Reset {} => Self::Reset,
            TraceEvent::AdvanceTime { milliseconds } => Self::AdvanceTime { milliseconds },
            TraceEvent::MotionPreference { reduced } => Self::MotionPreference { reduced },
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
    actions: Vec<crate::state::Action>,
}

#[derive(Debug)]
pub struct Runtime {
    scene: Scene,
    controls: Vec<Control>,
    focus: Option<usize>,
    state: Option<crate::state::Machine>,
    motion: Option<crate::motion::Motion>,
}

pub(crate) fn valid_label(label: &str) -> bool {
    !label.trim().is_empty() && label.len() <= 256 && !label.chars().any(char::is_control)
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
        let mut clock = 0;
        for event in &trace.events {
            match *event {
                TraceEvent::AdvanceTime { milliseconds } => {
                    if self.motion.is_none()
                        || milliseconds < clock
                        || milliseconds > crate::motion::MAX_CLOCK
                    {
                        return Err(SceneError::InvalidTrace);
                    }
                    clock = milliseconds;
                }
                TraceEvent::MotionPreference { .. } if self.motion.is_none() => {
                    return Err(SceneError::InvalidTrace)
                }
                TraceEvent::Reset {} => clock = 0,
                _ => {}
            }
        }
        if let Some(motion) = &mut self.motion {
            motion.preference(false);
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
        let state = if visual::has_capability(document, "state-actions")? {
            let (state, entries) = crate::state::Machine::new(document, &scene)?;
            for entry in entries {
                controls.push(Control {
                    target: entry.target,
                    label: entry.label,
                    shape_index: entry.shape,
                    active_fill: [0, 0, 0],
                    active: false,
                    actions: entry.actions,
                });
            }
            Some(state)
        } else {
            None
        };
        if state.is_none() && document.chunks.iter().any(|chunk| &chunk.kind == b"INTR") {
            let payload: InteractionPayload = visual::payload(document, b"INTR", MAX_PAYLOAD)?;
            if !(1..=MAX_CONTROLS).contains(&payload.controls.len()) {
                return Err(SceneError::InvalidInteraction);
            }
            for control in payload.controls {
                if !valid_label(&control.label)
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
                    actions: Vec::new(),
                });
            }
        }
        let motion = if visual::has_capability(document, "motion-linear")? {
            Some(crate::motion::Motion::new(
                document,
                &scene,
                state.as_ref().ok_or(SceneError::InvalidCapabilities)?,
            )?)
        } else {
            None
        };
        Ok(Self {
            scene,
            controls,
            focus: None,
            state,
            motion,
        })
    }

    pub fn dimensions(&self) -> (u16, u16) {
        self.scene.dimensions()
    }
    /// Advance an absolute monotonic logical clock, rejecting invalid input without mutation.
    pub fn advance_time(&mut self, milliseconds: u32) -> Result<(), SceneError> {
        if self
            .motion
            .as_mut()
            .is_some_and(|motion| motion.advance(milliseconds))
        {
            Ok(())
        } else {
            Err(SceneError::InvalidTrace)
        }
    }
    pub fn set_motion_preference(&mut self, reduced: bool) {
        if let Some(motion) = &mut self.motion {
            motion.preference(reduced);
        }
    }
    pub fn has_motion(&self) -> bool {
        self.motion.is_some()
    }
    pub fn motion_running(&self) -> bool {
        self.motion.as_ref().is_some_and(|motion| motion.running())
    }
    pub fn clock_milliseconds(&self) -> u32 {
        self.motion.as_ref().map_or(0, |motion| motion.clock())
    }

    /// Target ID, accessible label and pressed state in keyboard focus order.
    pub fn controls(&self) -> impl Iterator<Item = (&str, &str, bool)> {
        self.controls.iter().map(|control| {
            (
                control.target.as_str(),
                control.label.as_str(),
                self.state
                    .as_ref()
                    .map_or(control.active, |state| state.pressed(&control.actions)),
            )
        })
    }

    pub fn focused_target(&self) -> Option<&str> {
        self.focus.map(|index| self.controls[index].target.as_str())
    }

    /// Synchronize host-managed focus with a control in the published focus order.
    pub fn focus_control(&mut self, index: Option<usize>) {
        self.focus = index.filter(|&index| self.control_visible(index));
    }

    /// Whether the control's target is visible and can receive focus/activation.
    pub fn control_visible(&self, index: usize) -> bool {
        self.controls.get(index).is_some_and(|control| {
            self.state
                .as_ref()
                .is_none_or(|state| state.visible(control.shape_index))
        })
    }

    fn activate(&mut self, index: usize) {
        if !self.control_visible(index) {
            return;
        }
        if let Some(state) = &mut self.state {
            state.apply(&self.controls[index].actions);
        } else {
            self.controls[index].active = !self.controls[index].active;
        }
        if self.focus.is_some_and(|focus| !self.control_visible(focus)) {
            self.focus = None;
        }
    }

    fn traverse(&mut self, forward: bool) {
        let count = self.controls.len();
        let origin = self.focus.unwrap_or(if forward { count - 1 } else { 0 });
        self.focus = (1..=count)
            .map(|step| {
                if forward {
                    (origin + step) % count
                } else {
                    (origin + count - step) % count
                }
            })
            .find(|&index| self.control_visible(index));
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
                if let Some(shape) = self.state.as_ref().map_or_else(
                    || self.scene.hit_test(x, y),
                    |state| {
                        self.scene.hit_test_placed(
                            x,
                            y,
                            |index| state.visible(index),
                            |index| {
                                self.motion
                                    .as_ref()
                                    .and_then(|motion| motion.placement(index))
                            },
                        )
                    },
                ) {
                    if let Some(index) = self
                        .controls
                        .iter()
                        .position(|control| control.shape_index == shape)
                    {
                        self.focus = Some(index);
                        self.activate(index);
                    }
                }
            }
            Event::FocusNext => self.traverse(true),
            Event::FocusPrevious => self.traverse(false),
            Event::ActivateFocused => {
                if let Some(index) = self.focus {
                    self.activate(index);
                }
            }
            Event::Reset => {
                self.focus = None;
                if let Some(state) = &mut self.state {
                    state.reset();
                }
                if let (Some(motion), Some(state)) = (&mut self.motion, &self.state) {
                    motion.reset(state);
                }
                for control in &mut self.controls {
                    control.active = false;
                }
            }
            Event::AdvanceTime { milliseconds } => {
                let _ = self.advance_time(milliseconds);
            }
            Event::MotionPreference { reduced } => self.set_motion_preference(reduced),
        }
        if let (Some(motion), Some(state)) = (&mut self.motion, &self.state) {
            motion.sync(state);
        }
    }

    /// Render the current state as owned row-major opaque sRGB triplets.
    ///
    /// Returns [SceneError::RenderBudgetExceeded] when shape bounding-box visits
    /// exceed the profile's work limit.
    pub fn render_rgb(&self) -> Result<Vec<u8>, SceneError> {
        if let Some(state) = &self.state {
            return self.scene.render_placed(
                |index| state.fill(index),
                |index| state.visible(index),
                |index| {
                    self.motion
                        .as_ref()
                        .and_then(|motion| motion.placement(index))
                },
            );
        }
        self.scene.render_with_fills(|shape_index| {
            self.controls
                .iter()
                .find(|control| control.shape_index == shape_index && control.active)
                .map(|control| control.active_fill)
        })
    }
}
