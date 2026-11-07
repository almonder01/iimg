# Author an IIMG document

Use the web viewer's **Author an IIMG image** panel or the CLI. Both use the same Rust compiler and generate a standalone document with an embedded static PNG.

## Visual workspace

Open **Author an IIMG image** to load the visual editor. It is available in the web distribution; Android remains a reference viewer. The editor module is cached with the web shell for offline use after the first successful localhost/HTTPS load.

1. Choose **New canvas**, set dimensions/background, and select **Apply canvas**. Add a rectangle or circle.
2. Select an object on the design canvas or in **Objects (back to front)**. Drag its outline, use arrow keys on the focused canvas (Shift moves ten pixels), or set numeric properties and choose **Apply object**. Pointer cancellation/Escape discards an unfinished drag. **Move forward/backward** changes layer order; **Delete selected** also removes its toggle binding.
3. Enable **Toggle color on activation**, supply a control name and active color, and apply. Names are literal Unicode text, including Arabic; Core still enforces its UTF-8 byte limit.
4. Select **Validate and preview** to operate the design in the separate viewer, then **Download IIMG**. The Core 1.0 checkbox selects candidate versus experimental 0.2 export. Design dragging edits initial geometry; it does not add drag interactions to the exported file.
5. Use **Save source JSON** to keep the editable project. **Import source JSON** restores it, including embedded raster assets. Compiled `.iimg` files open in the viewer but cannot yet be decompiled into editable source. Keep both source and exported file.

The JSON panel and visual workspace edit the same source. The editor compiles and renders using a separate WASM instance, loaded only when authoring opens; it cannot change the viewer's open document. Invalid JSON clears the design and disables visual properties/export until repaired. An invalid property operation is rejected with a diagnostic while retaining the last accepted source. Shrinking a canvas does not silently clip or move its objects. A selected rectangle/circle has a resize corner button: drag it, use arrows while it is focused (Shift for ten units), or activate it to focus numeric size properties. Circle keyboard resizing changes its radius; raster images retain their native size.

Undo/redo keeps up to 40 accepted source snapshots, with an approximate 4 MiB UTF-16 text-history budget. One accepted document can exceed that history budget and is kept alone; this is not a total-memory limit. Import is bounded by the 12 MiB source limit and late reads cannot overwrite newer edits.

Choose **Template → Use template** for an original card, signal lights or room lights; replacing the design can be undone. **Add PNG image** embeds a Core-compatible PNG at the origin. The PNG must be at most 1 MiB, non-interlaced RGB8 without transparency, and fit the current canvas. Its exact bytes are preserved. Core checks the full PNG and aggregate asset budgets; corrupt, oversized or unsupported imports retain the accepted design and explain the rejection. Other PNG profiles are not silently converted. Move the imported object through the canvas/list/properties.

Recovery is **off by default**. **Keep a local recovery copy in this browser** opts in to one last accepted source document, debounced by 350 ms and limited to 2 MiB of serialized UTF-16 text including its version/timestamp wrapper. The file remains local to this browser origin; it is not uploaded, and selected viewer files are not included. Oversized projects or blocked/full storage produce a diagnostic and retain the prior copy. On reload, **Restore recovery copy** validates and restores it only on request; ordinary opening must not overwrite an existing copy. **Discard recovery copy** deletes it; disabling recovery deletes it too and stops writes. Use source JSON as a portable backup regardless of recovery. Source/font/RFC expansion is tracked in the [next-development plan](NEXT-DEVELOPMENT.md).

## Multi-state interactions (draft)

**Multi-state interactions → Convert to multi-state controls** converts up to 32 existing toggle controls without changing their initial/active colors. A scene with no control starts from its first object. The editor enables Core 1.0 export; explicitly selecting 0.2 makes the compiler reject the unsupported capability. Keep the source for editing.

Add or update named states (ASCII IDs, initial value and maximum 1–15). Select a scene object, name its control and add/update a `cycle` or `set` action for a chosen state; multiple distinct states form one atomic group. Select a binding state and edit each value's visibility/color, then **Apply state binding**. A bound color overrides the object's base fill. Growing/shrinking a state resizes its bound style lists using the previous last style for new values; out-of-range set actions reject the transaction. A referenced or last state cannot be deleted, and the editor preserves at least one state control.

Ordinary geometry edits retain all state/action/binding data. Deleting an object removes its control and binding references; an attempted deletion of the last state control is rejected. Image targets can control state and have visibility bindings, but cannot have color overrides. Hidden targets are omitted from viewer hit testing and semantic controls; **Reset image** restores declared initial values. See [RFC 0003](../rfcs/0003-state-actions.md) and `examples/state-panel.source.json`. Old viewers supporting unknown-critical preview fallback show the initial PNG instead of executing STAC. Pre-extension CLI/WASM behavior was checked separately; this draft still requires review.

## JSON and CLI

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

The [source JSON schema](../spec/schemas/source.schema.json) supports editor hints and structural validation. The [schema guide](../spec/schemas/README.md) describes the semantic and lexical checks performed by Core.
