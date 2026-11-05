# IIMG 0.2 toggle interaction draft

Declare `toggle-fill` in `META.required` and add exactly one `INTR` chunk. The capability may appear alongside `raster-png`. A file without the capability omits `INTR`. Preview-only readers treat the chunk as opaque.

`INTR` is UTF-8 JSON of at most 32 KiB. It contains exactly one `controls` field with an ordered array of 1–64 control objects. Each object contains exactly these fields.

| Field | Meaning |
| --- | --- |
| `target` | ID of an existing rectangle or circle. Targets are unique within the controls array. |
| `label` | Accessible name. It is nonempty after trimming Unicode whitespace, has at most 256 UTF-8 bytes and contains no control characters. |
| `active_fill` | Three integer sRGB channels in 0–255. |

All controls start unpressed and the document starts without focus. A pressed control replaces its target's original fill with `active_fill`. Shape geometry, stacking and hit areas stay fixed. Expose each control to assistive technology as a toggle button with its label and pressed state.

## Normalized events

| Event | Effect |
| --- | --- |
| Activate pixel | Sample the indicated canvas pixel center. The topmost covering object receives the hit. If it has a control, focus it and invert its pressed state. A hit on the background or an object without a control leaves the state unchanged. Mouse clicks and touch taps map to this same event. |
| Focus next / previous | Move focus in control-array order with wraparound. From no focus, next selects the first control and previous selects the last. |
| Activate focused | Invert the pressed state of the focused control, if present. A host can map keyboard activation keys and accessibility activation to this event. |
| Reset | Clear focus and set every control to unpressed. |

The runtime applies each event synchronously in dispatch order. One activation changes at most one control. Input events cannot enqueue more events or perform I/O. A host should dispatch one activation for each completed gesture or keyboard action.

## Portable replay traces

A trace is an external UTF-8 JSON object containing `version` with integer value 1 and `events` with an array of at most 1024 event objects. The entire file is limited to 64 KiB. Each event has a `type` of `activate_pixel`, `focus_next`, `focus_previous`, `activate_focused` or `reset`. Only `activate_pixel` has additional fields, `x` and `y`, both unsigned 16-bit integers. Unknown fields and event types are invalid.

The root trace and each event require JSON objects with named fields. Numeric tokens follow the [visual profile's unsigned integer rules](IIMG-0.2-visual.md#metadata-and-scene).

Replay validates the whole trace before changing runtime state, resets the runtime, then applies the events in order. The two-control fixture includes [pointer](../tests/fixtures/v0.2/two-controls-pointer.json) and [keyboard](../tests/fixtures/v0.2/two-controls-keyboard.json) traces that reach the same state and frame.

```sh
cargo run --locked -p iimg-cli -- replay tests/fixtures/v0.2/two-controls.iimg tests/fixtures/v0.2/two-controls-keyboard.json final.ppm
```

The [independently generated fixture](../tests/fixtures/v0.2/interactive-lamp.iimg) contains a lamp with one toggle control. Pointer and keyboard traces produce identical active pixels. The initial and reset frames match the embedded PNG.
