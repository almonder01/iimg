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

No auto-publishing workflow exists in this starter; configure repository secrets and approval environments before enabling releases.
