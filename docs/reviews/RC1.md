# Core 1.0 RC1 review handoff

Review the exact source revision and artifacts listed in the candidate build record. The supported reference surface is the Rust SDK and CLI, the offline web viewer and editor, and the Android viewer. The format can be implemented independently from the specification, RFCs, schemas and fixtures. Native iOS, desktop gallery integration, messaging thumbnails, MIME registration and broad platform adoption have separate tracks.

| Area | Evidence and review focus |
| --- | --- |
| Envelope and PNG | Historical valid/invalid vectors, generated scenes, budget limits, preview recovery, CRC and canonical ordering |
| State and motion | RFC 0003 and RFC 0004. Independent frame hashes, atomic grouped events, hidden focus, integer time, repeat and reduced motion |
| Drag and values | RFC 0005. Trace rejection and pixel parity, pointer capture cancellation, hidden ranges and disjoint geometry ownership |
| Text and accessibility | RFC 0006 and ADR 0002. Authoring-side shaping, source hint validation, pixel preservation, literal alternative descriptions and safe language labels |
| Host lifecycle | Android reader tests, content URI handoff and WebView pixels, browser load/reset/unload samples, bounded memory and private signing tests |
| Distribution | Verify archive checksums, extracted CLI and WASM, clean-source build record, APK certificate, and candidate workflow provenance |

For each finding record the tested commit, package hash, file hash, expected behavior, actual behavior and a reproducible command or trace. Use private disclosure for sensitive findings. [Security reporting](../../SECURITY.md)

The stable decision requires the owner's [manual acceptance](../RC1-ACCEPTANCE.md), the two independent reviews described in [governance](../GOVERNANCE.md), accepted normative RFCs and compatibility registry, exact-revision automated evidence, and the signed Android artifact. The separate Python evaluator supplies independent code paths within this project. External reviewers provide the independent review decisions.
