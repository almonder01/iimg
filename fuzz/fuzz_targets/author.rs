#![no_main]

use iimg_core::{author, decode, interaction::Runtime, visual};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|bytes: &[u8]| {
    if bytes.len() > 64 * 1024 {
        return;
    }
    match (author::compile(bytes), author::compile_v1(bytes)) {
        (Ok(draft), Ok(candidate)) => {
            assert_eq!(author::upgrade_v1(&draft).unwrap(), candidate);
            for bytes in [&draft, &candidate] {
                let document = decode(bytes).unwrap();
                let runtime = Runtime::new(&document).unwrap();
                let preview = visual::decode_preview(&document, runtime.dimensions()).unwrap();
                assert_eq!(runtime.render_rgb().unwrap(), preview.rgb);
            }
        }
        (Err(_), Err(_)) => {}
        _ => panic!("draft and candidate compilers disagree on source acceptance"),
    }
});
