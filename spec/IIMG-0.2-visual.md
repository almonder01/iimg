# IIMG 0.2 visual profile draft

This experimental draft defines the initial vector payload and PNG preview restrictions for the envelope in [RFC 0001](../rfcs/0001-wire-compatibility.md). The historical 0.1 envelope remains separately identifiable.

## Metadata and scene

`META` and `SCNE` are UTF-8 JSON objects, limited to 4 KiB and 128 KiB respectively. Each listed field is required. Unknown and duplicate fields are invalid. Numeric fields use JSON integer tokens.

All numeric tokens are unsigned decimal integers matching `0|[1-9][0-9]*`. Negative zero, fractions, exponents and booleans are invalid numeric values. Strings and member names contain Unicode scalar values. Reject unpaired surrogate escapes. Every schema object, including each shape and control, requires named fields. An array cannot substitute for an object.

| Chunk | Fields |
| --- | --- |
| `META` | `profile` is `iimg-visual-0.2`; `width` and `height` are integers from 1 to 2048; `required` lists the enabled capabilities without duplicates. The current capabilities are `raster-png` and [`toggle-fill`](IIMG-0.2-interaction.md). |
| `SCNE` | `background` is an RGB triplet; `objects` is an ordered array of at most 256 shapes. |

Each shape has a unique case-sensitive `id` of 1–64 ASCII letters, digits, underscores or hyphens, an RGB triplet `fill` and a `type`. RGB triplets contain exactly three integers in 0–255 interpreted as opaque sRGB. The origin is the upper-left canvas corner. Coordinates increase rightward and downward. All geometry uses nonnegative integer canvas units and fits entirely within the canvas.

- `rect` requires `x`, `y`, `width` and `height`. Extents are positive. Left and top edges are included; right and bottom edges are excluded.
- `circle` requires `cx`, `cy` and a positive `radius`. Points on the boundary are included.

Fill the canvas with the background first, then draw objects in array order. A reference rasterizer samples pixel centers at `(x + 0.5, y + 0.5)` and replaces the pixel with the last covering color. The reference implementation rejects rendering if the sum of all shape bounding-box areas exceeds 16,777,216 pixel visits. Optional asset and interaction schemas are separate work.

## Raster assets

The `raster-png` capability requires exactly one `ASST` chunk containing 1–32 embedded PNGs. A document without that capability omits `ASST`. The [raster asset RFC](../rfcs/0002-raster-assets.md) specifies the binary table, aggregate pixel limit and the `image` object's `id`, `asset`, `x` and `y` fields. Image objects use the source RGB pixels without scaling. The independent `raster-lamp.iimg` fixture places a PNG tile under a vector circle.

## PNG preview

`PREV` is a standalone static PNG of at most 1 MiB and exactly the canvas dimensions. The initial profile accepts 8-bit RGB, standard compression and filtering, and no interlace. The stream consists of the PNG signature, one `IHDR`, consecutive `IDAT` chunks containing a nonempty stream, and an empty `IEND`. The PNG has at most 1024 chunks, each with a valid CRC. No bytes follow `IEND`.

A full preview reader validates the zlib checksum and consumes exactly one stream without trailing bytes. It enforces the exact filtered output length of `height × (1 + 3 × width)`, reconstructs filters 0–4, and rejects all other filters. An independent fixture check compares the decoded preview pixels against the Rust renderer. [PNG specification](https://www.w3.org/TR/png-3/)

## Preview-only compatibility

Preview-only readers check the complete 0.2 envelope before extracting the PNG. They require the understood metadata profile and bounded canvas dimensions. They can ignore the required capability list and treat scene, asset, interaction and unknown extension payloads as opaque. Unknown critical extensions are allowed only after the mandatory metadata and preview prefix. Full readers reject unknown critical extensions and unsupported required capabilities.

## Reference fixture

The [independent generator](../tests/fixtures/v0.2/generate.py) produces a 32×32 scene with one yellow circle and an embedded PNG. The checked-in `lamp.iimg` is 388 bytes with SHA-256 `3d516c44bba8aab0bcdaf1a9a2ef3e11290ccc53c942d2b6259c8673a61d5e65`. Generate on a scratch copy when checking reproducibility across zlib versions.
