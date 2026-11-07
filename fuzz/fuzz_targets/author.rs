#![no_main]

use libfuzzer_sys::fuzz_target;
#[path = "../author_exercise.rs"]
mod exercise;
fuzz_target!(|bytes: &[u8]| exercise::exercise(bytes));
