#[path = "../../../fuzz/exercise.rs"]
mod exercise;

#[test]
fn deterministic_mutations_cover_wire_and_semantic_parsers() {
    let seed = include_bytes!("../../../tests/fixtures/v1.0/raster-toggle.iimg");
    for length in 0..=seed.len() {
        exercise::exercise(&seed[..length]);
    }
    for index in 0..seed.len() {
        let mut bytes = seed.to_vec();
        bytes[index] ^= 0x80;
        exercise::exercise(&bytes);
    }
    let document = iimg_core::decode(seed).unwrap();
    for (selector, index) in [(0, 0), (1, 2), (2, 3), (3, 4), (4, 1)] {
        let data = &document.chunks[index].data;
        let payload = if selector == 4 {
            let length = u32::from_be_bytes(data[33..37].try_into().unwrap()) as usize;
            &data[41..41 + length]
        } else {
            data
        };
        mutate_payload(selector, payload);
    }
    mutate_payload(
        5,
        include_bytes!("../../../tests/fixtures/v0.2/two-controls-keyboard.json"),
    );
}

fn mutate_payload(selector: u8, payload: &[u8]) {
    let mut input = vec![selector];
    input.extend(payload);
    exercise::exercise(&input);
    for position in 1..input.len() {
        input[position] ^= 0x80;
        exercise::exercise(&input);
        input[position] ^= 0x80;
    }
}
