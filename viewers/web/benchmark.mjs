import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { chromium } from "playwright-core";

const root = new URL("../../", import.meta.url);
const wasm = await readFile(new URL("target/wasm32-unknown-unknown/release/iimg_web.wasm", root));
const names = [
  "tests/fixtures/v0.2/interactive-lamp.iimg",
  "tests/fixtures/v1.0/raster-toggle.iimg",
];
const executablePath = process.env.IIMG_CHROMIUM;
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
const repetitions = 50;
try {
  const page = await browser.newPage();
  await page.setContent("<canvas width=32 height=32></canvas>");
  const results = [];
  for (const name of names) {
    const file = await readFile(new URL(name, root));
    const report = await page.evaluate(async ({ binary, documentBytes, repetitions }) => {
      const bytes = Uint8Array.from(atob(binary), (value) => value.charCodeAt(0));
      const input = Uint8Array.from(atob(documentBytes), (value) => value.charCodeAt(0));
      const canvas = document.querySelector("canvas");
      const context = canvas.getContext("2d");
      let memory = 0;

      function draw(engine) {
        if (engine.render() !== 0) throw new Error("render failed");
        const rgb = new Uint8Array(engine.memory.buffer, engine.output_ptr(), engine.output_len());
        const frame = context.createImageData(32, 32);
        for (let source = 0, dest = 0; source < rgb.length; source += 3, dest += 4) {
          frame.data[dest] = rgb[source];
          frame.data[dest + 1] = rgb[source + 1];
          frame.data[dest + 2] = rgb[source + 2];
          frame.data[dest + 3] = 255;
        }
        context.putImageData(frame, 0, 0);
        memory = Math.max(memory, engine.memory.buffer.byteLength);
      }

      function open(engine) {
        const pointer = engine.prepare_input(input.length);
        if (!pointer) throw new Error("input allocation failed");
        new Uint8Array(engine.memory.buffer, pointer, input.length).set(input);
        if (engine.load() !== 0) throw new Error("document load failed");
        draw(engine);
      }

      const cold = [], warm = [], activation = [], frameOpportunity = [];
      for (let index = 0; index < repetitions; index++) {
        const start = performance.now();
        const { instance } = await WebAssembly.instantiate(bytes);
        open(instance.exports);
        cold.push(performance.now() - start);
      }
      const { instance } = await WebAssembly.instantiate(bytes);
      const engine = instance.exports;
      open(engine);
      for (let index = 0; index < repetitions; index++) {
        let start = performance.now();
        open(engine);
        warm.push(performance.now() - start);
        await new Promise((resolve) => requestAnimationFrame(() => {
          start = performance.now();
          engine.activate_pixel(16, 16);
          draw(engine);
          activation.push(performance.now() - start);
          requestAnimationFrame(() => {
            frameOpportunity.push(performance.now() - start);
            resolve();
          });
        }));
      }
      const sample = [...context.getImageData(16, 16, 1, 1).data];
      function summarize(samples) {
        const sorted = samples.sort((a, b) => a - b);
        const middle = sorted.length / 2;
        return { median: (sorted[middle - 1] + sorted[middle]) / 2,
          p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
      }
      return {
        coldMs: summarize(cold), warmMs: summarize(warm), activationMs: summarize(activation),
        activationToNextFrameMs: summarize(frameOpportunity),
        maxWasmLinearBytes: memory, sample,
      };
    }, { binary: wasm.toString("base64"), documentBytes: file.toString("base64"), repetitions });
    assert.deepEqual(report.sample, [248, 113, 113, 255]);
    delete report.sample;
    results.push({ fixture: name, fileBytes: file.length, ...report });
  }
  console.log(JSON.stringify({
    browser: browser.version(), node: process.version, platform: `${os.platform()} ${os.release()}`,
    cpu: os.cpus()[0]?.model, repetitions, wasmBytes: wasm.length, results,
  }, null, 2));
} finally {
  await browser.close();
}
