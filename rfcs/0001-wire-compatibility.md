# RFC 0001 — Visual container and compatibility

- Status — Draft
- Target — First visual profile
- Predecessor — [experimental container v0.1](../spec/IIMG-0.1.md)

## Motivation

A visual document must carry a static image that a preview-capable host can extract even when it cannot execute the interactive profile. The existing v0.1 sample remains a historical container test.

## Candidate wire rules

- Retain the 8-byte magic, two version bytes, two zero reserved bytes, big-endian chunk lengths and IEEE CRC over type plus payload. Assign wire version 0.2 to the first visual experiment, pending review.
- Require exactly one `META` as the first chunk and exactly one `PREV` immediately after it. Require one `SCNE`; allow at most one `ASST` and one `INTR`. Order these as `SCNE`, optional `ASST`, optional `INTR`, with an empty `IEND` last and no trailing bytes. Ancillary chunks may occur between `PREV` and `IEND` without changing the order of known chunks.
- Keep first-letter case as the criticality bit. Validate type, size, framing and checksum before interpreting the payload. CRC detects corruption and carries no authenticity guarantee.
- Use `META` for dimensions, profile identifier and explicit required capability identifiers. A subsequent payload RFC defines these fields, the allowed PNG subset and its image budgets, and the typed scene/asset constraints. The container and image limits must both pass before preview decoding.
- Writers creating a new file emit only documented chunks. Editors should drop unknown ancillary chunks when rewriting a document until a safe-to-copy contract is defined. Byte-preserving transfer may copy the entire file as received.

## Reader decisions

| Input | Container reader | Visual viewer |
| --- | --- | --- |
| Experimental v0.1 | Accept under historical container rules | Identify the historical format and explain available support |
| Supported version, profile and capabilities | Accept if valid | Validate the full document and render it |
| Supported framing, unsupported required capability or unknown critical chunk | Reject full interpretation with an unsupported diagnostic | Offer static preview only if the preview profile is understood and the complete envelope passes validation |
| Unknown wire version or reserved flag | Reject with an unsupported diagnostic | Use host error UI |
| Invalid order, lengths, checksum or required preview | Reject with a malformed diagnostic | Use host error UI |

Preview-only parsing validates the full envelope, including type spelling, bounds, order, multiplicity, checksums and end marker. It treats unsupported payloads as opaque and never instantiates a runtime. It validates the required fields it understands in `META` and validates the embedded PNG before decoding it. A full reader also validates cross-references, scene and behavior semantics.

## Acceptance fixtures

- Original v0.1 fixture and decoder behavior are preserved, with a recorded hash.
- Small valid visual file with a known preview, plus variants with unsupported capabilities, an unknown critical chunk and an unknown ancillary chunk.
- Missing or repeated mandatory chunks, out-of-order chunks, unsupported version and reserved flags, CRC corruption including corruption after the preview, and trailing bytes.
- Preview cases for oversized dimensions, unsupported PNG features, and a malformed PNG with an otherwise correct outer CRC.
- Record independently derived fixture bytes or expected outcomes so compatibility tests can catch shared encoder and decoder errors.

## Open questions

Choose the extensibility rules for future versions, decide whether preview dimensions can differ from the canvas and how their aspect ratios are checked, and assign provisional byte and pixel limits before implementing the visual profile. The stable profile needs a migration decision for the experimental 0.2 format.
