# Architecture

## Boundaries
1. **Container:** validates magic, lengths, CRC, ordering and feature flags. Never trusts metadata.
2. **Document model (future):** validated scene graph, resources, interactive state; no raw script execution.
3. **Runtime (future):** deterministic finite-state transitions with resource budgets.
4. **Renderer (future):** independent of parsing; never reads unvalidated binary data.
5. **Host adapters (future):** browser WASM, Android JNI, iOS FFI, desktop.
6. **Tooling:** CLI, encoder, editor, conformance harness.

## Principles
- Treat all files as attacker-controlled, including fixtures.
- Avoid I/O, platform APIs, network and dynamic code in the core.
- Reject ambiguous encoding; preserve unknown ancillary chunks only under documented rules.
- Public spec changes require an RFC, fixtures, migration plan, compatibility notes, and review.
- Maintain independent decoder tests to avoid shared-bug false positives.

## Design decisions
See `docs/adr/0001-container-first.md`. Future ADRs: scene format, CBOR vs JSON, compression, preview codec, renderer, font strategy.
