import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const execute = promisify(execFile);
const root = new URL("../../", import.meta.url);
const manifestPath = resolve(process.argv[2] ?? fileURLToPath(new URL("target/showcase/manifest.json", root)));
const directory = dirname(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const binary = await readFile(new URL("target/wasm32-unknown-unknown/release/iimg_web.wasm", root));
const repetitions = Number(process.env.IIMG_BENCH_REPETITIONS ?? 20);
assert.ok(Number.isInteger(repetitions) && repetitions >= 2 && repetitions <= 100);
const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const color = (rgb) => `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;

function nativeSources(source) {
  const controlled = new Map(source.interaction.controls.map((control) => [control.target, control]));
  const body = `<rect width="${source.width}" height="${source.height}" fill="${color(source.scene.background)}"/>`
    + source.scene.objects.map((shape) => {
      const common = `id="${xml(shape.id)}" fill="${color(shape.fill)}"`
        + (controlled.has(shape.id) ? ` role="button" tabindex="0" aria-label="${xml(controlled.get(shape.id).label)}" aria-pressed="false"` : "");
      if (shape.type === "rect") return `<rect ${common} x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"/>`;
      assert.equal(shape.type, "circle");
      return `<circle ${common} cx="${shape.cx}" cy="${shape.cy}" r="${shape.radius}"/>`;
    }).join("");
  const controls = JSON.stringify(source.interaction.controls.map(({ target, active_fill }) => ({
    target, active: color(active_fill),
  }))).replaceAll("<", "\\u003c");
  const script = `for(const control of ${controls}){const e=document.getElementById(control.target);const initial=e.getAttribute('fill');const toggle=()=>{const on=e.getAttribute('aria-pressed')!=='true';e.setAttribute('aria-pressed',String(on));e.setAttribute('fill',on?control.active:initial)};e.addEventListener('click',toggle);e.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle()}})}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${source.width}" height="${source.height}">${body}</svg>`;
  return [
    { format: "SVG", mime: "image/svg+xml", script,
      text: svg.replace("</svg>", `<script><![CDATA[${script}]]></script></svg>`) },
    { format: "HTML", mime: "text/html", script,
      text: `<!doctype html><meta charset="utf-8"><style>body{margin:0}</style>${svg}<script>${script}</script>` },
  ];
}

async function residentSample(browserSession) {
  try {
    const { processInfo } = await browserSession.send("SystemInfo.getProcessInfo");
    const ids = processInfo.map(({ id }) => Number(id));
    assert.ok(ids.length && ids.every((id) => Number.isSafeInteger(id) && id > 0));
    if (process.platform === "win32") {
      const script = `$rows=@(foreach($processId in @(${ids.join(",")})){try{$item=[Diagnostics.Process]::GetProcessById($processId);[pscustomobject]@{pid=$processId;rssBytes=$item.WorkingSet64;privateBytes=$item.PrivateMemorySize64}}catch{}});ConvertTo-Json -InputObject $rows -Compress`;
      const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 15000 });
      const rows = JSON.parse(stdout);
      return { method: "sum of current browser-process working sets/private bytes after explicit GC",
        processCount: rows.length, residentBytes: rows.reduce((sum, row) => sum + row.rssBytes, 0),
        privateBytes: rows.reduce((sum, row) => sum + row.privateBytes, 0) };
    }
    const { stdout } = await execute("ps", ["-o", "rss=", "-p", ids.join(",")], { timeout: 5000 });
    const values = stdout.trim().split(/\s+/).map(Number);
    assert.ok(values.every(Number.isFinite));
    return { method: "sum of current browser-process RSS after explicit GC",
      processCount: values.length, residentBytes: values.reduce((sum, value) => sum + value * 1024, 0) };
  } catch (error) {
    return { available: false, reason: error.message };
  }
}

const server = createServer((request, response) => {
  if (request.url !== "/") { response.writeHead(404).end(); return; }
  response.writeHead(200, { "Content-Type": "text/html" })
    .end('<!doctype html><style>body{margin:0}</style><main></main>');
});
await new Promise((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
const executablePath = process.env.IIMG_CHROMIUM;
let browser;
try {
  browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
  const browserSession = await browser.newBrowserCDPSession();
  const results = [];
  for (const scene of manifest.scenes) {
    const file = await readFile(resolve(directory, scene.file));
    const source = JSON.parse(await readFile(resolve(directory, `${scene.name}.source.json`), "utf8"));
    for (const variant of [{ format: "IIMG" }, ...nativeSources(source)]) {
      const page = await browser.newPage({ viewport: { width: 2200, height: 2200 }, deviceScaleFactor: 1 });
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        const pageSession = await page.context().newCDPSession(page);
        await pageSession.send("Performance.enable");
        const timings = await page.evaluate(async ({ binary, file, variant, scene, repetitions }) => {
          const raw = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
          const wasmBytes = raw(binary), bytes = raw(file);
          const mount = document.querySelector("main");
          const canvas = document.createElement("canvas");
          canvas.width = scene.width; canvas.height = scene.height;
          const context = canvas.getContext("2d");
          let engine, linearBytes = 0;
          const output = (wasm) => new Uint8Array(wasm.memory.buffer, wasm.output_ptr(), wasm.output_len());
          function draw(wasm) {
            if (wasm.render() !== 0) throw new Error("Render failed");
            const rgb = output(wasm), frame = context.createImageData(scene.width, scene.height);
            for (let from = 0, to = 0; from < rgb.length; from += 3, to += 4) {
              frame.data[to] = rgb[from]; frame.data[to + 1] = rgb[from + 1];
              frame.data[to + 2] = rgb[from + 2]; frame.data[to + 3] = 255;
            }
            context.putImageData(frame, 0, 0);
            linearBytes = Math.max(linearBytes, wasm.memory.buffer.byteLength);
          }
          function open(wasm) {
            if (variant.format === "IIMG") {
              mount.replaceChildren(canvas);
              const pointer = wasm.prepare_input(bytes.length);
              if (!pointer) throw new Error("Input allocation failed");
              new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
              if (wasm.load() !== 0) throw new Error("Load failed");
              wasm.describe();
              const description = JSON.parse(new TextDecoder().decode(output(wasm)));
              if (description.width !== scene.width || description.height !== scene.height) throw new Error("Wrong dimensions");
              draw(wasm);
            } else {
              const parsed = new DOMParser().parseFromString(variant.text, variant.mime);
              const svg = parsed.querySelector("svg");
              svg.querySelector("script")?.remove();
              mount.replaceChildren(document.importNode(svg, true));
              new Function(variant.script)(); // Trusted, locally generated benchmark sources only.
            }
          }
          function activate() {
            if (variant.format === "IIMG") { engine.activate_pixel(...scene.activation); draw(engine); }
            else mount.querySelector(`#${scene.controls[0].target}`).dispatchEvent(new MouseEvent("click"));
          }
          const initial = [], reopen = [], activation = [], reopenFrame = [], activationFrame = [];
          for (let index = 0; index < repetitions; index++) {
            const start = performance.now();
            const instance = variant.format === "IIMG" ? (await WebAssembly.instantiate(wasmBytes)).instance : null;
            open(instance?.exports);
            initial.push(performance.now() - start);
          }
          if (variant.format === "IIMG") engine = (await WebAssembly.instantiate(wasmBytes)).instance.exports;
          open(engine);
          for (let index = 0; index < repetitions; index++) {
            await new Promise((resolve) => requestAnimationFrame(() => {
              const start = performance.now(); open(engine); reopen.push(performance.now() - start);
              requestAnimationFrame(() => { reopenFrame.push(performance.now() - start); resolve(); });
            }));
            await new Promise((resolve) => requestAnimationFrame(() => {
              const start = performance.now(); activate(); activation.push(performance.now() - start);
              requestAnimationFrame(() => { activationFrame.push(performance.now() - start); resolve(); });
            }));
          }
          let activeRgbSha256;
          if (variant.format === "IIMG") {
            const digest = await crypto.subtle.digest("SHA-256", output(engine));
            activeRgbSha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
            window.iimgBenchEngine = engine;
          } else {
            const control = mount.querySelector(`#${scene.controls[0].target}`);
            if (control.getAttribute("aria-pressed") !== "true") throw new Error("Activation was a no-op");
          }
          const summarize = (values) => {
            values.sort((a,b) => a-b);
            return { median: (values[Math.floor((values.length-1)/2)] + values[Math.ceil((values.length-1)/2)]) / 2,
              p95: values[Math.ceil(values.length * .95)-1] };
          };
          return { initialWorkMs: summarize(initial), reopenWorkMs: summarize(reopen),
            activationWorkMs: summarize(activation), reopenToNextFrameMs: summarize(reopenFrame),
            activationToNextFrameMs: summarize(activationFrame), maxWasmLinearBytes: linearBytes,
            activeRgbSha256 };
        }, { binary: binary.toString("base64"), file: file.toString("base64"), variant, scene, repetitions });
        if (variant.format === "IIMG") assert.equal(timings.activeRgbSha256, scene.activeRgbSha256);
        else {
          const png = await page.locator("main svg").screenshot();
          const pixel = await page.evaluate(async ({ png, point }) => {
            const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
            const canvas = new OffscreenCanvas(image.width, image.height);
            const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
            return [...context.getImageData(...point, 1, 1).data];
          }, { png: png.toString("base64"), point: scene.activation });
          assert.deepEqual(pixel, [...scene.activePixel, 255]);
        }
        delete timings.activeRgbSha256;
        await pageSession.send("HeapProfiler.collectGarbage");
        const { metrics } = await pageSession.send("Performance.getMetrics");
        const heap = Object.fromEntries(metrics.filter(({ name }) => name.startsWith("JSHeap")).map(({ name, value }) => [name, value]));
        const resident = await residentSample(browserSession);
        results.push({ scene: scene.name, width: scene.width, height: scene.height, objects: scene.objects,
          iimgSha256: scene.sha256,
          format: variant.format, fileBytes: variant.text ? Buffer.byteLength(variant.text) : file.length,
          ...timings, javascriptHeapAfterGc: heap, browserProcessesAfterGc: resident });
        console.error(`Measured ${scene.name} ${variant.format}`);
      } finally { await page.close(); }
    }
  }
  console.log(JSON.stringify({ methodology: "gallery-v1", browser: browser.version(), node: process.version,
    platform: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model,
    viewport: [2200,2200], deviceScaleFactor: 1, repetitions, wasmBytes: binary.length,
    wasmSha256: createHash("sha256").update(binary).digest("hex"),
    notes: ["Inputs already in memory; no network transfer measured.",
      "IIMG work includes load/render/canvas submission; native work includes parse/mount/handlers and is not a paint-time ranking.",
      "Next-frame timings measure scheduling opportunity, not physical presentation.",
      "WASM capacity and JS heap are separate. Browser RSS/private-byte samples include shared engine/renderer overhead and are not peak resident measurements.",
      "Summed process working sets can count shared pages more than once. GC and correctness checks are outside timed samples."], results }, null, 2));
} finally {
  await browser?.close();
  await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
}
