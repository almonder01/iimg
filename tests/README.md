# Test fixture registry

Current Rust unit tests cover roundtrip, corruption, truncation, trailing bytes and unknown chunks.

Run the independent Python conformance comparison from the repository root with
`cargo build --locked -p iimg-cli` followed by `python -B tests/conformance/check.py`.
It compares envelope decisions, preview extraction, semantic validation,
initial frames and interaction traces, including a mixed raster and vector candidate. It also checks that malformed
scene, asset and interaction payloads can be rejected by full readers while
their valid static previews remain available.

The suite includes arrays substituted for required objects, unsigned numeric token rules and Unicode string validity. Invalid metadata prevents preview extraction. Invalid scene or interaction payloads can retain a valid static preview. Arabic and emoji labels are positive cases.

Run `python -B tests/conformance/mail_transport.py` after building the CLI to
verify generic and experimental IIMG attachment transfer through a loopback
SMTP server. The script checks the decoded bytes and the recovered replay
frame. It sends no message outside the test process and loopback connection.

The [v0.1 manifest](fixtures/v0.1/manifest.json) records the historical fixture and its expected result. The workspace test compares its bytes with the reference encoder output.

Future layout:
- `fixtures/valid/`: accepted files and expected scene/state
- `fixtures/invalid/`: rejected files with expected error code
- `fixtures/edge/`: boundary cases
- `fixtures/regression/`: one file per fixed bug
- `golden/`: reference rendered outputs and event traces
- `fuzz/corpus/`: minimized, non-sensitive fuzz seeds

Every fixture must include a metadata manifest with SHA-256, provenance, spec version, expected result and license.
