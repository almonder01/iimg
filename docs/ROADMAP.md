# Roadmap (targets, not promises)

Checked items indicate local implementation. Use the [implementation plan](IMPLEMENTATION-PLAN.md) for delivery gates and [progress](PROGRESS.md) for verification evidence.

The [next-development plan](NEXT-DEVELOPMENT.md) defines acceptance and dependencies for the visual editor, advanced interactions, performance/accessibility and host distribution. New capabilities remain separate from the current toggle profile.

## v0.1 — foundation
- [x] Experimental container encoder/decoder and CRC checks
- [x] Sample generator and CLI validator
- [x] Contributor, governance and CI starter files
- [x] Formal JSON schemas and schema validator
- [x] Golden fixtures and adversarial corpus
- [x] Independent decoder

## v0.2 — safe visual document
- [x] Static scene model with vector primitives and raster resources
- [x] Embedded PNG preview specification and extraction
- [x] Deterministic rendering and snapshots
- [x] Host accessibility implementation and manual acceptance draft
- [ ] Full language/alternative-description and color management review

## v0.3 — interaction
- [x] Finite-state machine and declarative events
- [x] Touch, mouse and keyboard event replay
- [ ] Resource budget and threat-model review

## v0.4 — adoption
- [x] Web WASM viewer
- [x] Android reference viewer
- [x] Authoring SDK and sample editor
- [x] Initial visual Core editor with geometry/layers, toggle bindings and source import/save
- [ ] PNG upload, templates, source recovery and fresh-contributor authoring acceptance
- [ ] Public conformance suite and independent implementation

## v1.0 candidate
- [ ] Frozen interoperable wire format, RFC review, compatibility policy
- [ ] Third-party implementations and security audit
- [x] Small and large-scene SVG/HTML comparison with scoped memory measurements
- [ ] Equivalent Rive workloads and peak/low-memory Android measurements
- [ ] MIME registration proposal (subject to review)
- [ ] Documentation translations and governance election/process

## Out of scope initially
Arbitrary JavaScript, embedded executables, internet access, browser DOM, audio/video playback, 3D scenes, hidden analytics.
