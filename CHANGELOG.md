# Changelog

## [Unreleased]

The SDK remains at 0.1.0. Wire 1.0 is a candidate under review. This entry describes the local implementation awaiting review and publication.

### Added

- Typed visual payloads, rectangles, circles and embedded RGB8 PNG assets with bounded rendering.
- Deterministic toggle controls, pointer and focus events, reset and atomic portable trace replay.
- CLI authoring, rendering, static preview extraction and 0.2-to-1.0 migration.
- Offline web viewer and source editor with live validation, generated previews and file export.
- Android reference host for content-URI opening and sharing, plus a separate handoff test fixture app.
- Independent Python envelope, PNG, scene and event evaluation with versioned fixtures and differential checks.
- Source-only reproducibility checks, review packaging, checksums, SBOMs and project/dependency license inventories.
- Candidate security model, contribution and release procedures and an SDK guide with an executable Rust example.

### Changed

- Bound file reads before allocation and validate encoder structure and total size before serialization.
- Enforce named-field JSON objects, unsigned numeric tokens, unique fields and IDs, and valid Unicode strings.
- Decode PNG scanlines in place while checking exact output length, zlib checksum and all filters.
- Preserve the historical 0.1 sample and identify the 0.2 draft and 1.0 candidate explicitly.
- Configure cross-platform Rust, documentation, web and packaging checks, Android builds, dependency advisories and sanitizer fuzzing.

### Migration

Use `compile-v1` to author a candidate file or `upgrade-v1` to migrate a valid 0.2 document. Migration preserves known non-metadata payloads and drops unknown ancillary chunks. Rebuild historical 0.1 content from an explicit visual source.

### Release gates

Local test evidence and remaining platform, transport, licensing, independent review and publication gates are recorded in [delivery progress](docs/PROGRESS.md). Candidate wire values remain provisional.
