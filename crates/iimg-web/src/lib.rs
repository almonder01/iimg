//! Single-instance WebAssembly host adapter. Buffer pointers are borrowed until the next mutation.

use iimg_core::interaction::{Event, Runtime};
use iimg_core::visual::{self, SceneError};
use std::cell::RefCell;

#[derive(Default)]
struct Viewer {
    input: Vec<u8>,
    output: Vec<u8>,
    runtime: Option<Runtime>,
}

thread_local! {
    static VIEWER: RefCell<Viewer> = RefCell::new(Viewer::default());
}

#[no_mangle]
pub extern "C" fn prepare_input(length: usize) -> *mut u8 {
    VIEWER.with_borrow_mut(|viewer| {
        viewer.input.clear();
        if length == 0 || length > iimg_core::MAX_FILE {
            return std::ptr::null_mut();
        }
        viewer.input.resize(length, 0);
        viewer.input.as_mut_ptr()
    })
}

fn load_runtime(bytes: &[u8]) -> Result<Runtime, SceneError> {
    let document = iimg_core::decode(bytes).map_err(SceneError::Envelope)?;
    let runtime = Runtime::new(&document)?;
    visual::decode_preview(&document, runtime.dimensions())?;
    Ok(runtime)
}

/// Drop the selected document and owned buffers when a host cancels a load.
#[no_mangle]
pub extern "C" fn unload() {
    VIEWER.with_borrow_mut(|viewer| {
        viewer.runtime = None;
        viewer.input = Vec::new();
        viewer.output = Vec::new();
    });
}

/// 0 = interactive scene, 1 = PNG fallback, 2 = invalid or unsupported file.
#[no_mangle]
pub extern "C" fn load() -> u32 {
    VIEWER.with_borrow_mut(|viewer| {
        viewer.runtime = None;
        viewer.output.clear();
        let input = std::mem::take(&mut viewer.input);
        match load_runtime(&input) {
            Ok(runtime) => {
                viewer.runtime = Some(runtime);
                0
            }
            Err(
                SceneError::UnsupportedProfile
                | SceneError::Envelope(iimg_core::Error::UnknownCriticalChunk),
            ) => match visual::extract_static_preview(&input) {
                Ok(png) => {
                    viewer.output = png;
                    1
                }
                Err(_) => 2,
            },
            Err(_) => 2,
        }
    })
}

/// Compile source JSON using the same authoring API as the CLI.
#[no_mangle]
pub extern "C" fn compile_source() -> u32 {
    compile(iimg_core::author::compile)
}

#[no_mangle]
pub extern "C" fn compile_source_v1() -> u32 {
    compile(iimg_core::author::compile_v1)
}

#[no_mangle]
pub extern "C" fn author_source_limit() -> usize {
    iimg_core::author::MAX_SOURCE_BYTES
}

fn compile(author: impl FnOnce(&[u8]) -> Result<Vec<u8>, SceneError>) -> u32 {
    VIEWER.with_borrow_mut(|viewer| {
        let input = std::mem::take(&mut viewer.input);
        match author(&input) {
            Ok(bytes) => {
                viewer.output = bytes;
                0
            }
            Err(error) => {
                viewer.output = error.to_string().into_bytes();
                1
            }
        }
    })
}

#[no_mangle]
pub extern "C" fn activate_pixel(x: u16, y: u16) {
    dispatch(Event::ActivatePixel { x, y });
}

#[no_mangle]
pub extern "C" fn focus_control(index: i32) {
    VIEWER.with_borrow_mut(|viewer| {
        if let Some(runtime) = &mut viewer.runtime {
            runtime.focus_control(usize::try_from(index).ok());
        }
    });
}

#[no_mangle]
pub extern "C" fn activate_focused() {
    dispatch(Event::ActivateFocused);
}

#[no_mangle]
pub extern "C" fn reset() {
    dispatch(Event::Reset);
}

#[no_mangle]
pub extern "C" fn advance_time(milliseconds: u32) -> u32 {
    VIEWER.with_borrow_mut(|viewer| {
        if viewer
            .runtime
            .as_mut()
            .is_some_and(|runtime| runtime.advance_time(milliseconds).is_ok())
        {
            0
        } else {
            1
        }
    })
}
#[no_mangle]
pub extern "C" fn motion_preference(reduced: u32) -> u32 {
    VIEWER.with_borrow_mut(|viewer| {
        if reduced > 1 {
            return 1;
        }
        if let Some(runtime) = &mut viewer.runtime {
            if runtime.has_motion() {
                runtime.set_motion_preference(reduced == 1);
                return 0;
            }
        }
        1
    })
}
#[no_mangle]
pub extern "C" fn motion_running() -> u32 {
    VIEWER.with_borrow(|viewer| {
        u32::from(viewer.runtime.as_ref().is_some_and(Runtime::motion_running))
    })
}

fn dispatch(event: Event) {
    VIEWER.with_borrow_mut(|viewer| {
        if let Some(runtime) = &mut viewer.runtime {
            runtime.dispatch(event);
        }
    });
}

#[no_mangle]
pub extern "C" fn describe() {
    VIEWER.with_borrow_mut(|viewer| {
        viewer.output = viewer.runtime.as_ref().map_or_else(Vec::new, |runtime| {
            let (width, height) = runtime.dimensions();
            let controls: Vec<_> = runtime.controls().enumerate().map(|(index, (target, label, pressed))| {
                serde_json::json!({ "target": target, "label": label, "pressed": pressed, "visible": runtime.control_visible(index) })
            }).collect();
            serde_json::json!({
                "width": width, "height": height,
                "focus": runtime.focused_target(), "controls": controls,
                "motion": runtime.has_motion(), "clock_ms": runtime.clock_milliseconds(), "motion_running": runtime.motion_running(),
            })
            .to_string()
            .into_bytes()
        });
    });
}

#[no_mangle]
pub extern "C" fn render() -> u32 {
    VIEWER.with_borrow_mut(|viewer| {
        viewer.output.clear();
        match viewer.runtime.as_ref().map(Runtime::render_rgb) {
            Some(Ok(pixels)) => {
                viewer.output = pixels;
                0
            }
            _ => 1,
        }
    })
}

#[no_mangle]
pub extern "C" fn output_ptr() -> *const u8 {
    VIEWER.with_borrow(|viewer| viewer.output.as_ptr())
}

#[no_mangle]
pub extern "C" fn output_len() -> usize {
    VIEWER.with_borrow(|viewer| viewer.output.len())
}
