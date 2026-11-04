# Test fixture registry

Current Rust unit tests cover roundtrip, corruption, truncation, trailing bytes and unknown chunks.

Future layout:
- `fixtures/valid/`: accepted files and expected scene/state
- `fixtures/invalid/`: rejected files with expected error code
- `fixtures/edge/`: boundary cases
- `fixtures/regression/`: one file per fixed bug
- `golden/`: reference rendered outputs and event traces
- `fuzz/corpus/`: minimized, non-sensitive fuzz seeds

Every fixture must include a metadata manifest with SHA-256, provenance, spec version, expected result and license.
