import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve, sep } from "node:path";
const root = new URL("../../", import.meta.url);
const wasmPath = process.argv[2] ?? new URL("target/wasm32-unknown-unknown/release/iimg_web.wasm", root);
const directory = process.argv[3] ? pathToFileURL(resolve(process.argv[3]) + sep) : new URL("tests/fixtures/state-actions/", root);
const bytes = await readFile(new URL("panel.iimg", directory));
const manifest = JSON.parse(await readFile(new URL("manifest.json", directory)));
const { instance } = await WebAssembly.instantiate(await readFile(wasmPath));
const w = instance.exports;
const output = () => Buffer.from(new Uint8Array(w.memory.buffer, w.output_ptr(), w.output_len()));
function load(wasm, data) { const pointer = wasm.prepare_input(data.length); assert.ok(pointer); new Uint8Array(wasm.memory.buffer, pointer, data.length).set(data); return wasm.load(); }
const frame = () => { assert.equal(w.render(), 0); return createHash("sha256").update(output()).digest("hex"); };
assert.equal(load(w, bytes), 0);
assert.equal(frame(), manifest.rgbSha256.initial);
w.describe(); assert.equal(JSON.parse(output()).controls[0].visible, false);
w.focus_control(0); w.activate_focused(); assert.equal(frame(), manifest.rgbSha256.initial);
for (const [x, y] of [[2,2],[22,2],[2,2],[42,2]]) w.activate_pixel(x,y);
assert.equal(frame(), manifest.rgbSha256.pointer);
w.describe(); assert.equal(JSON.parse(output()).controls[3].visible, false);
w.reset(); assert.equal(frame(), manifest.rgbSha256.reset);
for (const index of [1,2,3,0]) { w.focus_control(index); w.activate_focused(); }
assert.equal(frame(), manifest.rgbSha256.keyboard);
if (process.env.IIMG_OLD_WASM) {
  const old = (await WebAssembly.instantiate(await readFile(process.env.IIMG_OLD_WASM))).instance.exports;
  assert.equal(load(old, bytes), 1, "Old runtime must choose static preview for new critical STAC");
  let preview;
  for (let offset=12;offset<bytes.length;) { const size=bytes.readUInt32BE(offset); if (bytes.toString("ascii",offset+4,offset+8)==="PREV") preview=bytes.subarray(offset+8,offset+8+size); offset+=size+12; }
  assert.deepEqual(Buffer.from(new Uint8Array(old.memory.buffer, old.output_ptr(), old.output_len())), preview);
  console.log("Pre-extension WASM returned the exact static PNG for STAC; full interaction was not attempted.");
}
console.log("State-actions WASM matched independent initial/grouped-action/keyboard/reset RGB hashes and hidden-control behavior.");
