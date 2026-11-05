# IIMG — Interactive Image Format

**Status — Core 1.0 candidate under review.** IIMG is a project for offline interactive images. The [delivery tracker](docs/PROGRESS.md) records local verification and remaining release gates.

## What works today
- Rust parsing, validation, RGB rendering and deterministic toggle interaction with bounded resources.
- CLI authoring, migration, preview extraction and portable event replay.
- Offline web viewer and source editor with live validation, preview and file export.
- Android reference viewer with local document and sharing adapters. Device acceptance remains in progress.
- Versioned fixtures and an independent Python implementation for conformance comparison.
- Candidate specifications, contributor workflow, security model and release tooling.

## Quick start
Install stable Rust, then run these commands from the repository root. Output paths must be new files.
```sh
cargo test --locked --workspace
cargo run --locked -p iimg-cli -- inspect examples/hello.iimg
cargo run --locked -p iimg-cli -- validate examples/hello.iimg
cargo run --locked -p iimg-cli -- extract-preview tests/fixtures/v0.2/lamp.iimg lamp.png
cargo run --locked -p iimg-cli -- compile-v1 examples/lamp.source.json lamp.iimg
```

## Repository map
- `spec/` normative candidate format and behavior
- `crates/iimg-core/` Rust library for safe parsing and encoding
- `crates/iimg-cli/` CLI and reproducible sample generation
- `viewers/` offline web editor and viewer, plus the Android reference host
- `examples/` fixtures and examples
- `tests/` conformance and regression strategy
- `docs/` architecture, testing, releases, roadmap and security
- `.github/` issue templates, PR template, CI

## Contribute
Read [CONTRIBUTING](CONTRIBUTING.md), [architecture](docs/ARCHITECTURE.md), [testing](docs/TESTING.md) and the [Core candidate](spec/IIMG-1.0-candidate.md). Use an issue before proposing wire-format changes. Every bug fix needs a failing regression test first.

See the [implementation plan](docs/IMPLEMENTATION-PLAN.md) and [delivery progress](docs/PROGRESS.md) for milestone gates and the next work.

See [authoring](docs/AUTHORING.md) to create and preview your own interactive file.

Use the [SDK integration guide](docs/SDK.md) to embed the core or WebAssembly adapter in another application.

## Licenses
Code and project-authored fixtures use MIT OR Apache-2.0. Documentation and specifications use CC BY 4.0. See the [license texts and scopes](LICENSES.md). Contributions use the applicable project license, with DCO sign-off recommended.

## Security
Untrusted input must be treated as hostile. Please use private reporting as described in [SECURITY.md](SECURITY.md).
