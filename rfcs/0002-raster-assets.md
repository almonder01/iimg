# RFC 0002 — Embedded raster assets

Status — Implemented experimentally in the Rust visual reader.

An image object references one self-contained PNG resource. An author can combine these objects with vector shapes while retaining a standalone static preview for older readers.

## Wire proposal

Declare the required capability `raster-png` and add one `ASST` chunk after `SCNE`. Its payload begins with an unsigned big-endian 16-bit count followed by that many entries. Each entry consists of a one-byte identifier length, the ASCII identifier, a big-endian 32-bit byte length and a complete PNG datastream. Entries have no padding and the payload ends after the final entry.

Asset IDs follow the scene ID syntax and are unique within the asset table. The draft limit is 32 entries and 1 MiB per compressed PNG. Each image uses the visual preview's RGB8 PNG subset and a side length from 1 through 2048. Reject documents whose aggregate decoded asset area exceeds 4,194,304 pixels. Read dimensions and account for the aggregate before decoding any image data.

## Scene and rendering

An `image` object has an object ID, an asset ID, and nonnegative integer coordinates `x` and `y`. It covers the asset at its native pixel dimensions, with the rectangle edge semantics of the visual profile. Reject missing references and out-of-canvas geometry. Count the image bounding area toward the existing scene rendering budget. Copy opaque RGB pixels in scene order. Scaling and transparency require their own capability and sampling rules.

## Compatibility and acceptance

- A preview-only reader can extract the existing preview after checking the full envelope. A full reader without the capability reports it as unsupported.
- Include a reference fixture with both a raster object and a vector object over it, and compare the scene renderer with the embedded preview.
- Cover duplicate IDs, unresolved references, invalid PNG data, trailing asset bytes, coordinate overflow and aggregate decoded pixel limits.
