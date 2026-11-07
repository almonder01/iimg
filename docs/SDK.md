# Integrate the IIMG candidate SDK

The reference SDK consists of the Rust core and a WebAssembly host adapter. The SDK version is currently 0.1.0. Wire version 1.0 is a candidate under review, alongside the separately identified 0.2 draft and historical 0.1 container. The [candidate specification](../spec/IIMG-1.0-candidate.md) defines portable file behavior. Use the [conformance suite](../tests/README.md) when implementing another reader.

The [JSON schemas](../spec/schemas/README.md) support editor integration and structural checks. Complete readers enforce the lexical, resource and semantic rules documented there.

Draft DRAG adds `drag_start(x,y)`, `drag_move(x,y)`, `drag_end()`, `drag_cancel()`, `set_slider_value(index,value)`, `sliders()` and `drag_index()`. Invalid direct values are atomic. WASM start/move/set return 0 on acceptance and 1 on invalid/unavailable input; coordinates are checked before narrowing to 16 bits. `describe()` exposes named visible ranges and the active index. Hosts normalize/clamp coordinates, track capture, cancel on blur/background/unload and provide real range controls. See RFC 0005.

Draft optional aTXT is available through `Runtime::accessibility()` and `describe().accessibility`. Use literal text/attribute APIs; metadata is untrusted. Reset descriptions/languages on unload. Source-only text hints are not runtime editable text or font data; RFC 0006 specifies author-side rasterization.

Draft MOTN uses `Runtime::advance_time(milliseconds)`, `set_motion_preference(reduced)`, `has_motion()`, `motion_running()` and `clock_milliseconds()`. Invalid direct clocks return an error without mutation; replay validates all clocks before reset/execution. WASM exports `advance_time` and `motion_preference` with 0=success/1=invalid or unavailable, and `motion_running` as 0/1. `describe()` adds motion/clock/running fields. Suspend host logical time while hidden/paused, cancel stale RAFs on unload, and stop at completion/reduced motion. See [RFC 0004](../rfcs/0004-bounded-motion.md).

The opt-in draft `state-actions` capability uses a distinct critical `STAC` chunk; it does not reinterpret INTR. `Runtime::control_visible(index)` exposes whether a published control can receive focus/activation. WASM `describe()` includes `visible` for each control in the unchanged index order. Hosts must hide invisible semantic buttons and preserve ordinal indices when dispatching focus. `Shape::id()` supplies the validated identifier. See [RFC 0003](../rfcs/0003-state-actions.md) for grouped actions, bindings, reset and limits. Older tested pre-extension CLI/WASM rejects full STAC rendering and can extract/display its exact initial PNG.

## Rust host

Add a path dependency on `crates/iimg-core` when developing in this checkout. Generate the API reference and run its executable example from the repository root.

```sh
cargo doc --locked --workspace --no-deps
cargo test --locked --doc -p iimg-core
```

The generated core reference is `target/doc/iimg_core/index.html`. Its opening example authors a candidate image, validates it, toggles a pixel, inspects the accessible control state, replays a reset trace and extracts the PNG.

| Stage | API | Result |
| --- | --- | --- |
| Read | Host reader bounded by `MAX_FILE` | File bytes limited before allocation and checked again after reading |
| Parse | `decode(&bytes)` | Owned `Document` with verified envelope, CRCs and chunk order |
| Serialize container | `encode(&document)` | Structurally checked envelope with preserved payload bytes and fresh CRCs |
| Validate scene | `Runtime::new(&document)` | Validated geometry, decoded assets and unpressed controls |
| Validate preview | `visual::decode_preview(&document, runtime.dimensions())` | Original PNG slice and decoded RGB pixels |
| Present | `runtime.render_rgb()` | Owned row-major opaque sRGB triplets, with the render work budget enforced |
| Activate | `runtime.dispatch(Event::ActivatePixel { x, y })` | A synchronous state change and focus update for the topmost controlled object |
| Accessibility | `runtime.controls()` and `runtime.focused_target()` | Ordered target IDs, labels, pressed state and focused target |
| Replay | `runtime.replay(&trace)` | Whole-trace validation, reset and ordered dispatch |
| Author | `author::compile_v1(&source)` | Candidate bytes with a preview generated from the initial render |
| Migrate | `author::upgrade_v1(&draft)` | Validated 0.2 migration with known payloads preserved |

Keep the runtime alive to preserve interaction state. Render again after an activation or reset. Each frame has `width × height × 3` bytes with no row padding. Convert these RGB bytes to the host pixel format. Controls expose toggle-button semantics, and activation should be dispatched once per completed pointer gesture or keyboard action. Map a CSS pointer position through the displayed image bounds to canvas pixels before dispatch.

For keyboard navigation, use `FocusNext`, `FocusPrevious` and `ActivateFocused`. Hosts with native focus handling can synchronize the control index through `focus_control`. Passing `None` or an out-of-range index clears focus. `Reset` clears focus and pressed state. Invalid replay input preserves the existing runtime state.

Rust `Document` fields are public for authoring and container tools. Hosts accepting file bytes follow the complete parse and validation sequence above. `preflight_preview` checks PNG framing and dimensions, while `decode_preview` also validates the zlib stream and reconstructs pixels.

## Preview and failures

Use `visual::extract_static_preview(&bytes)` for a preview-only host. It verifies the complete envelope, understood metadata and PNG, including CRCs after the preview. It can skip unsupported interactive payloads and unknown critical extensions after the required prefix.

Match Rust error variants to choose host behavior. `Error` describes envelope failures. `SceneError` describes JSON, profile, capability, geometry, asset, interaction and budget failures. `UnsupportedProfile` and an envelope `UnknownCriticalChunk` can justify attempting static preview extraction. Handle extraction failure with a diagnostic. The historical container and unrecognized versions cannot supply a visual preview through this API.

Display a user-facing diagnostic for malformed content or exhausted budgets. Debug error text can include JSON locations and remains an implementation diagnostic. Use enum variants for program decisions.

## WebAssembly host contract

Build the module with `cargo build --locked --release --target wasm32-unknown-unknown -p iimg-web`. A module instance holds one runtime, input buffer and output buffer. Serialize calls and instantiate another module when separate document states are needed.

Call `prepare_input(length)`, reject a zero pointer, then copy exactly that many bytes into the returned region. The file limit is 16 MiB. Source authoring also enforces `author_source_limit()`, currently 12 MiB.

| Export | Host action and result |
| --- | --- |
| `load()` | Consume prepared input. Return 0 for a loaded scene, 1 for PNG fallback in output, or 2 for rejected input |
| `unload()` | Drop the selected runtime and owned input/output buffers, invalidating previous pointers |
| `describe()` | Replace output with UTF-8 JSON containing width, height, focus and ordered controls, or empty output when no scene is loaded |
| `render()` | Replace output with RGB pixels and return 0, or clear output and return 1 |
| `activate_pixel(x, y)` | Dispatch canvas pixel activation |
| `focus_control(index)` | Set the native focus index. A negative or out-of-range value clears focus |
| `activate_focused()` | Toggle the focused control |
| `reset()` | Reset the loaded runtime |
| `compile_source()` | Consume source input. Return 0 and 0.2 file bytes, or 1 and UTF-8 diagnostic text |
| `compile_source_v1()` | Consume source input. Return 0 and candidate file bytes, or 1 and diagnostic text |
| `output_ptr()`, `output_len()` | Borrow the current output region |

Copy output that must survive another call. Refresh JavaScript typed-array views from `wasm.memory.buffer` after a call that can allocate, because memory growth can invalidate earlier views. Treat a zero output length as an empty result. The host owns the lifetime of any Blob URLs or platform images it creates.

Call `unload()` when replacing or cancelling a document before an asynchronous read. Clear the host's previous presentation at that time, not only after new bytes arrive. Dropping vectors makes their allocations reusable; WebAssembly linear-memory capacity need not shrink. The bundled viewer/cache must be deployed together with the matching module because newer viewers use this export.

Pass integer canvas coordinates from 0 through 65535 to `activate_pixel`, and a signed 32-bit index to `focus_control`. Validate external host input before crossing the ABI boundary.

The numeric return codes and exports above describe the current adapter. Check the return code before interpreting output. A rejected load clears the previous runtime, and rendering then fails. Compiling source produces bytes in output, and a subsequent load opens those bytes as a document.

The [web viewer](../viewers/web/README.md) demonstrates the adapter and offline caching. The [Android viewer](../viewers/android/README.md) uses the same module inside a WebView. Its Java host performs bounded content-URI reads and serves only bundled application assets and the selected in-memory document through its private origin.
