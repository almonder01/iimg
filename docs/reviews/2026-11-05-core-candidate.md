# Core candidate technical review and independent-review handoff

Status: implementation-team technical review in progress. This is not an independent security audit or approval of the 1.0 release gate. The implementation and this review were prepared with Codex assistance. The Python evaluator uses a separate algorithm, but is maintained in the same project and does not establish an independent external review.

## Revision and boundaries

The reviewed runtime is merged commit `82d903460a50434d3c3927600ef5c86eca4d4e9a`. This review branch adds tests and documentation without changing the wire format or viewer runtime. Record full revision IDs when testing later changes.

| Boundary | Review scope |
| --- | --- |
| [Container codec](../../crates/iimg-core/src/lib.rs) | Complete-file limit, checked offsets, CRC coverage, chunk order/multiplicity, reserved bytes and unknown chunks |
| [Visual and PNG](../../crates/iimg-core/src/visual.rs), [JSON objects](../../crates/iimg-core/src/json.rs) | Typed fields, dimensions/references, inflate size/checksum, filters, pixel/work limits |
| [Runtime](../../crates/iimg-core/src/interaction.rs), [authoring](../../crates/iimg-core/src/author.rs) | Bounded/atomic traces, focus/occlusion, source/assets, generated preview and migration |
| [WASM adapter](../../crates/iimg-web/src/lib.rs), [viewer](../../viewers/web/viewer.mjs), [cache](../../viewers/web/offline.js) | Buffer lifetime, inert labels, bounded selected files, stale selections and isolated cached shell |
| [Android Activity](../../viewers/android/app/src/main/java/org/iimg/viewer/MainActivity.java), [manifest](../../viewers/android/app/src/main/AndroidManifest.xml) | Exported intents, content grants, bounded reads, synthetic origin, fixed assets and lifecycle |
| [Packager](../../scripts/package_candidate.py), [verifier](../../scripts/verify_candidate_package.py) | Checksums, archive paths, legal inventory, extracted conformance and build-record scope |

Review the [security model](../SECURITY-MODEL.md), [candidate specification](../../spec/IIMG-1.0-candidate.md) and [SDK guide](../SDK.md). The [physical-device report PR](https://github.com/almonder01/iimg/pull/2) supplies scoped Galaxy S23+ evidence, without establishing behavior on all Android versions or providers.

## Evidence

| Check | Result and scope |
| --- | --- |
| Locked dependencies | [Linux audit](https://github.com/almonder01/iimg/actions/runs/42032499751) checked 154 distinct Rust, npm and Maven versions; zero OSV matches. This does not establish absence of undisclosed vulnerabilities |
| Decoder sanitizer | [Linux run](https://github.com/almonder01/iimg/actions/runs/42032505556) completed 3,450,876 executions in 601 seconds from six binary seeds, with no reported sanitizer crash. Its final log reported 484 MiB RSS for the instrumented fuzzer; this is not normal viewer memory usage |
| Generated differential cases | Windows passed seed `0x49494d47`: 40 bounded scenes, 80 versioned 64-event replays, initial preview/reference comparisons and 40 migrations |
| Untrusted labels | Chromium 156.0.8078.74 treated an SVG-event-handler label as literal accessible button text. No SVG/image/script element appeared, the handler marker stayed unset, and activation worked |
| Authoring fuzz coverage | Added an `author` target checking bounded source acceptance across versions, exact migration parity and decoded preview/render equality. Execution evidence is pending |

The [generated runner](../../tests/conformance/generated.py) fixes its seed and case count, with 8–64 pixel canvases and at most 16 shapes. It compares independently evaluated pixels. Maximum budgets, malformed inputs, host faults and accessibility remain separate tests.

## Open review questions

1. **Android provider faults and liveness.** The activity bounds bytes and checks generations but has no explicit read deadline. Targeted provider tests must cover stalled reads, queued selections, permission revocation, oversized input and Activity destruction. Confirm failed selections clear earlier presentation. This is a source-review follow-up, not a reproduced security advisory.
2. **Combined memory.** File bytes and owned chunk data can each approach 16 MiB. Assets can hold 12 MiB of RGB; a maximum preview scanline allocation is `(3 × 2048 + 1) × 2048` bytes. RGB frames, RGBA presentation, Java/JavaScript buffers and GPU allocations add separate costs. Per-component caps do not establish a resident-memory ceiling. Measure overlapping lifetimes and low-memory behavior before defining the supported-device baseline.
3. **Fuzzing scope.** Decoder smoke inputs are limited to 65,537 bytes; structured mutations and authoring to 64 KiB. Larger production budgets have separate boundary tests. Successful time-limited fuzzing does not cover all 16 MiB files or all source inputs.
4. **Normative agreement.** Check exact fields, duplicate keys, unsigned tokens, Unicode scalars, source-null handling, capability fallback, unknown extensions, pixel centers and occlusion. Distinguish envelope acceptance, scene validation, preview extraction and render-budget failures. Record mismatches rather than selecting a convenient implementation as the authority.
5. **Host/release scope.** Synthetic-origin Chromium tests do not execute Java provider failures. Debug Android signatures and unsigned candidate build records remain test artifacts. External review, stable provenance, accessibility and broader devices remain open.

Sensitive findings use [private security reporting](../../SECURITY.md). Other findings need a minimized licensed input, expected/actual behavior and full revisions.

## Independent reviewer procedure

1. Record identity, independence/conflicts, reviewed revision, toolchain, OS/WebView and inspected areas. Review the wire/raster RFCs and compatibility decisions.
2. Start from a fresh checkout and run the [local checks](../TESTING.md), fixed and generated conformance, schema and browser suites. Build WASM before viewer tests.
3. Implement an independent decoder/runtime from the specification without calling the Rust implementation. Compare valid/malformed acceptance, failure categories, initial pixels and normalized traces. Add independently authored edge cases.
4. Run both sanitizer targets with recorded corpora, limits, duration and execution counts. Minimize failures and preserve sensitive evidence privately.
5. Examine the open questions above. For each finding, record impact, reproduction, disposition and verification of any fix. Automated scans do not substitute for manual review.
6. Obtain the two actual independent reviews required by [governance](../GOVERNANCE.md). Do not mark either approved before its report exists.

| External report | Status |
| --- | --- |
| Specification/interoperability | Pending; reviewer/revision not assigned |
| Security/trust boundaries | Pending; reviewer/revision not assigned |

For local author fuzzing, seed `fuzz/corpus/author` with `examples/*.source.json`, then run `cargo +nightly fuzz run author -- -max_len=65536 -max_total_time=60`. The workflow runs both targets, defaults to 600 seconds per target, validates its optional `seconds` input within 1–600, and fetches locked dependencies before enabling offline Cargo mode.
