# ADR 0002: text is authored into pixels in the first Core release

Status: proposed/implemented draft for candidate review, 2026-11-07.

The Core scene intentionally has a small deterministic vocabulary. Portable live text would require font-file licensing, shaping, bidirectional layout, fallback metrics, input composition and new parser/security surfaces. The first-release authoring tool can already embed bounded RGB PNG assets.

Use source text hints and a bounded author-side text rasterizer, plus an optional accessible description/language carrier, as specified in RFC 0006. Keep exported pixels authoritative. Preserve editable text in source projects; do not mislabel this as runtime editable text. Authors may regenerate different glyph pixels on another font/shaping host. Embedded fonts, arbitrary forms and runtime text input are outside the selected Core release scope.

This completes the text-profile decision and practical text authoring, while leaving a future live-text profile subject to a separate RFC and interoperability/security evidence. The alternative of freezing a font/shaping engine into every reader is deferred. The optional metadata does not negotiate a new visual capability or prevent old readers displaying pixels.
