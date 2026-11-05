# Testing and Verification Strategy

## Local developer checks

Run from the repository root with stable Rust, rustfmt, Clippy and Python 3.12. The CLI integration tests generate temporary files and compare the historical sample byte for byte.

```sh
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo run --locked -p iimg-cli -- validate examples/hello.iimg
python -B tests/conformance/check.py
python -B tests/conformance/mail_transport.py
```

Use the [web viewer checks](../viewers/web/README.md) for the WASM and Chromium suites and the [Android device checks](../viewers/android/README.md) for the native adapter.

The [SDK guide](SDK.md) includes the commands for generating and testing the Rust API documentation. The CI matrix generates documentation with `RUSTDOCFLAGS=-D warnings`, and the workspace tests execute the core integration example.

## Test pyramid
- **Unit:** CRC vectors, lengths, header parsing, chunk ordering, unknown critical/ancillary behavior, integer overflow.
- **Integration:** encoder→decoder roundtrip, CLI error codes, sample file consistency.
- **Regression:** each fixed bug includes a minimized malicious/invalid fixture and test named after issue.
- **Conformance:** the independent Python runner compares acceptance, diagnostic categories, preview pixels, migration and replay frames with the Rust CLI.
- **Property-based (future):** encode/decode invariants, random chunk order and sizes.
- **Fuzzing:** a deterministic mutation test runs on stable Rust. The libFuzzer target exercises the same harness with raw envelopes, repaired checksums for semantic payloads, arbitrary zlib streams and replay traces. A scheduled Linux workflow runs the sanitizer target.
- **Rendering and interaction:** compare exact fixture pixels and normalized traces. Chromium exercises mouse, emulated touch and keyboard, offline reload and authoring.
- **Performance:** [benchmarks](BENCHMARKS.md) record measurements and remaining comparisons.
- **Security:** file size limits, resource exhaustion, malformed UTF-8, oversized dimensions, corrupt CRC, decompression bombs, unknown capabilities.
- **Compatibility:** Windows/Linux/macOS and browsers; Android/iOS when adapters exist.

## Change validation matrix
| Change | Mandatory proof |
| --- | --- |
| Bug fix | failing test before patch, passing after, neighboring edge tests |
| New feature | RFC/ADR if format-visible, positive/negative fixtures, docs, capability behavior |
| Refactor | no public behavior change, full regression suite, benchmarks if hot path |
| Security fix | private disclosure, regression reproducer, sanitizer/fuzz pass, advisory |
| Dependency update | lockfile review, license/advisory check, test matrix |
| Wire-format change | new fixtures, old-reader/new-reader compatibility table, migration notes |
| Release | clean checkout, CI green, signed provenance where available, changelog, smoke tests |

## Fixture review
Never replace an existing fixture silently. Give each fixture an ID, origin, expected result, feature set, spec version and checksum. Preserve old fixtures for backward-compatibility testing.

## Decoder fuzzing

On a host with nightly Rust and cargo-fuzz installed, seed a scratch corpus with the historical sample and run a time-limited smoke test from the repository root.

```sh
mkdir -p fuzz/corpus/decode
cp examples/hello.iimg tests/fixtures/v0.2/*.iimg tests/fixtures/v1.0/*.iimg fuzz/corpus/decode/
cargo +nightly fuzz run decode -- -max_len=65537 -max_total_time=60
```

Record the command, host, seed corpus and run duration. Minimize any failure and add a regression test. Handle sensitive crashes through the private reporting process.

## CI gating

The configured Rust and web workflows run on Windows, Linux and macOS. The Android workflow builds and verifies a debug APK. Advisory and sanitizer checks have separate workflows. Configure required checks on the default branch after verifying these jobs on GitHub.
