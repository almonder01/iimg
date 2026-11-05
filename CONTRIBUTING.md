# Contributing to IIMG

Start with the [project overview](README.md), the [Core 1.0 candidate](spec/IIMG-1.0-candidate.md) and the [local checks](docs/TESTING.md). The [0.1 specification](spec/IIMG-0.1.md) describes the historical sample.

The [SDK guide](docs/SDK.md) covers embedding, input normalization and host buffer ownership. Generate the Rust API reference with `cargo doc --locked --workspace --no-deps`.

1. Search existing issues and discussions. Use `good first issue` for onboarding.
2. Open an issue describing expected behavior, actual behavior, reproducible sample and platform.
3. For wire format, API, security model or major features, open an RFC issue before implementation.
4. Fork, create `fix/<issue>-short-name` or `feat/<issue>-short-name` from `main`.
5. Add tests **before** the fix when feasible. Include positive, negative and boundary cases.
6. Run the local Rust and conformance checks. Run the relevant viewer checks if your change affects a host adapter.
7. Submit a small PR linked to issue, explain compatibility/security/performance effects and attach proof.
8. Respond to review; squash/rebase only as maintainers request; never force-push shared branches without coordination.

PRs that change the wire format without a versioning and migration plan are not mergeable. AI-assisted contributions are welcome, but the author must review code, disclose meaningful AI assistance, and take responsibility for tests and licensing.

No external assets, sample documents or copied code without a compatible license and attribution. Never submit real secrets or private files as fixtures.

Code and project-authored fixture contributions use Apache-2.0. Documentation and specification contributions use CC BY 4.0. See the [license policy](LICENSES.md) for scopes and the treatment of earlier published revisions.
