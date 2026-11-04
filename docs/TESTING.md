# Testing and Verification Strategy

## Local developer checks
```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p iimg-cli -- sample examples/hello.iimg
cargo run -p iimg-cli -- validate examples/hello.iimg
```

## Test pyramid
- **Unit:** CRC vectors, lengths, header parsing, chunk ordering, unknown critical/ancillary behavior, integer overflow.
- **Integration:** encoder→decoder roundtrip, CLI error codes, sample file consistency.
- **Regression:** each fixed bug includes a minimized malicious/invalid fixture and test named after issue.
- **Conformance (future):** versioned `valid/`, `invalid/`, `edge/` fixtures; expected diagnostics and independent implementations.
- **Property-based (future):** encode/decode invariants, random chunk order and sizes.
- **Fuzzing (future):** arbitrary input decoder fuzz target, sanitizer jobs, corpus minimization, crash deduplication.
- **Differential (future):** compare independent Rust/JS decoders, not just same library roundtrip.
- **Rendering (future):** pixel snapshots at defined viewport/DPI and event sequence; compare with tolerance and reference images.
- **Interaction (future):** event replay traces, deterministic state hashes, touch/mouse/keyboard parity.
- **Performance (future):** cold open, warm open, memory peak, event latency, decompression ratio, battery impact.
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

## CI gating
CI must block merge on formatting, lint, unit/integration tests. Add fuzzing, code coverage and independent conformance once implemented; do not present planned checks as existing.
