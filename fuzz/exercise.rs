use iimg_core::interaction::{Event, Runtime};
use iimg_core::visual;

const SEED: &[u8] = include_bytes!("../tests/fixtures/v1.0/raster-toggle.iimg");

pub fn exercise(bytes: &[u8]) {
    if let Ok(document) = iimg_core::decode(bytes) {
        let encoded = iimg_core::encode(&document).expect("decoded document must encode");
        assert_eq!(encoded, bytes);
        exercise_document(&document);
    }
    let _ = visual::extract_static_preview(bytes);

    let Some((&selector, payload)) = bytes.split_first() else {
        return;
    };
    if payload.len() > 64 * 1024 {
        return;
    }
    // Rebuild the outer CRC so mutated data reaches the semantic decoders.
    let mut document = iimg_core::decode(SEED).expect("candidate seed must decode");
    match selector % 6 {
        0 => document.chunks[0].data = payload.to_vec(),
        1 => document.chunks[2].data = payload.to_vec(),
        2 => document.chunks[3].data = payload.to_vec(),
        3 => document.chunks[4].data = payload.to_vec(),
        4 => {
            let png = &mut document.chunks[1].data;
            // Keep the fixture's signature and IHDR, then replace the IDAT stream.
            png.truncate(33);
            png.extend((payload.len() as u32).to_be_bytes());
            let start = png.len();
            png.extend(b"IDAT");
            png.extend(payload);
            let crc = png[start..].iter().fold(!0u32, |mut crc, &byte| {
                crc ^= u32::from(byte);
                for _ in 0..8 {
                    crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1));
                }
                crc
            });
            png.extend((!crc).to_be_bytes());
            png.extend(b"\0\0\0\0IEND\xae\x42\x60\x82");
        }
        _ => {
            let mut runtime = Runtime::new(&document).expect("candidate runtime must load");
            let _ = runtime.replay(payload);
            return;
        }
    }
    let encoded = iimg_core::encode(&document).expect("structured seed must encode");
    exercise_document(&iimg_core::decode(&encoded).expect("structured seed must decode"));
}

fn exercise_document(document: &iimg_core::Document) {
    if let Ok(mut runtime) = Runtime::new(document) {
        let (width, height) = runtime.dimensions();
        let _ = visual::decode_preview(document, (width, height));
        if usize::from(width) * usize::from(height) <= 16384 {
            let _ = runtime.render_rgb();
            runtime.dispatch(Event::FocusNext);
            runtime.dispatch(Event::ActivateFocused);
            if runtime.has_motion() {
                let _ = runtime.advance_time(500);
                let _ = runtime.render_rgb();
                runtime.set_motion_preference(true);
                let _ = runtime.render_rgb();
                let _ = runtime.advance_time(86400000);
                let _ = runtime.render_rgb();
            }
            runtime.dispatch(Event::Reset);
        }
    }
}
