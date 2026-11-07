use iimg_core::{
    author, decode,
    interaction::Runtime,
    visual::{self, SceneError},
};

fn verify(bytes: &[u8]) {
    let document = decode(bytes).unwrap();
    let runtime = Runtime::new(&document).unwrap();
    let preview = visual::decode_preview(&document, runtime.dimensions()).unwrap();
    assert_eq!(runtime.render_rgb().unwrap(), preview.rgb);
}

pub fn exercise(bytes: &[u8]) {
    if bytes.len() > 64 * 1024 {
        return;
    }
    match (author::compile(bytes), author::compile_v1(bytes)) {
        (Ok(draft), Ok(candidate)) => {
            assert_eq!(author::upgrade_v1(&draft).unwrap(), candidate);
            verify(&draft);
            verify(&candidate);
        }
        (Err(SceneError::UnsupportedProfile), Ok(candidate)) => {
            // New required capabilities deliberately cannot be represented by
            // historical 0.2. Do not mistake that documented rejection for a bug.
            let document = decode(&candidate).unwrap();
            assert!(document
                .chunks
                .iter()
                .any(|chunk| matches!(&chunk.kind, b"STAC" | b"DRAG")));
            verify(&candidate);
        }
        (Err(_), Err(_)) => {}
        _ => panic!("unexpected draft/candidate source acceptance disagreement"),
    }
}
