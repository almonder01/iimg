import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";

const root = new URL("../../", import.meta.url);
const binary = process.argv[2] ?? new URL("target/wasm32-unknown-unknown/release/iimg_web.wasm", root);
const schemaRoot = new URL("spec/schemas/", root);
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validators = new Map();
const schemas = ["common", "metadata", "scene", "interaction", "state-actions", "motion", "drag", "accessibility", "source", "trace"];
for (const name of schemas) {
  const schema = JSON.parse(await readFile(new URL(`${name}.schema.json`, schemaRoot)));
  ajv.addSchema(schema);
  validators.set(name, schema.$id);
}
for (const [name, id] of validators) validators.set(name, ajv.getSchema(id));

let positive = 0;
let negative = 0;
function check(name, value, expected) {
  const validate = validators.get(name);
  assert.equal(validate(value), expected, `${name}: ${JSON.stringify(validate.errors)}`);
  if (expected) positive++;
  else negative++;
}

for (const version of ["0.2", "1.0"]) {
  const directory = new URL(`tests/fixtures/v${version}/`, root);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", directory)));
  for (const fixture of manifest.fixtures) {
    const bytes = await readFile(new URL(fixture.path, directory));
    // The envelope and CRCs are checked by the independent conformance suite.
    for (let offset = 12; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      const kind = bytes.toString("ascii", offset + 4, offset + 8);
      const name = { META: version === "1.0" ? "metadata" : undefined, SCNE: "scene", INTR: "interaction" }[kind];
      if (name) check(name, JSON.parse(bytes.subarray(offset + 8, offset + 8 + length)), true);
      offset += length + 12;
    }
  }
}
for (const name of ["lamp", "raster-lamp"]) {
  check("source", JSON.parse(await readFile(new URL(`examples/${name}.source.json`, root))), true);
}
for (const mode of ["pointer", "keyboard"]) {
  check("trace", JSON.parse(await readFile(new URL(`tests/fixtures/v0.2/two-controls-${mode}.json`, root))), true);
}

const rectangle = { type: "rect", id: "lamp", x: 0, y: 0, width: 1, height: 1, fill: [1, 2, 3] };
const stateSource = JSON.parse(await readFile(new URL("examples/state-panel.source.json", root)));
const dragSource = JSON.parse(await readFile(new URL("examples/drag.source.json", root)));
check("accessibility",{description:"صورة تفاعلية",language:"ar-SA"},true);
check("accessibility",{description:"x",language:"en_US"},false);
check("accessibility",{description:"x",language:"en\n"},false);
check("accessibility",["x","en"],false);
check("source",{...dragSource,accessibility:{description:"Interactive image",language:"en"}},true);
check("source",dragSource,true);check("drag",dragSource.drag,true);
check("drag",{sliders:[{...dragSource.drag.sliders[0],from:[8,24]}]},false);
check("trace",{version:1,events:[{type:"drag_start",x:40,y:32},{type:"drag_move",x:88,y:32},{type:"drag_cancel"},{type:"set_slider",index:0,value:100}]},true);
const motionSource = JSON.parse(await readFile(new URL("examples/motion.source.json", root)));
check("source", motionSource, true);
check("motion", motionSource.motion, true);
check("metadata", {profile:"iimg-core-1",width:1,height:1,required:["motion-linear"]},false);
check("trace", {version:1,events:[{type:"advance_time",milliseconds:500},{type:"motion_preference",reduced:true}]},true);
check("trace", {version:1,events:[{type:"advance_time",milliseconds:86400001}]},false);
check("source", stateSource, true);
check("state-actions", stateSource.interaction, true);
check("state-actions", { ...stateSource.interaction, controls: [{target:"lamp",label:"Lamp",actions:[{type:"set",state:"x",value:16}]}] }, false);
check("state-actions", { ...stateSource.interaction, bindings: [{target:"lamp",state:"x",values:[{visible:0},{visible:true}]}] }, false);
const scene = { background: [0, 0, 0], objects: [rectangle] };
const control = { target: "lamp", label: "مصباح 💡", active_fill: [4, 5, 6] };
const source = { width: 1, height: 1, scene };
check("source", { ...source, interaction: null, assets: [] }, true);
check("interaction", { controls: [control] }, true);
for (const [name, value] of [
  ["metadata", { profile: "iimg-core-1", width: 1, height: 1, required: ["toggle-fill", "toggle-fill"] }],
  ["metadata", { profile: "iimg-core-1", width: 0, height: 1, required: [] }],
  ["metadata", { profile: "iimg-core-1", width: 1, height: 1, required: ["future-fill"] }],
  ["scene", Object.values(scene)],
  ["scene", { ...scene, objects: [Object.values(rectangle)] }],
  ["scene", { ...scene, objects: [{ ...rectangle, extra: true }] }],
  ["scene", { ...scene, objects: [{ ...rectangle, id: "lamp\n" }] }],
  ["scene", { ...scene, background: [0, true, 0] }],
  ["interaction", { controls: [Object.values(control)] }],
  ["interaction", { controls: [{ ...control, label: "Lamp\n" }] }],
  ["interaction", { controls: Array(65).fill(control) }],
  ["trace", [1, []]],
  ["trace", { version: 1, events: [{ type: "activate_pixel", x: 65536, y: 0 }] }],
  ["trace", { version: 1, events: [{ type: "reset", extra: true }] }],
  ["trace", { version: 1, events: [["reset"]] }],
  ["source", Object.values(source)],
  ["source", { ...source, assets: [["tile", "AAAA"]] }],
]) check(name, value, false);

const { instance } = await WebAssembly.instantiate(await readFile(binary));
const wasm = instance.exports;
const semanticFailures = [
  JSON.stringify({ ...source, scene: { ...scene, objects: [{ ...rectangle, x: 1 }] } }),
  JSON.stringify({ ...source, scene: { ...scene, objects: [rectangle, rectangle] } }),
  JSON.stringify({ ...source, interaction: { controls: [{ ...control, target: "missing" }] } }),
  JSON.stringify({ ...source, interaction: { controls: [{ ...control, label: "💡".repeat(65) }] } }),
  JSON.stringify({ ...source, interaction: { controls: [{ ...control, label: " " }] } }),
  JSON.stringify({ ...source, interaction: { controls: [{ ...control, label: "\ud800" }] } }),
  JSON.stringify({ ...source, assets: [{ id: "tile", png_base64: "????" }] }),
  JSON.stringify({
    width: 2048, height: 2048,
    scene: { ...scene, objects: Array.from({ length: 5 }, (_, index) => ({
      ...rectangle, id: `shape-${index}`, width: 2048, height: 2048,
    })) },
  }),
  JSON.stringify(source).replace('"x":0', '"x":-0'),
  JSON.stringify(source).replace('"x":0', '"x":0,"x":0'),
];
for (const text of semanticFailures) {
  check("source", JSON.parse(text), true);
  const bytes = Buffer.from(text);
  const pointer = wasm.prepare_input(bytes.length);
  assert.notEqual(pointer, 0);
  new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
  assert.equal(wasm.compile_source_v1(), 1, "Core must reject the invalid semantic or lexical input");
}
console.log(`Ten schemas compiled in strict mode. ${positive} positive and ${negative} negative structural cases passed.`);
console.log(`${semanticFailures.length} sources accepted structurally were rejected by Core semantic and lexical checks.`);
