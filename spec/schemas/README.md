# JSON schemas for the Core candidate

These [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-validation) documents describe the structural JSON models used by the Core candidate and its authoring tools.

| File | Model |
| --- | --- |
| `common.schema.json` | Shared identifiers, RGB values, coordinates, dimensions and labels |
| `metadata.schema.json` | Candidate 1.0 metadata with the currently supported capabilities |
| `scene.schema.json` | Rectangle, circle and image objects |
| `interaction.schema.json` | Ordered toggle controls |
| `state-actions.schema.json` | Draft STAC state variables, action groups and visibility/color bindings |
| `motion.schema.json` | Draft finite MOTN tracks and endpoint placements |
| `source.schema.json` | Authoring JSON accepted by the CLI and web editor |
| `trace.schema.json` | Portable version 1 event traces |

Load all eight schemas into a validator before resolving references. Their IDs identify repository locations, and the test runner resolves the supplied files locally. Configure editor schema associations externally. Adding a `$schema` member to an IIMG payload or authoring source would violate its exact-field rules. State/action references, maximum-dependent styles, unique targets/writes, motion lifetime/placement and total byte/work budgets additionally require Core validation.

Run the schema tests after building the WASM engine and installing the locked development dependencies.

```sh
cargo build --locked --release --target wasm32-unknown-unknown -p iimg-web
npm --prefix viewers/web ci --ignore-scripts
npm --prefix viewers/web run test:schemas
```

The runner uses pinned [Ajv 2020 support](https://ajv.js.org/json-schema.html#draft-2020-12-breaking) in strict mode. It checks the independently generated fixture payloads, authoring examples and portable traces. Its negative cases cover arrays substituted for objects, invalid fields, numeric ranges, list limits and malformed identifiers.

The specification/conformance archive includes the schemas, test runner and npm lockfile. When testing that archive, supply the WASM extracted from the matching web archive with `npm --prefix viewers/web run test:schemas -- /path/to/iimg_web.wasm` after installing the locked dependencies.

## Complete validation

The [Core specification](../IIMG-1.0-candidate.md) also requires raw UTF-8 and integer-token validation, unique JSON members and valid Unicode scalar strings. Parsing JSON before schema validation can discard duplicate members and the distinction between `0`, `-0` and `0.0`. Standard schema string lengths count characters, while Core limits accessible labels by UTF-8 bytes and rejects whitespace-only labels.

Full readers additionally check envelope framing and CRCs, JSON byte limits, capability/chunk agreement, unique object and asset IDs, cross-references, canvas-relative geometry, PNG validity, aggregate asset pixels and rendering work. The `contentEncoding` annotation describes Base64 data, and the Core compiler checks its actual bytes and PNG format. Preview-only readers follow the separate fallback rules and can skip unsupported capability declarations.

The test runner includes sources that satisfy the structural schemas but fail Core semantic or lexical checks. Use `iimg-cli compile-v1` for complete source validation and `iimg-cli validate` for encoded documents. The independent [conformance runner](../../tests/README.md) exercises complete reader behavior.
