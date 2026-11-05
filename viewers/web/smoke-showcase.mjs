import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const manifestPath = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL("target/showcase/manifest.json", root));
const directory = dirname(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const binary = await readFile(process.argv[3] ?? new URL("target/wasm32-unknown-unknown/release/iimg_web.wasm", root));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
let activations = 0;
for (const scene of manifest.scenes) {
  const { instance } = await WebAssembly.instantiate(binary);
  const wasm = instance.exports;
  const file = await readFile(resolve(directory, scene.file));
  assert.equal(file.length, scene.fileBytes);
  assert.equal(sha(file), scene.sha256);
  const pointer = wasm.prepare_input(file.length);
  assert.notEqual(pointer, 0);
  new Uint8Array(wasm.memory.buffer, pointer, file.length).set(file);
  assert.equal(wasm.load(), 0, scene.name);
  const output = () => Buffer.from(new Uint8Array(wasm.memory.buffer, wasm.output_ptr(), wasm.output_len()));
  const frame = () => { assert.equal(wasm.render(), 0); return output(); };
  wasm.describe();
  const description = JSON.parse(output());
  assert.equal(description.width, scene.width);
  assert.equal(description.height, scene.height);
  assert.deepEqual(description.controls.map(({ target, label }) => ({ target, label })),
    scene.controls.map(({ target, label }) => ({ target, label })));
  assert.equal(sha(frame()), scene.initialRgbSha256);
  for (const [index, control] of scene.controls.entries()) {
    wasm.reset();
    const [x, y] = control.point;
    wasm.activate_pixel(x, y);
    const pixels = frame();
    const offset = (y * scene.width + x) * 3;
    assert.deepEqual([...pixels.subarray(offset, offset + 3)], control.activePixel, control.label);
    if (index === 0) assert.equal(sha(pixels), scene.activeRgbSha256);
    wasm.describe();
    assert.deepEqual(JSON.parse(output()).controls.map(({ pressed }) => pressed),
      scene.controls.map((_, position) => position === index));
    wasm.reset(); wasm.focus_control(index); wasm.activate_focused();
    assert.deepEqual(frame(), pixels, `${scene.name}: keyboard differs from pointer`);
    activations++;
  }
  wasm.reset();
  assert.equal(sha(frame()), scene.initialRgbSha256);
  wasm.unload();
  assert.notEqual(wasm.render(), 0);
}
console.log(`${manifest.scenes.length} large scenes matched native RGB hashes; ${activations} controls passed pointer/keyboard/reset checks.`);
