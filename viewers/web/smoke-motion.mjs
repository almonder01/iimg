import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve, sep } from "node:path";
const root = new URL("../../", import.meta.url);
const binary = process.argv[2] ?? new URL("target/wasm32-unknown-unknown/release/iimg_web.wasm", root);
const directory = process.argv[3] ? pathToFileURL(resolve(process.argv[3]) + sep) : new URL("tests/fixtures/motion/", root);
const data = await readFile(new URL("motion.iimg", directory));
const manifest = JSON.parse(await readFile(new URL("manifest.json", directory)));
const w = (await WebAssembly.instantiate(await readFile(binary))).instance.exports;
const output = () => Buffer.from(new Uint8Array(w.memory.buffer,w.output_ptr(),w.output_len()));
function load(wasm, bytes) { const pointer=wasm.prepare_input(bytes.length); assert.ok(pointer); new Uint8Array(wasm.memory.buffer,pointer,bytes.length).set(bytes); return wasm.load(); }
assert.equal(load(w,data),0);
for (const [name,expected] of Object.entries(manifest.rgbSha256)) {
  w.motion_preference(0); w.reset();
  const trace=JSON.parse(await readFile(new URL(`${name}.trace.json`,directory)));
  for (const event of trace.events) {
    if(event.type==="activate_pixel")w.activate_pixel(event.x,event.y);
    if(event.type==="advance_time")assert.equal(w.advance_time(event.milliseconds),0);
    if(event.type==="motion_preference")assert.equal(w.motion_preference(Number(event.reduced)),0);
    if(event.type==="reset")w.reset();
  }
  assert.equal(w.render(),0);
  assert.equal(createHash("sha256").update(output()).digest("hex"),expected,name);
}
w.motion_preference(0);w.reset();w.activate_pixel(5,5);assert.equal(w.advance_time(500),0);
assert.equal(w.render(),0);const previous=output();
assert.equal(w.advance_time(499),1);assert.equal(w.advance_time(86400001),1);
assert.equal(w.render(),0);assert.deepEqual(output(),previous);
if(process.env.IIMG_OLD_WASM){
  const old=(await WebAssembly.instantiate(await readFile(process.env.IIMG_OLD_WASM))).instance.exports;
  assert.equal(load(old,data),1);
  let preview;
  for(let at=12;at<data.length;){const length=data.readUInt32BE(at);if(data.toString("ascii",at+4,at+8)==="PREV")preview=data.subarray(at+8,at+8+length);at+=length+12;}
  assert.deepEqual(Buffer.from(new Uint8Array(old.memory.buffer,old.output_ptr(),old.output_len())),preview);
  console.log("Pre-motion engine returned exact PNG fallback for MOTN.");
}
console.log(`${Object.keys(manifest.rgbSha256).length} finite-motion WASM frames matched independent hashes; invalid clocks preserved the frame.`);
