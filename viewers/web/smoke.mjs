import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const binary = process.argv[2] ?? new URL("target/wasm32-unknown-unknown/release/iimg_web.wasm", root);
const { instance } = await WebAssembly.instantiate(await readFile(binary));
const wasm = instance.exports;
const fixture = await readFile(new URL("tests/fixtures/v0.2/two-controls.iimg", root));

function load(bytes) {
  const input = wasm.prepare_input(bytes.length);
  assert.notEqual(input, 0);
  new Uint8Array(wasm.memory.buffer, input, bytes.length).set(bytes);
  return wasm.load();
}

function output() {
  return Buffer.from(new Uint8Array(wasm.memory.buffer, wasm.output_ptr(), wasm.output_len()));
}

function frame() {
  assert.equal(wasm.render(), 0);
  return output();
}

assert.equal(wasm.prepare_input(16 * 1024 * 1024 + 1), 0);
assert.equal(load(fixture), 0);
wasm.describe();
const metadata = JSON.parse(output());
assert.deepEqual(metadata.controls.map(({ target, pressed }) => [target, pressed]), [
  ["lamp", false], ["switch", false],
]);
const initial = frame();
assert.equal(initial.length, 32 * 32 * 3);
wasm.activate_pixel(16, 16);
wasm.activate_pixel(2, 2);
const pointer = frame();
assert.notDeepEqual(pointer, initial);
assert.deepEqual([...pointer.subarray(0, 3)], [88, 210, 130]);
wasm.reset();
assert.deepEqual(frame(), initial);
wasm.focus_control(0);
wasm.activate_focused();
wasm.focus_control(1);
wasm.activate_focused();
assert.deepEqual(frame(), pointer);
const metaLength = fixture.readUInt32BE(12);
const metaEnd = 20 + metaLength;
function withCapabilities(required) {
  const meta = JSON.parse(fixture.subarray(20, metaEnd));
  return withMetadata({ ...meta, required });
}
function withMetadata(meta) {
  const payload = Buffer.from(JSON.stringify(meta));
  const replacement = Buffer.alloc(payload.length + 12);
  replacement.writeUInt32BE(payload.length);
  replacement.write("META", 4);
  payload.copy(replacement, 8);
  let crc = 0xffffffff;
  for (const byte of replacement.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  replacement.writeUInt32BE((~crc) >>> 0, replacement.length - 4);
  return Buffer.concat([fixture.subarray(0, 12), replacement, fixture.subarray(metaEnd + 4)]);
}
assert.equal(load(withCapabilities(["toggle-fill", "future-fill"])), 1);
const previewStart = metaEnd + 4;
const previewLength = fixture.readUInt32BE(previewStart);
assert.deepEqual(output(), fixture.subarray(previewStart + 8, previewStart + 8 + previewLength));
assert.equal(load(withCapabilities(["toggle-fill", "toggle-fill"])), 2);
assert.equal(load(withCapabilities(["future-fill"])), 2);
assert.equal(load(withMetadata(Object.values(JSON.parse(fixture.subarray(20, metaEnd))))), 2);
const corrupt = Buffer.from(fixture);
corrupt[20] ^= 1;
assert.equal(load(corrupt), 2);
assert.notEqual(wasm.render(), 0);
for (const source of [
  [1, 1, { background: [0, 0, 0], objects: [] }, null, []],
  { width: 1, height: 1, scene: [[0, 0, 0], []] },
]) {
  const bytes = Buffer.from(JSON.stringify(source));
  const input = wasm.prepare_input(bytes.length);
  new Uint8Array(wasm.memory.buffer, input, bytes.length).set(bytes);
  assert.equal(wasm.compile_source_v1(), 1);
  assert.match(output().toString(), /InvalidJson/);
}
console.log("WebAssembly file load, interaction parity, reset, preview fallback and corrupt-input checks passed.");
assert.equal(load(fixture), 0);
assert.notEqual(wasm.prepare_input(123), 0);
wasm.unload();
assert.equal(wasm.output_len(), 0);
assert.equal(wasm.load(), 2);
wasm.describe();
assert.equal(wasm.output_len(), 0);
assert.notEqual(wasm.render(), 0);
assert.equal(load(fixture), 0);
console.log("WebAssembly unload clears pending input/runtime/output and allows recovery.");
