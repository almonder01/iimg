//! Bounded, synchronous state groups for the state-actions capability.
use crate::visual::{self, Scene, SceneError, Shape};
use crate::Document;
use serde::Deserialize;
use std::collections::HashSet;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Variable {
    id: String,
    initial: u8,
    max: u8,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum ActionPayload {
    Cycle { state: String },
    Set { state: String, value: u8 },
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ControlPayload {
    target: String,
    label: String,
    #[serde(deserialize_with = "crate::json::object_list")]
    actions: Vec<ActionPayload>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Style {
    visible: bool,
    fill: Option<[u8; 3]>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BindingPayload {
    target: String,
    state: String,
    #[serde(deserialize_with = "crate::json::object_list")]
    values: Vec<Style>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    #[serde(deserialize_with = "crate::json::object_list")]
    states: Vec<Variable>,
    #[serde(deserialize_with = "crate::json::object_list")]
    controls: Vec<ControlPayload>,
    #[serde(deserialize_with = "crate::json::object_list")]
    bindings: Vec<BindingPayload>,
}
#[derive(Debug)]
pub(crate) struct Action {
    state: usize,
    value: Option<u8>,
}
#[derive(Debug)]
pub(crate) struct ActionControl {
    pub target: String,
    pub label: String,
    pub shape: usize,
    pub actions: Vec<Action>,
}
#[derive(Debug)]
struct Binding {
    state: usize,
    values: Vec<Style>,
}
#[derive(Debug)]
pub(crate) struct Machine {
    states: Vec<Variable>,
    values: Vec<u8>,
    bindings: Vec<Option<Binding>>,
}

impl Machine {
    pub fn new(
        document: &Document,
        scene: &Scene,
    ) -> Result<(Self, Vec<ActionControl>), SceneError> {
        let payload: Payload = visual::payload(document, b"STAC", 32 * 1024)?;
        let invalid = || SceneError::InvalidInteraction;
        if !(1..=32).contains(&payload.states.len())
            || !(1..=64).contains(&payload.controls.len())
            || payload.bindings.len() > 256
        {
            return Err(invalid());
        }
        let mut names = HashSet::new();
        for state in &payload.states {
            if !visual::valid_id(&state.id)
                || !names.insert(state.id.as_str())
                || !(1..=15).contains(&state.max)
                || state.initial > state.max
            {
                return Err(invalid());
            }
        }
        let state_index = |name: &str| {
            payload
                .states
                .iter()
                .position(|s| s.id == name)
                .ok_or_else(invalid)
        };
        let shape_index = |name: &str| {
            scene
                .objects()
                .iter()
                .position(|s| s.id() == name)
                .ok_or_else(invalid)
        };
        let mut controls = Vec::new();
        let mut targets = HashSet::new();
        for control in payload.controls {
            let shape = shape_index(&control.target)?;
            if !targets.insert(control.target.clone())
                || !super::interaction::valid_label(&control.label)
                || !(1..=8).contains(&control.actions.len())
            {
                return Err(invalid());
            }
            let mut written = HashSet::new();
            let mut actions = Vec::new();
            for action in control.actions {
                let (name, value) = match action {
                    ActionPayload::Cycle { state } => (state, None),
                    ActionPayload::Set { state, value } => (state, Some(value)),
                };
                let state = state_index(&name)?;
                if !written.insert(state) || value.is_some_and(|v| v > payload.states[state].max) {
                    return Err(invalid());
                }
                actions.push(Action { state, value });
            }
            controls.push(ActionControl {
                target: control.target,
                label: control.label,
                shape,
                actions,
            });
        }
        let mut bindings: Vec<Option<Binding>> = (0..scene.objects().len()).map(|_| None).collect();
        for binding in payload.bindings {
            let shape = shape_index(&binding.target)?;
            let state = state_index(&binding.state)?;
            if bindings[shape].is_some()
                || binding.values.len() != usize::from(payload.states[state].max) + 1
                || (matches!(scene.objects()[shape], Shape::Image { .. })
                    && binding.values.iter().any(|v| v.fill.is_some()))
            {
                return Err(invalid());
            }
            bindings[shape] = Some(Binding {
                state,
                values: binding.values,
            });
        }
        let values = payload.states.iter().map(|s| s.initial).collect();
        Ok((
            Self {
                states: payload.states,
                values,
                bindings,
            },
            controls,
        ))
    }
    pub fn apply(&mut self, actions: &[Action]) {
        for action in actions {
            self.values[action.state] = action.value.unwrap_or_else(|| {
                (self.values[action.state] + 1) % (self.states[action.state].max + 1)
            });
        }
    }
    pub fn reset(&mut self) {
        for (value, state) in self.values.iter_mut().zip(&self.states) {
            *value = state.initial;
        }
    }
    pub fn pressed(&self, actions: &[Action]) -> bool {
        actions
            .iter()
            .any(|a| self.values[a.state] != self.states[a.state].initial)
    }
    fn style(&self, shape: usize) -> Option<&Style> {
        self.bindings[shape]
            .as_ref()
            .map(|b| &b.values[usize::from(self.values[b.state])])
    }
    pub fn visible(&self, shape: usize) -> bool {
        self.style(shape).is_none_or(|s| s.visible)
    }
    pub fn fill(&self, shape: usize) -> Option<[u8; 3]> {
        self.style(shape).and_then(|s| s.fill)
    }
}
