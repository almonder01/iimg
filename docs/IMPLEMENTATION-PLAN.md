# IIMG implementation plan

Status — proposal for maintainer review, based on commit `9b14d09`.

## Release scope

IIMG 1.0 defines an interoperable offline interactive image. A single native file carries a static preview, a validated visual scene, embedded resources and declarative behavior. The reference deliverables are a Rust SDK and CLI, web and Android viewers, a basic authoring tool, and a public conformance suite. Adoption by external viewers, messaging apps and operating systems is tracked separately. Milestone numbers below refer to project releases. The wire format and SDK have their own compatibility policies.

## Verified baseline

- GitHub repository `almonder01/iimg` is public and its default branch matches local `main` at `9b14d09`. The branch search returned only `main`, and issue and PR searches returned no results. Remote workflow runs, release history, branch rules and private vulnerability reporting settings still need verification.
- The Rust workspace has an encoder/decoder for the v0.1 chunk container and a CLI with `sample`, `inspect` and container-level `validate`. The JSON payloads are examples. There is no semantic validation, preview decoder, renderer or interaction engine.
- On Windows with Cargo 1.88, all six unit tests and Clippy passed. The checked-in fixture validated and matched the output of `sample` byte for byte. `cargo fmt --all -- --check` failed, which would stop the checked-in CI workflow at its first Rust check.
- Contribution, release, security and RFC templates exist. License texts, reproducible lockfile policy, CLI integration tests and a conformance corpus remain to be established.
- The CLI reads the entire file before the decoder applies its size limit. The core encoder serializes before performing complete structural validation and calls the allocating decoder on the output. Address bounded input and write-time validation before expanding the accepted surface.

## Architecture to build

```text
Host bounded read -> container decoder -> typed payload validation
                                      |                 |
                                      v                 v
                              verified preview   validated document
                                                        |
                                          normalized input -> state engine
                                                        |
                                                 render / accessibility
```

The Rust core owns binary parsing, semantic validation, state transitions and resource accounting. Host adapters own filesystem access, input normalization, platform drawing or pixel presentation, accessibility bridges and lifecycle. The core provides structured error codes, stable fixture diagnostics and a rendering interface that consumes a validated model. Preview extraction has its own conformance target and enforces container, version and image limits before presenting pixels. Define how a compatible preview can be located for unsupported capabilities and versions. Reject corrupt containers and invalid previews with a diagnostic. Exercise missing and unsupported cases separately from corruption.

### Specification decisions before the first visual release

| RFC topic | Required decisions and evidence |
| --- | --- |
| Wire and compatibility | Specify byte order, integer widths, CRC coverage, required chunk order and multiplicity, reserved fields and extension namespaces. Give old-reader/new-writer examples. Define when preview-only fallback is permitted and how writers handle unknown ancillary chunks when editing a file. Preserve the experimental fixture as an explicit historical baseline. |
| Payload encoding | Start by measuring strict UTF-8 JSON against CBOR on the same corpus. For JSON define duplicate keys, integer ranges, nesting, unknown fields and canonical output where required. Adopt compression only with measured benefits and explicit limits on compressed size, decoded size and work. |
| Scene and assets | Specify coordinate origin, bounds, numeric precision, transforms, clipping, layer order, hit-testing boundaries, alpha, blending, color space and valid asset references. Begin with rectangles, circles and bounded PNG raster assets. Decide font licensing, deterministic metrics, shaping and bidirectional text before standardizing editable text, with Arabic fixtures for any supported text profile. |
| Preview | Specify a single mandatory static PNG for the production Core profile, including permitted PNG features, dimensions and pixel budget. Define its relation to the initial scene and its extraction rules. Publish a separate standalone PNG export for sharing a static version. |
| Behavior | Define normalized activation, target resolution, focus order, event ordering, atomic state updates and reset. Start with bounded declarative transitions and state-driven style or visibility. Keep animation and drag as distinct capability proposals with explicit fallback and deterministic timing rules. |
| Security and accessibility | Publish a threat model and testable budgets for file bytes, chunks, dimensions, decoded pixels, allocations, nesting, events and work. Specify accessible names, roles, focus order, keyboard activation and reduced motion. Keep all document behavior local, with no script or external resource resolution. |

## Milestones and exit gates

| Milestone | Implementation | Exit gate |
| --- | --- | --- |
| M0 · v0.1 verified foundation | Format baseline, publish license texts after owner confirms scope, record supported toolchain and commit the workspace lockfile for the CLI. Add bounded CLI reads, shared structural checks and independent CRC vectors. Make CI validate the tracked sample before generating a temporary sample and comparing bytes. Configure required checks and a private reporting path. | Fresh checkout passes formatting, Clippy, unit and integration tests and sample validation on Windows, Linux and macOS. Corrupt and oversized input fails with documented diagnostics. GitHub checks and reporting path are verified. |
| M1 · v0.2 visual document | Land wire, payload, preview and scene RFCs. Add typed schemas, bounded PNG preview, asset validation, a reference renderer and CLI preview/render commands. Publish versioned fixtures with positive, negative and boundary cases. | Open a self-contained scene, extract its PNG, render the initial state and compare against reference output. Reject malformed payloads, duplicate IDs, dangling references and out-of-budget images. |
| M2 · v0.3 interactive vertical slice | Specify and implement input normalization, hit-testing, focus and deterministic transitions. Ship a lamp and a second example with multiple targets. Add state replay and a basic web demo using the Rust core through WASM. Add a motion profile only after timing and reduced-motion behavior are specified and tested. | Open an actual local `.iimg`, see its initial image and toggle it by click, tap and keyboard while offline with the viewer available. Identical normalized event traces yield identical state and comparable reference frames. |
| M3 · v0.4 viewers and sharing | Ship an offline-capable web viewer and an Android reference viewer that receives files through system sharing and file opening. Define SDK host APIs and stable capability errors. Test local opening, preview fallback and transfer. | Same fixtures and interaction traces pass on web and Android. Record app and OS versions, sending mode and SHA-256 before and after transfer via email and selected messengers. Record attachment delivery, intact bytes, system handoff and in-app rendering separately. |
| M4 · v0.5 authoring and ecosystem | Ship a minimal editor that creates supported Core shapes and transitions, validates live, generates preview and exports a standalone file. Provide examples, API docs, migration tooling for drafts where practical and onboarding for independent implementers. Extend host coverage to iOS and desktop according to demand and test capacity. | A contributor can author, export, reopen and share a file using public tools. A fresh contributor can reproduce the CI checks and submit a tested change from the documentation. |
| M5 · 1.0 release candidate and stable release | Freeze normative Core and capability registry. Publish the conformance suite and run it against an independent implementation that uses the spec and its own decoder/runtime. Complete security review, sustained fuzzing, backwards compatibility tests, release checksums and provenance. | Both implementations agree on acceptance, failure category and event outcomes for the versioned suite. Resolve release-blocking security and interoperability defects. Publish spec, policy, binaries, changelog, migration notes and signed release metadata where supported. |
| Parallel · adoption and registration | Collect real deployments and maintainer feedback. After spec stability, evaluate the appropriate IANA registration tree and prepare the media-type submission. Explore PNG carriage only as a documented experiment with transfer and editing results. | Publish measured support and transfer matrices and a registration status. Track integration proposals with external projects as separate milestones. |

## First GitHub backlog

These are proposed issue IDs for planning and do not represent GitHub issue numbers.

| ID | Priority | Work and acceptance | Depends on |
| --- | --- | --- | --- |
| FND-01 | P0 | Apply rustfmt as a dedicated change. Run existing workflow checks without changing their semantics. | — |
| FND-02 | P0 | Confirm and add MIT/Apache-2.0 and CC BY 4.0 texts for their respective scopes, document fixture licenses and verify private security reporting. | Owner license/settings decision |
| FND-03 | P0 | Establish Rust toolchain/lockfile policy and matrix CI. Validate tracked fixture, generate to a temporary path and compare bytes. Configure required checks after a verified run. | FND-01 |
| FND-04 | P0 | Bound CLI input before allocation, handle paths with Unicode, make diagnostics testable and validate aggregate size and structure before encoding. Add CLI and boundary regressions. | FND-01 |
| FND-05 | P1 | Add fixture manifest, independent CRC vectors and decoder fuzz target. Define run budget and crash triage. | FND-04 |
| SPEC-01 | P0 | Open wire and compatibility RFC with historical v0.1 and preview fallback examples. | FND-05 for fixture integration |
| SPEC-02 | P0 | Open payload, scene and PNG preview RFCs with budgeted minimal profile. | SPEC-01 for final acceptance |
| VIS-01 | P0 | Build and validate the first static reference scene end to end. | SPEC-02 |
| INT-01 | P0 | Specify and implement lamp activation, state trace and visual assertions across input modes. | VIS-01 |

## Testing and contribution protocol

- For every issue, record expected and observed behavior, version/commit, host, steps and a minimal licensed fixture where applicable. Use a private channel for sensitive vulnerabilities. Triage issues with milestone, component and acceptance criteria. Link the issue from the PR and link the RFC for wire-visible changes.
- For every fixture, record ID, provenance, license, SHA-256, wire version, profile and expected result. Include expected failure class, event traces or reference frames as applicable. Preserve historical fixtures and require an explanation and review for a golden output change. Add fixtures constructed from the spec without the reference encoder.
- For fixes, demonstrate the failing test on the parent revision and passing test after the patch. For features, include valid, invalid and boundary cases. For wire changes, run old-reader/new-writer and new-reader/old-writer vectors and include a migration decision. For renderer changes, compare a fixed viewport and raster tolerance. For performance changes, measure before and after under identical inputs and hardware.
- Fast PR checks cover format, lint, unit and integration tests, sample bytes and conformance smoke tests. Scheduled or release checks cover extended fuzzing, dependency review, full cross-host conformance, renderer snapshots and repeatable benchmarks. Include arbitrary bytes, malformed UTF-8, invalid flags/order/CRC, duplicate keys/IDs, inflated assets, pixel allocation limits and invalid event targets.
- Reproduce the current checks with `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` and `cargo run -p iimg-cli -- validate examples/hello.iimg`. Generate comparison files into an existing temporary or build directory. Add `--locked` to build/test commands once the lockfile is tracked.
- Benchmark equivalent SVG, HTML and Rive artifacts on small vector and raster-backed workloads. Record asset size, runtime distribution size separately, cold and warm open, peak memory and event-to-frame latency with device, browser, version, repetitions, median and p95. Treat 30 KB, 150 KB, 100 ms and 50 ms from the original roadmap as hypotheses until measured on defined fixtures and hardware.

## Adoption references

- [PNG specification](https://www.w3.org/TR/png-3/) describes ancillary chunks. Test preservation through real transfer paths before claiming compatibility.
- [RFC 6838](https://www.rfc-editor.org/info/rfc6838/) and [IANA registration form](https://www.iana.org/form/media-types) describe media-type registration. Track platform integrations independently.
