import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve, sep } from "node:path";
const root=new URL("../../",import.meta.url);
const binary=process.argv[2]??new URL("target/wasm32-unknown-unknown/release/iimg_web.wasm",root);
const directory=process.argv[3]?pathToFileURL(resolve(process.argv[3])+sep):new URL("tests/fixtures/drag/",root);
const data=await readFile(new URL("drag.iimg",directory));
const manifest=JSON.parse(await readFile(new URL("manifest.json",directory)));
const w=(await WebAssembly.instantiate(await readFile(binary))).instance.exports;
const output=(wasm=w)=>Buffer.from(new Uint8Array(wasm.memory.buffer,wasm.output_ptr(),wasm.output_len()));
function load(wasm,bytes){const p=wasm.prepare_input(bytes.length);assert.ok(p);new Uint8Array(wasm.memory.buffer,p,bytes.length).set(bytes);return wasm.load();}
assert.equal(load(w,data),0);
for(const [name,hash] of Object.entries(manifest.rgbSha256)){
  w.reset();
  for(const e of JSON.parse(await readFile(new URL(`${name}.trace.json`,directory))).events){
    if(e.type==="set_slider")assert.equal(w.set_slider_value(e.index,e.value),0);
    else if(e.type==="drag_start"||e.type==="drag_move")w[e.type](e.x,e.y);
    else w[e.type]();
  }
  assert.equal(w.render(),0);assert.equal(createHash("sha256").update(output()).digest("hex"),hash,name);
}
w.reset();assert.equal(w.drag_start(40,32),0);w.drag_move(88,32);assert.equal(w.set_slider_value(0,26),1);
w.describe();assert.equal(JSON.parse(output()).drag_index,0);
assert.equal(w.drag_move(65536,0),1);assert.equal(w.drag_start(0,65536),1);
w.drag_cancel();w.describe();assert.equal(JSON.parse(output()).sliders[0].value,25);
if(process.env.IIMG_OLD_WASM){
  const old=(await WebAssembly.instantiate(await readFile(process.env.IIMG_OLD_WASM))).instance.exports;
  assert.equal(load(old,data),1);let preview;
  for(let at=12;at<data.length;){const n=data.readUInt32BE(at);if(data.toString("ascii",at+4,at+8)==="PREV")preview=data.subarray(at+8,at+8+n);at+=n+12;}
  assert.deepEqual(output(old),preview);console.log("Pre-DRAG engine returned the exact PNG preview.");
}
console.log(`${Object.keys(manifest.rgbSha256).length} DRAG WASM frames matched independent hashes; invalid calls were atomic.`);
