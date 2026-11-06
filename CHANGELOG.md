# Changelog

## [Unreleased]

The SDK remains at 0.1.0. Wire 1.0 is a published candidate under review.

### Added

- Direct bounded RGB8 PNG authoring import, three original templates, pointer/keyboard resize, and opt-in local recovery with explicit restore/delete, text budget and quota diagnostics.

- Visual web authoring workspace with Core-rendered design preview, pointer/keyboard movement, layers, toggle bindings, bounded history and editable source import/save.
- Acceptance-driven development plan for authoring, advanced interactions and remaining host/release work.
- Packaged loopback web host with explicit JavaScript/WASM MIME types, including a broken-Windows-mapping regression check.

- Original large rect/circle showcase scenes and 256/1024/2048 pixel workloads with native/WASM frame and control verification.
- Gallery benchmark with equivalent SVG/HTML sources, input/engine hashes and explicitly scoped memory samples.
- Bounded Android reader with selection cancellation, a 15-second deadline and standalone fault/lifecycle/backpressure tests.
- A separately installed provider test-source app for failure, oversized streams, slow opening and superseded loads.
- Debug-only phone test reports with WebView/device versions, selected-byte digest and a scoped host PSS sample.
- Typed visual payloads, rectangles, circles and embedded RGB8 PNG assets with bounded rendering.
- Deterministic toggle controls, pointer and focus events, reset and atomic portable trace replay.
- CLI authoring, rendering, static preview extraction and 0.2-to-1.0 migration.
- Offline web viewer and source editor with live validation, generated previews and file export.
- Android reference host for content-URI opening and sharing, plus a separate handoff test fixture app.
- Android picker fixtures and independent frame checks for native input, reset, preview fallback and corrupt-file recovery.
- Independent Python envelope, PNG, scene and event evaluation with versioned fixtures and differential checks.
- JSON Schema models for editor integration with strict structural tests and Core semantic checks.
- Source-only reproducibility checks, review packaging, checksums, SBOMs and project/dependency license inventories.
- Candidate security model, contribution and release procedures and an SDK guide with an executable Rust example.

### Changed

- Clear old image/runtime/controls when replacing or cancelling a document; reject stale Android results and expose WASM `unload()`.
- Add 48-pixel web control targets, wrapping labels, visible keyboard focus, automatic text direction and loading-state semantics.
- Select Apache-2.0 as the sole license for current project code and fixtures, with canonical `LICENSE` and `NOTICE` files included in review archives and the Android viewer. Earlier published grants remain effective; documentation and specifications remain CC BY 4.0.
- Bound file reads before allocation and validate encoder structure and total size before serialization.
- Enforce named-field JSON objects, unsigned numeric tokens, unique fields and IDs, and valid Unicode strings.
- Decode PNG scanlines in place while checking exact output length, zlib checksum and all filters.
- Preserve the historical 0.1 sample and identify the 0.2 draft and 1.0 candidate explicitly.
- Configure cross-platform Rust, documentation, web and packaging checks, Android builds, dependency advisories and sanitizer fuzzing.

### Migration

Use `compile-v1` to author a candidate file or `upgrade-v1` to migrate a valid 0.2 document. Migration preserves known non-metadata payloads and drops unknown ancillary chunks. Rebuild historical 0.1 content from an explicit visual source.

### Release gates

Local test evidence and remaining platform, transport, licensing, independent review and publication gates are recorded in [delivery progress](docs/PROGRESS.md). Candidate wire values remain provisional.
