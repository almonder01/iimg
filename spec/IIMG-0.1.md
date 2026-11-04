# IIMG Container Specification — EXPERIMENTAL DRAFT 0.1

Status: **non-normative experimental draft**, subject to incompatible changes. The words MUST/SHOULD/MAY are proposed requirements.

## Wire format
- All integers are unsigned, network byte order (big-endian).
- Header: 8-byte magic `49 49 4D 47 0D 0A 1A 0A`, 1-byte major=0, 1-byte minor=1, 2 reserved zero bytes.
- Repeated chunks: `length:u32 | type:4 ASCII letters | payload:length bytes | crc32:u32`.
- CRC-32/ISO-HDLC (IEEE), polynomial `0xEDB88320`, initial/final XOR `0xFFFFFFFF`, over type+payload (not length).
- Chunk types are ASCII letters. Uppercase first letter means critical: unknown critical chunks MUST be rejected. Lowercase first letter means ancillary: unknown ancillary chunks MAY be skipped after validating their length and CRC.
- `META` MUST occur exactly once and first. `IEND` MUST occur exactly once, last, with empty payload. No trailing bytes.
- Draft chunk names: `META`, `PREV`, `SCNE`, `INTR`, `ASST`, `IEND`.
- Reference parser caps: file 16 MiB, chunk 8 MiB, 1024 chunks. Limits are provisional and are not standardized.

## Payload status
The v0.1 reference uses **uncompressed UTF-8 JSON** in `META`, `SCNE`, `INTR` for demonstrations. **No payload schema is normative yet**; `PREV` and `ASST` payloads are not yet implemented. CBOR/Zstd are candidates for a future profile, NOT features of this version.

## Preview interoperability
Native `.iimg` files cannot automatically render in ordinary image apps. A future embedded static preview is mandatory for a production profile, but requires a documented preview codec, extraction rules, and viewer support. PNG ancillary-chunk embedding is a separate research track and does not imply persistence through messenger recompression.

## Behavior profile proposal
Event → finite-state transition → visual update. No executable script, network requests, filesystem access or external resources. Limits on state transitions, recursion, time, decompression ratio and allocations must be standardized before v1.0.

## Version negotiation
Readers reject unknown major/minor versions in v0.1. Future versions require a defined capabilities registry, required-feature flags, compatibility matrix and downgrade behavior.

## Open issues before v1
Canonical payload schema, unicode/text shaping, font licensing, coordinate model, color management, animation timeline, accessibility, content integrity, canonical encoding, memory budgets, security threat model, deterministic event ordering, forward compatibility, MIME registration.
