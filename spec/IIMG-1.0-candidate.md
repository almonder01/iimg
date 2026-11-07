# IIMG Core 1.0 candidate

Status — draft for interoperability and security review. The 1.0 wire values are provisional until the release gate is met.

## Envelope

All binary integers are unsigned and big-endian. A file starts with the eight bytes `49 49 4d 47 0d 0a 1a 0a`, version bytes `01 00` and two zero reserved bytes. Its length is at most 16 MiB.

A chunk is `length:u32 | type:4 ASCII letters | payload:length bytes | crc:u32`. CRC-32/ISO-HDLC covers type followed by payload. Each payload is at most 8 MiB and the file has at most 1024 chunks. `META` and `PREV` occur once, in that order, as the first two chunks. The known sequence then contains one `SCNE`, optional `ASST`, optional `INTR` or `STAC` (mutually exclusive), optional `MOTN` after `STAC`, and one empty `IEND`. No bytes follow `IEND`.

Unknown lowercase-initial chunk types can be skipped after the mandatory prefix. Full readers reject unknown uppercase-initial chunks. Preview readers may skip either type after the prefix. Every reader verifies the full envelope, including CRCs after the preview. Writers should omit unknown extensions when rewriting a document unless their rules explicitly permit copying. CRC detects corruption and does not authenticate content.

## Profile and payloads

The `META` object uses `profile: "iimg-core-1"`, dimensions from 1 through 2048 and a list of unique required capability identifiers. Metadata, scene and interaction JSON use UTF-8 with exact fields, no duplicates and integer tokens for numeric fields. The [visual payload draft](IIMG-0.2-visual.md#metadata-and-scene) defines the canvas, RGB colors, shape fields, object order and pixel sampling. Core uses the same payload semantics with the candidate metadata identifier above.

Objects, including individual shapes, controls and replay events, use JSON objects with named fields. Arrays cannot substitute for them. All numeric fields use unsigned decimal integer tokens matching `0|[1-9][0-9]*` within the field's range. Negative zero, fractions, exponents and booleans are invalid numeric values. JSON strings and member names contain Unicode scalar values. Reject unpaired surrogate escapes.

| Capability | Required chunk | Behavior |
| --- | --- | --- |
| Baseline | `META`, `PREV`, `SCNE`, `IEND` | Static RGB scene with rectangle and circle objects |
| `raster-png` | `ASST` | [Binary asset table and image objects](../rfcs/0002-raster-assets.md) |
| `toggle-fill` | `INTR` | [Declarative controls and normalized events](IIMG-0.2-interaction.md) |
| `state-actions` | `STAC` | [Bounded state groups, visibility and color bindings](../rfcs/0003-state-actions.md) |
| `motion-linear` | `MOTN` and `STAC` | [Finite linear placement tracks and logical time](../rfcs/0004-bounded-motion.md) |

Optional capability chunks are present exactly when their capability is required. Each capability identifier is case-sensitive. A full reader reports malformed capability metadata when the list repeats an identifier or a known optional chunk disagrees with its declaration. Otherwise a reader that encounters an unsupported required capability reports unsupported for full rendering. A preview-only reader may ignore required capabilities and scene payloads when the metadata profile, dimensions, envelope and PNG are valid.

The [PNG subset](IIMG-0.2-visual.md#png-preview) defines static RGB8 images with validated zlib checksums, exact scanline length and filter reconstruction. The preview has the canvas dimensions. Authors generate it from the initial render. Readers may recover a valid static preview from a file whose interactive content is unsupported.

## Bounds and event behavior

The visual payload is limited to 128 KiB, metadata to 4 KiB and interaction to 32 KiB. A scene has at most 256 objects and 64 controls. Each PNG is at most 1 MiB. An asset table contains 1–32 PNGs and at most 4,194,304 aggregate decoded pixels. Reject rendering above 16,777,216 bounding-box pixel visits.

Controls start unpressed with no focus. Events dispatch synchronously in order and never schedule other events. A single activation changes at most one control. A host should expose the ordered controls as toggle buttons with names and pressed states. Files contain no executable code or external resources.

## Migration and version policy

Readers recognize exact version/profile combinations. A candidate 1.0 reader can also support the distinct 0.2 draft profile and the 0.1 historical container. A reader that only understands older versions must reject the 1.0 envelope. Readers reject unrecognized wire versions rather than guessing payload layouts.

```sh
cargo run --locked -p iimg-cli -- upgrade-v1 old-0.2.iimg candidate-1.0.iimg
```

The migration validates the source profile and its preview, updates the version and profile, preserves known non-metadata payloads byte for byte, and drops unknown ancillary chunks. Use source authoring to rebuild historical 0.1 files with explicit visual and interaction semantics.

## Release evidence

The [machine-readable schemas](schemas/README.md) describe metadata, scene, interaction, authoring and trace structure. The complete validation rules above also apply to file readers and compilers.

The versioned candidate fixture exercises both capabilities and is generated independently of the Rust writer. The conformance runner verifies candidate acceptance, preview and initial frame parity, and migration parity for both portable interaction traces. Review the limits and diagnostics, expand the candidate fixture suite, and obtain cross-platform, Android, security and release evidence before marking this specification stable.

## Draft state-actions capability

RFC 0003 specifies the opt-in STAC payload, limits and hidden-target focus/hit semantics. It requires Core 1.0 and cannot coexist with toggle-fill/INTR. The static PNG is generated from declared initial states. The 32 KiB state payload allows at most 32 variables, 64 controls, eight distinct state writes per control and 256 indexed bindings; values range from zero through at most 15. Hidden geometry still counts toward the complete scene work budget. Existing activation/focus/reset traces apply. This draft extends the candidate and is not an independently approved stable capability.

## Draft finite motion

RFC 0004 specifies MOTN, requiring state-actions in Core 1.0. At most 64 tracks translate fixed-size objects between validated endpoints with bounded duration/repetition. Logical time, preferences, exact repeat boundaries, host suspension and trace atomicity follow that RFC. This opt-in draft is not an independently approved stable capability.

## Draft constrained values and text metadata

RFC 0005 specifies critical DRAG/`drag-value`: at most 32 discrete sliders, nonzero single-axis paths, bounded step-aligned values and singular cancelable capture. It may stand alone without buttons; slider targets cannot also own button controls or motion tracks. Older readers can use the PNG preview.

RFC 0006 defines optional ancillary aTXT after SCNE and before IEND, at most once/4 KiB, with bounded description/language. Readers may ignore it without changing pixels or interactions. Recognizing readers reject malformed payloads. Source text hints aid authoring only; Core raster assets carry fixed glyph pixels and no executable fonts or editable runtime forms. These additions remain drafts pending independent review.
