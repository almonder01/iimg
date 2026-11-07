# IIMG Core candidate security model

Draft MOTN uses at most 64 unique geometry tracks, bounded duration/repeat totals and an integer clock capped at one day. Both endpoint placements validate before animation; signed interpolation remains between them. Full-scene work bounds remain in effect. Replay validates time/preference events before mutating runtime, and direct bad clocks leave it unchanged. The web host throttles to at most approximately 30 fps, reuses its RGBA frame, stops background/paused/reduced/completed scheduling and cancels stale RAFs on unload. Android forwards Activity visibility. These controls bound behavior; physical low-memory and independent review gates remain separate.

Draft state actions use a distinct critical STAC chunk, at most 32 KiB, with 32 bounded integer states, 64 controls, eight distinct state writes per group and one indexed binding per object. References/ranges/styles validate before execution; actions cannot dispatch events, execute code, schedule work or perform I/O. Hidden objects still count in worst-case render work and decoded-asset budgets. Hidden targets are excluded from focus/activation. See [RFC 0003](../rfcs/0003-state-actions.md). Authoring checks scene/interaction payload lengths before constructing additional detection/serialization trees. Core changes remain subject to independent security review; internal differential tests are not that review.

Treat every input file, URI stream, PNG, source document and event trace as untrusted. The format carries declarative geometry and bounded state transitions. File bytes grant no authority to perform network access, execute code or read other files.

| Boundary | Current controls | Evidence |
| --- | --- | --- |
| File and chunk framing | Read bounds, checked offsets, exact versions, CRC and ordering checks | Rust parser tests and independent malformed envelope cases |
| PNG decoding | Compressed size, dimensions and aggregate asset area limits before decode. Exact scanline output and zlib checksum, followed by RGB reconstruction in the same buffer | All five filters, split IDAT, malformed streams, maximum canvas and embedded asset tests |
| Scene and interaction | Named-field JSON objects, unsigned integer tokens, strict fields, bounded lists, validated references, fixed geometry and one state change per event | Independent array-substitution and Unicode cases, atomic invalid replay, semantic comparison and mutation tests |
| Rendering | Bounded canvas and shape bounding-box visits; reference renders use validated geometry | Overlap, render-budget and pixel-parity tests |
| Browser and Android | Local selected bytes, isolated native WebView origin, fixed shell assets, inert text labels and a static fallback | Chromium offline/inert-label checks and emulator parity; [Galaxy S23+ physical smoke evidence](https://github.com/almonder01/iimg/pull/2). Provider faults and broader devices remain separate review areas |

CRC is an accidental corruption check. When origin matters, use an authenticated transport or verify a trusted digest. The preview is authored content and should receive the same trust as any other pixels supplied by the document author.

For a single PNG, the scanline allocation is `(3 × width + 1) × height` bytes. Reconstructing RGB in place eliminates a second `3 × width × height` byte allocation, or 12 MiB at 2048 × 2048. The returned vector retains the scanline allocation, including at most 2048 bytes of capacity beyond its RGB length.

Before release, review the combined worst-case allocation across document bytes, decoded assets, preview buffers, rendering buffers and host copies. Test CPU and allocation behavior on low-memory Android devices. Review dependencies and the Android URI and WebView boundaries independently. Sustained sanitizer runs, advisory readiness and external security review remain separate evidence.

The later Android preview clears prior presentation at selection start and bounds provider work to two process-wide reader threads with one queued read. A 15-second deadline completes the UI request independently of the provider. Cancellation signals and descriptor close are best-effort on a separate bounded executor; permanently non-cooperative providers can retain reader slots. Ten JVM contract cases cover timeout, stale callbacks, lifecycle and backpressure, and the companion APK supplies real provider-fault cases. Physical acceptance of that new host behavior is recorded separately from the earlier phone smoke test.

The [large-scene benchmark](BENCHMARKS.md#large-scene-and-gallery-run--2026-11-05) measures WASM capacity and post-GC browser-process samples. It does not establish a whole-app peak-memory ceiling or low-memory Android acceptance. The new host/adapter code needs review at its own revision; the initial review report's runtime revision remains a historical scope.

The [technical review and independent-review handoff](reviews/2026-11-05-core-candidate.md) records reviewed boundaries, reproducible evidence and open provider-liveness, memory and interoperability questions. The 2026-11-05 [Linux advisory workflow](https://github.com/almonder01/iimg/actions/runs/42032499751) checked 154 distinct locked package versions across Rust, npm and Maven and found no OSV matches. This result is an advisory query for those versions at that time, not a certification of the runtime or build chain.

## Locked dependency advisories

RFC 0003–0006 add bounded declarative state groups, clock-driven translation, a single cancelable drag capture and optional alternative descriptions. Hidden geometry counts toward the worst-case render budget. Traces validate ranges and references before mutating runtime state. Gesture generations and host lifecycle events prevent stale input from carrying into another document. Descriptions and labels enter the DOM through text or literal attributes. Text authoring rasterizes system fonts into the existing bounded RGB asset subset. File readers do not load author fonts. Review the new payload parsers and composed interaction/host lifecycles at the exact candidate revision.

Run `python -B scripts/audit_dependencies.py` after fetching the locked runtime and fuzz Cargo dependencies. The script sends public package names and exact versions to OSV and fails when an advisory matches or the request fails. It also checks the browser-test npm lockfile. OSV includes the RustSec advisory feed. [RustSec advisory database](https://github.com/RustSec/advisory-db) · [OSV batch API](https://google.github.io/osv.dev/post-v1-querybatch/)

The local run on 2026-11-04 returned no advisory IDs for 35 distinct Rust and npm versions. It covered 13 runtime/build packages, 24 fuzz-harness packages and one browser-test package, with overlap between the Cargo scopes.

After adding the schema validator on 2026-11-05, the Rust/fuzz/npm check covered 40 distinct versions and returned no advisory matches. The new packages are development tooling. Viewer runtime dependencies are recorded separately by the artifact SBOMs.

## Android dependency inventory

The Android build can report the resolved Maven coordinates for both APK modules. Run the Gradle command from the repository root and use an absolute init-script path.

```powershell
$init = (Resolve-Path scripts/android_dependency_report.gradle).Path
gradle -p viewers/android --init-script $init iimgAndroidDependencyReport --no-daemon
python -B scripts/audit_dependencies.py --android-report viewers/android/build/reports/iimg-dependencies.json
```

The first scan of AGP 8.7.3 reported advisories for 14 distinct build-tool dependencies, with no Maven packages in the app runtime graph. After upgrading to AGP 9.5.0, Gradle 9.6.0 and Build Tools 36.0.0, both debug APKs built. The viewer APK passed asset and debug signature checks. OSV matched seven distinct versions, all in the build graph. The two runtime dependencies, Kotlin stdlib 2.2.10 and JetBrains annotations 13.0, returned no advisory IDs. [AGP compatibility](https://developer.android.com/build/releases/agp-9-5-0-release-notes)

| Build dependency | Prior version | Fixed selection | Advisory IDs |
| --- | --- | --- | --- |
| Guava | 33.4.0-jre | 33.7.2-jre | GHSA-xxph-c9ww-hj94 |
| Commons Lang | 3.16.0 | 3.18.0 | GHSA-j288-q9x7-2f5v |
| jose4j | 0.9.5 | 0.9.6 | GHSA-3677-xxcr-wjqv |
| Bouncy Castle PKIX | 1.80.2 | 1.85 | GHSA-wg6q-6289-32hp |
| Bouncy Castle provider | 1.80.2 | 1.85 | GHSA-9pwp-9qqc-pr26, GHSA-qp49-qgx5-5m26 |
| JDOM | 2.0.6 | 2.0.6.1 | GHSA-2363-cqg2-863c |
| Kotlin Gradle plugin | 2.2.10 | 2.4.20 | GHSA-r937-wjx7-w2jp |

The follow-up resolution selected every fixed version in both modules through overrides scoped to their build classpaths. Both debug APKs rebuilt, and the viewer APK passed asset and signature checks. The 2026-11-04 OSV scan found no matches across 149 distinct package versions, including 112 Android build packages per module and two runtime packages per variant. Keep checking the scheduled audit and remove overrides once the upstream toolchain resolves fixed versions. The Maven inventory does not cover the Gradle distribution, Android SDK tools or device WebView itself. [Gradle resolution rules](https://docs.gradle.org/current/userguide/dependency_management.html) · [OSV API](https://google.github.io/osv.dev/api/)
