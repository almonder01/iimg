import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const root = new URL("../../", import.meta.url);
const vector = await readFile(new URL("tests/fixtures/v0.2/interactive-lamp.iimg", root));
const raster = await readFile(new URL("tests/fixtures/v1.0/raster-toggle.iimg", root));

function tilePng(file) {
  for (let offset = 12; offset < file.length;) {
    const size = file.readUInt32BE(offset);
    if (file.toString("ascii", offset + 4, offset + 8) === "ASST") {
      const table = file.subarray(offset + 8, offset + 8 + size);
      assert.equal(table.readUInt16BE(0), 1);
      const lengthField = 3 + table[2];
      const length = table.readUInt32BE(lengthField);
      assert.equal(lengthField + 4 + length, table.length);
      return table.subarray(lengthField + 4).toString("base64");
    }
    offset += 12 + size;
  }
  throw new Error("raster fixture lacks the PNG tile");
}

function sources(tile) {
  const image = tile ? `<image x="6" y="15" width="4" height="2" href="data:image/png;base64,${tile}"/>` : "";
  const body = `<rect width="32" height="32" fill="#1a202c"/>${image}<circle id="lamp" cx="16" cy="16" r="8" fill="#facc15" role="button" tabindex="0" aria-label="Lamp" aria-pressed="false"/>`;
  const script = `const lamp=document.getElementById('lamp');function toggle(){const pressed=lamp.getAttribute('aria-pressed')==='false';lamp.setAttribute('aria-pressed',pressed);lamp.setAttribute('fill',pressed?'#f87171':'#facc15')}lamp.addEventListener('click',toggle);lamp.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle()}})`;
  return [
    { type: "image/svg+xml", text: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">${body}<script><![CDATA[${script}]]></script></svg>`, script },
    { type: "text/html", text: `<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><svg width="32" height="32">${body}</svg><script>${script}</script>`, script },
  ];
}

const executablePath = process.env.IIMG_CHROMIUM;
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
const repetitions = Number(process.env.IIMG_BENCH_REPETITIONS ?? 20);
assert.ok(Number.isInteger(repetitions) && repetitions >= 2 && repetitions <= 100 && repetitions % 2 === 0);
try {
  const page = await browser.newPage();
  await page.setContent("<main></main>");
  const results = [];
  for (const fixture of [{ name: "vector", file: vector }, { name: "raster", file: raster }]) {
    for (const source of sources(fixture.name === "raster" ? tilePng(fixture.file) : undefined)) {
      const timings = await page.evaluate(async ({ source, repetitions }) => {
        const opening = [], activation = [], frameOpportunity = [];
        const mount = document.querySelector("main");
        const parser = new DOMParser();
        for (let index = 0; index < repetitions; index++) {
          let start = performance.now();
          const parsed = parser.parseFromString(source.text, source.type);
          const svg = parsed.querySelector("svg");
          svg.querySelector("script")?.remove();
          mount.replaceChildren(document.importNode(svg, true));
          new Function(source.script)();
          opening.push(performance.now() - start);
          const lamp = mount.querySelector("#lamp");
          if (lamp.getAttribute("fill") !== "#facc15") throw new Error("lamp failed to open");
          await new Promise((resolve) => requestAnimationFrame(() => {
            start = performance.now();
            lamp.dispatchEvent(new MouseEvent("click"));
            activation.push(performance.now() - start);
            requestAnimationFrame(() => {
              frameOpportunity.push(performance.now() - start);
              resolve();
            });
          }));
          if (lamp.getAttribute("fill") !== "#f87171" || lamp.getAttribute("aria-pressed") !== "true") {
            throw new Error("activation did not change the lamp");
          }
        }
        function summarize(samples) {
          samples.sort((a, b) => a - b);
          const middle = samples.length / 2;
          return { median: (samples[middle - 1] + samples[middle]) / 2,
            p95: samples[Math.ceil(samples.length * 0.95) - 1] };
        }
        return { parseAndMountMs: summarize(opening), activationToDomMs: summarize(activation),
          activationToNextFrameMs: summarize(frameOpportunity) };
      }, { source, repetitions });
      const screenshot = await page.locator("main svg").screenshot();
      const pixels = await page.evaluate(async (png) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = new OffscreenCanvas(32, 32);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, 32, 32);
        return [[16, 16], [6, 15]].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
      }, screenshot.toString("base64"));
      assert.deepEqual(pixels[0], [248, 113, 113, 255]);
      assert.deepEqual(pixels[1], fixture.name === "raster" ? [80, 175, 240, 255] : [26, 32, 44, 255]);
      results.push({ fixture: fixture.name, format: source.type, iimgBytes: fixture.file.length,
        nativeBytes: Buffer.byteLength(source.text), ...timings });
      console.error(`Measured ${fixture.name} ${source.type}`);
    }
  }
  console.log(JSON.stringify({ browser: browser.version(), repetitions, results }, null, 2));
} finally {
  await browser.close();
}
