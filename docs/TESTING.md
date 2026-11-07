# Testing and Verification Strategy

Finite motion acceptance runs `python -B tests/conformance/motion.py` and `node viewers/web/smoke-motion.mjs`. Eight independent frame outcomes cover midpoint, exact repeat/final boundaries, retrigger, reset, reduced preference and clock limit. Eleven invalid motion payloads and three invalid time/preference traces reject consistently. Browser tests control RAF timestamps, assert pixels and cancellation under pause/background/reduced-motion/completion/unload, and author/remove tracks. Native tests verify atomic bad replay and direct-clock rejection. Set `IIMG_OLD_WASM` to a pre-motion engine for exact static fallback verification.

State-actions acceptance runs `python -B tests/conformance/state_actions.py` and `node viewers/web/smoke-state.mjs`. Four native/Python/WASM frame outcomes and 20 semantic rejection mutations are compared against a separately encoded STAC fixture. Native tests cover focus/hit behavior, wraparound and hidden worst-case render work. Browser tests author state/actions/styles, preserve them during geometry edits, operate semantic hide/show controls, reset and reject legacy export. For optional old-reader checks, set `IIMG_OLD_WASM` to a pre-extension engine when invoking the smoke test; the tested older engine must return the exact mandatory PNG, not execute STAC. Fixture generation uses stored DEFLATE for host-independent bytes.

## Local developer checks

Run from the repository root with stable Rust, rustfmt, Clippy and Python 3.12. The CLI integration tests generate temporary files and compare the historical sample byte for byte.

```sh
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo run --locked -p iimg-cli -- validate examples/hello.iimg
python -B tests/conformance/check.py
python -B tests/conformance/generated.py
python -B tests/conformance/mail_transport.py
```

Use the [web viewer checks](../viewers/web/README.md) for the WASM and Chromium suites and the [Android device checks](../viewers/android/README.md) for the native adapter.

The Chromium suite also authors a document through the visual workspace, tests layer hit selection, mouse dragging/cancellation, touch selection, keyboard movement, undo/redo, binding cleanup and exact design/viewer pixel independence, then exports and reopens the IIMG. Source save/import must preserve embedded PNG bytes; invalid or oversized sources and out-of-bounds geometry must not replace the accepted design. A deliberately held import verifies that later edits win. The suite starts after an offline reload, including lazy editor-module loading. For optional visual QA screenshots, set `IIMG_EDITOR_SCREENSHOTS` to an absolute directory under the ignored `target/` directory before running the browser suite. Automated snapshots do not replace physical touch/TalkBack acceptance.

The package verifier also runs the extracted `serve.py` host on loopback with a deliberately broken `.mjs` MIME mapping. All shell assets must return exact bytes and their expected browser content types. This catches a Windows configuration where `python -m http.server` returns `text/plain` for modules and the app never starts. The bundled host and `scripts/serve_web.py` use explicit MIME types.

The Android workflow also runs `scripts/test_android_reader.py` against JDK 17, with no new test dependencies. It exercises bounded reading, deadline/cancellation, stale queued callbacks, lifecycle close and backpressure. The companion APK provides real Android provider cases for device acceptance.

Generate the [showcase and scale workloads](../examples/showcase/README.md) with `python -B examples/showcase/generate.py --output target/showcase`, then run `node viewers/web/smoke-showcase.mjs`. CI compares full native/WASM frames and all 14 pointer/keyboard/reset controls for six scenes up to 2048². Candidate archives contain this generated corpus and verification uses the extracted WASM. See [accessibility acceptance](ACCESSIBILITY.md) for manual checks not covered by automation.

After building WASM and installing the locked npm development dependencies, run `npm --prefix viewers/web run test:schemas`. This checks the [JSON schemas](../spec/schemas/README.md) against valid and invalid structural cases and verifies that Core enforces the remaining semantic and lexical rules.

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

The separate `author` target consumes source JSON and checks draft/candidate acceptance, migration and preview/render parity. Seed `fuzz/corpus/author` with `examples/*.source.json`, then run `cargo +nightly fuzz run author -- -max_len=65536 -max_total_time=60`. Both smoke targets bound inputs below the production maxima; keep maximum-budget tests separate. The workflow defaults to 600 seconds per target and validates its optional `seconds` input within 1–600.

The generated conformance runner uses seed `0x49494d47` for 40 small scenes, comparing draft/candidate initial pixels, 80 replay frames and migrations with the separate Python evaluator. It runs in Rust CI and extracted candidate-package verification. See the [technical review and independent-review handoff](reviews/2026-11-05-core-candidate.md) for evidence and unresolved review questions.

## CI gating

The configured Rust and web workflows run on Windows, Linux and macOS. The Android workflow builds and verifies a debug APK. Advisory and sanitizer checks have separate workflows. Configure required checks on the default branch after verifying these jobs on GitHub.
