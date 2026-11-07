# RFC 0003: bounded declarative state actions

Status: implemented draft for review, opt-in Core 1.0 capability `state-actions`. It does not change `toggle-fill` or experimental 0.2 semantics. The owner requested technical implementation before the later independent/manual acceptance gates; this draft is not externally approved.

## Wire and source

A new critical `STAC` chunk carries state actions and requires `state-actions` in META. Historical `INTR` and `toggle-fill` remain unchanged. STAC and INTR are mutually exclusive and occupy the same slot after SCNE/optional ASST and before IEND. State actions require Core 1.0. Older full readers reject the unknown critical chunk, but their established preview path can extract the validated mandatory initial PNG from the understood envelope/profile. Reusing INTR would make older readers diagnose invalid known content and prevent that fallback; the distinct chunk is intentional. Authors using the new payload must export Core 1.0; 0.2 export fails explicitly.

```
{
  "states": [{"id":"panel","initial":0,"max":1}],
  "controls": [{"target":"switch","label":"Show panel",
    "actions":[{"type":"cycle","state":"panel"}]}],
  "bindings": [{"target":"panelShape","state":"panel","values":[
    {"visible":false}, {"visible":true,"fill":[255,200,0]}
  ]}]
}
```

All objects use named fields, exact schemas, integer tokens and existing strict JSON rules. STAC is at most 32 KiB. There are 1–32 unique ASCII state IDs, each with maximum 1–15 and initial value 0–maximum; 1–64 controls with unique existing scene targets and existing label rules; 0–256 bindings with unique existing targets. A binding references one state and has exactly maximum+1 style values. `visible` is required boolean; `fill` is an optional RGB8 override (null is equivalent to absent). Image bindings cannot override fill. No geometry change is introduced by this capability.

Each control has 1–8 actions. `cycle` advances a referenced state modulo maximum+1. `set` assigns a validated integer `value` in that range. A control cannot write the same state twice. State/control/binding references must resolve before execution. Controls may target images because actions need not change their target fill. Events cannot trigger events, run scripts, perform I/O or schedule work, so there are no action-recursion cycles. An activation computes its entire bounded group without rendering or dispatch between actions; observers see only the final state.

## Rendering, hit testing and focus

Unbound objects remain visible with their original fill. Bound objects use the current state's indexed style. Invisible objects are neither drawn nor hit-test blockers. An object's hidden control cannot be focused/activated, and traversal skips it; when an action hides the focused target, focus clears. Hosts hide corresponding semantic buttons as well. Reset restores every state's declared initial value and clears focus. A state control reports pressed when any state it writes differs from that state's initial value; this is a summary, not the current numeric value.

The visual work budget still counts all objects, including currently hidden ones, so an initial hidden scene cannot evade the worst-case render budget. Assets are decoded/validated under the existing aggregate bounds. Binding lookup is indexed by validated scene position. All existing normalized activation/focus/reset trace events retain their encoding and synchronous order. Initial preview generation uses the declared initial state.

## Acceptance

Native/WASM and the separately coded Python evaluator must agree on initial/active/reset pixels, grouped actions, hidden-object pass-through, focus skipping/clearing and cycle wraparound. Reject duplicate IDs/targets/writes, dangling references, invalid styles/labels/ranges/counts and wrong capability declarations. Compare an old reader's full rejection and static-preview extraction. Add compiler/schema/editor support without allowing legacy editor operations to erase a state machine. Motion, continuous values and dragging are separate capability proposals.
