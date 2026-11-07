# Architecture

## Boundaries

| Component | Responsibility | Location |
| --- | --- | --- |
| Container | Bounds, version, chunk order and CRC validation | `crates/iimg-core/src/lib.rs` |
| Visual model | Typed payloads, geometry, embedded assets and PNG decoding | `crates/iimg-core/src/visual.rs` |
| Runtime | Ordered synchronous events, focus, toggle state and replay | `crates/iimg-core/src/interaction.rs` |
| State groups | Bounded variables/actions and indexed visibility/color bindings | `crates/iimg-core/src/state.rs` |
| Finite motion | Validated endpoint translation and integer logical time | `crates/iimg-core/src/motion.rs` |
| Renderer | Pixel-center sampling of validated shapes with a work budget | `visual::Scene` and `interaction::Runtime` |
| Authoring | Source validation, generated preview and draft migration | `crates/iimg-core/src/author.rs` |
| Web host | WASM buffers, canvas presentation, controls and offline editing | `crates/iimg-web/` and `viewers/web/` |
| Android host | Bounded content-URI reads and the bundled web host | `viewers/android/` |
| Independent implementation | Envelope, PNG, scene and trace evaluation in Python | `tests/conformance/` |

The [SDK guide](SDK.md) describes the public APIs, validation sequence, failure handling and WebAssembly buffer ownership.

## Principles
- Treat all files as attacker-controlled, including fixtures.
- Avoid I/O, platform APIs, network and dynamic code in the core.
- Reject ambiguous encoding; preserve unknown ancillary chunks only under documented rules.
- Public spec changes require an RFC, fixtures, migration plan, compatibility notes, and review.
- Maintain independent decoder tests to avoid shared-bug false positives.

## Design decisions
See [the initial container decision](adr/0001-container-first.md), [wire compatibility](../rfcs/0001-wire-compatibility.md), [raster assets](../rfcs/0002-raster-assets.md) and the [Core candidate](../spec/IIMG-1.0-candidate.md). Additional capability proposals need explicit timing, resource, compatibility and conformance rules.
