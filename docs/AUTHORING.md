# Author an IIMG document

Use the web viewer's **Author an IIMG image** panel or the CLI. Both use the same Rust compiler and generate a standalone document with an embedded static PNG.

The web editor validates the JSON automatically after a short pause in editing and shows compiler diagnostics or a **Download IIMG** link. Editing the source or changing the target version clears the previous link immediately. Select **Validate and preview** to render the current source in the viewer.

```sh
cargo run --locked -p iimg-cli -- compile examples/lamp.source.json lamp.iimg
cargo run --locked -p iimg-cli -- validate lamp.iimg
```

The default export writes experimental wire version 0.2. To author a [Core 1.0 candidate](../spec/IIMG-1.0-candidate.md) directly, select **Export as Core 1.0 candidate** in the web editor or use `compile-v1` in the CLI.

```sh
cargo run --locked -p iimg-cli -- compile-v1 examples/lamp.source.json lamp-v1.iimg
```

The source is a UTF-8 JSON object of at most 12 MiB. It contains integer `width` and `height`, a `scene` object, an optional `interaction` object and an optional `assets` array. Use the fields from the [visual draft](../spec/IIMG-0.2-visual.md) and the [interaction draft](../spec/IIMG-0.2-interaction.md). The compiler generates metadata and capability flags and validates references before writing a file.

The source supports rectangles, circles, embedded RGB8 PNG images and toggle controls. Each asset contains an `id` and a `png_base64` field using standard Base64. An image object references the asset ID in its `asset` field. The compiler preserves the PNG bytes and applies the Core limits for image dimensions, total pixels and encoded asset sizes. See [the mixed raster example](../examples/raster-lamp.source.json). Retain the source JSON to edit a compiled image.
