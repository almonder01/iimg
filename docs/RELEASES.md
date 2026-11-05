# Release Engineering

Use SemVer for packages; mark format versions separately. Until 1.0, wire-format changes may break compatibility and MUST be recorded in `CHANGELOG.md`.

Release candidate procedure:
1. Freeze milestone and close/block outstanding release issues.
2. Validate clean clone on supported platforms; run CI, security scans and conformance suite.
3. Generate sample files with release candidate, decode with previous compatible versions.
4. Verify reproducible builds where supported; produce SHA-256 checksums and SBOM.
5. Review dependencies and licenses; audit unsafe code; ensure advisory process ready.
6. Tag `vX.Y.Z`, publish signed artifacts/provenance where supported, changelog and migration notes.
7. Run post-release smoke tests and monitor crash/security reports.

Hotfix: branch from latest stable tag; regression test first; minimal patch; security disclosure coordination if needed; patch release and backport.

## Local candidate package

Run the source-only build check after fetching the locked dependencies and installing the WASM target. It copies tracked and non-ignored source files into two new directories, excludes generated artifacts and Git metadata, and verifies one build with the Rust, independent conformance and WASM suites. Both release builds use path remapping before the binary comparison.

```powershell
python -u -B scripts/verify_clean_candidate.py --scratch target/clean-candidate-check
```

A worktree snapshot checks source completeness without relying on existing build products. On Windows MSVC the verifier passes `/Brepro` to the final CLI link to avoid time-dependent executable metadata. For release provenance, rerun from a clean, published revision and record the exact toolchain and platform.

Build the CLI and WASM from the same checkout. The packager records the supplied binary digests, Cargo lock digest, source HEAD and worktree status. These records describe a local package and carry no signature.

```powershell
cargo build --locked --release -p iimg-cli
cargo build --locked --release --target wasm32-unknown-unknown -p iimg-web
python -B scripts/package_candidate.py --cli target/release/iimg-cli.exe --wasm target/wasm32-unknown-unknown/release/iimg_web.wasm --target x86_64-pc-windows-msvc --output target/candidate-review
```

The output directory must be new. It contains CLI, web, specification and conformance archives, the build record, a CycloneDX dependency list for each Rust artifact, and SHA-256 checksums. Archives use fixed entry order, timestamps and permissions. Repackaging the same binaries and source files tests archive reproducibility. Build reproducibility requires comparing binaries built independently from a clean revision.

Each archive includes the project [license policy and legal texts](../LICENSES.md). The CLI and web archives also include license and notice files from the resolved Cargo dependency sources under `licenses/cargo/`. Their manifest records each package, its declared license and its notice-file digests. The verifier checks dependency coverage against the SBOM and rejects missing or changed notices.

Verify a package you built before passing it to a reviewer.

```sh
python -B scripts/verify_candidate_package.py target/candidate-review
```

The **Candidate review package** workflow runs for pull requests and manual dispatch on Windows, Linux and macOS and requires a clean checkout. It uploads review artifacts after checksums, extracted conformance, loopback transfer and WebAssembly tests pass. These artifacts support candidate review.

Published revision `252ebc9a9c307e5797819dc2ae14011dd72b4dcd` passed the [three-platform package run](https://github.com/almonder01/iimg/actions/runs/42011192784). Download `iimg-candidate-ubuntu-latest`, `iimg-candidate-windows-latest` or `iimg-candidate-macos-latest` from that run, then use the verifier above on the downloaded directory. The separate [Android run](https://github.com/almonder01/iimg/actions/runs/42011192386) provides `iimg-android-debug`. These are review artifacts subject to GitHub retention, with a debug Android signature and unsigned build records. Stable releases require the remaining review and provenance gates.

Verify the checksums, then extract the archives into a scratch directory and run the conformance comparison against the extracted CLI. Use the [web smoke tests](../viewers/web/README.md) and [Android device checks](../viewers/android/README.md) before release. The local debug APK has separate asset and signature checks. Device acceptance and a release-signed APK are separate gates. Publication also requires the confirmed license texts and signed provenance where supported.

See the [adoption and registration tracker](ADOPTION.md) for work separate from the Core release.
