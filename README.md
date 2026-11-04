# IIMG — Interactive Image Format

**Status: experimental draft v0.1; NOT a registered standard.** An open, offline-first, safe interactive image container.

## What works today
- Rust parser/encoder with strict length and checksum validation.
- A canonical sample `.iimg`, a CLI to inspect/validate it, and automated tests.
- Draft wire-format specification, security model, contributor workflow and governance documents.

**Not yet implemented:** graphical renderer, embedded PNG preview extraction, interactive runtime, mobile SDK, editor, MIME registration, messenger integration. Do not describe the current prototype as an image viewer.

## Quick start
Install stable Rust, then:
```sh
cargo test --workspace
cargo run -p iimg-cli -- sample examples/hello.iimg
cargo run -p iimg-cli -- inspect examples/hello.iimg
cargo run -p iimg-cli -- validate examples/hello.iimg
```

## Repository map
- `spec/` normative candidate format and behavior
- `crates/iimg-core/` Rust library for safe parsing and encoding
- `crates/iimg-cli/` CLI and reproducible sample generation
- `examples/` fixtures and examples
- `tests/` conformance and regression strategy
- `docs/` architecture, testing, releases, roadmap and security
- `.github/` issue templates, PR template, CI

## Contribute
Read [CONTRIBUTING](CONTRIBUTING.md), [architecture](docs/ARCHITECTURE.md), [testing](docs/TESTING.md) and [specification](spec/IIMG-0.1.md). Use an issue before proposing wire-format changes. Every bug fix needs a failing regression test first.

## Licenses
Code: MIT OR Apache-2.0 (license files to be added/verified before publication); documentation and specification: CC BY 4.0 (add legal text before publication). No contributor license assignment required; contributions under applicable project license (DCO sign-off recommended).

## Security
Untrusted input must be treated as hostile. Please use private reporting as described in [SECURITY.md](SECURITY.md).
