import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const port = Number(process.argv[2]);
const mode = process.argv[3] ?? "scripted";
assert.ok(["scripted", "initial", "active", "preview", "invalid", "motion", "drag"].includes(mode), "Invalid WebView check mode");
const deadline = Date.now() + 30_000;
let websocket;
while (Date.now() < deadline && !websocket) {
  try {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(2000),
    })).json();
    websocket = pages.find((page) => page.url === "https://viewer.iimg.invalid/index.html")?.webSocketDebuggerUrl;
  } catch {
    // The debug renderer may still be starting.
  }
  if (!websocket) await new Promise((resolve) => setTimeout(resolve, 500));
}
assert.ok(websocket, "Android WebView did not expose the IIMG page");
const socket = new WebSocket(websocket);
try {
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  function evaluate(expression) {
    const request = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.removeEventListener("message", receive);
        reject(new Error("Android WebView evaluation timed out"));
      }, 5000);
      function receive(event) {
        const reply = JSON.parse(event.data);
        if (reply.id !== request) return;
        clearTimeout(timer);
        socket.removeEventListener("message", receive);
        if (reply.error || reply.result.exceptionDetails) {
          reject(new Error(JSON.stringify(reply.error ?? reply.result.exceptionDetails)));
        } else {
          resolve(reply.result.result.value);
        }
      }
      socket.addEventListener("message", receive);
      socket.send(JSON.stringify({
        id: request, method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      }));
    });
  }
  const expectedStatus = mode === "preview" ? /^Showing the static preview/
    : mode === "invalid" ? /^This IIMG file is invalid or unsupported\./ : /^Image ready/;
  let status;
  while (Date.now() < deadline) {
    status = await evaluate('document.querySelector("#status")?.textContent');
    if (expectedStatus.test(status ?? "")) {
      if (mode !== "preview" || await evaluate('document.querySelector("#preview").complete')) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.match(status ?? "", expectedStatus, `Android viewer status: ${status}`);
  if (mode === "preview") {
    const result = await evaluate(`(() => {
      const image = document.querySelector("#preview");
      const sample = document.createElement("canvas");
      sample.width = image.naturalWidth;
      sample.height = image.naturalHeight;
      const context = sample.getContext("2d");
      context.drawImage(image, 0, 0);
      return {
        visible: !image.hidden, width: image.naturalWidth, height: image.naturalHeight,
        sceneHidden: document.querySelector("#scene").hidden,
        controlsHidden: document.querySelector("#controls").hidden,
        pixel: [...context.getImageData(16, 16, 1, 1).data]
      };
    })()`);
    assert.deepEqual(result, {
      visible: true, width: 32, height: 32, sceneHidden: true, controlsHidden: true,
      pixel: [250, 204, 21, 255],
    });
  } else if (mode === "motion" || mode === "drag") {
    const manifest = JSON.parse(await readFile(new URL(`../tests/fixtures/${mode}/manifest.json`, import.meta.url)));
    async function frameHash() {
      const rgba = await evaluate(`(() => {
        const canvas = document.querySelector("#scene");
        return [...canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data];
      })()`);
      const rgb = Buffer.alloc(rgba.length / 4 * 3);
      for (let at = 0, target = 0; at < rgba.length; at += 4, target += 3) {
        assert.equal(rgba[at + 3], 255);
        rgb[target] = rgba[at]; rgb[target + 1] = rgba[at + 1]; rgb[target + 2] = rgba[at + 2];
      }
      return createHash("sha256").update(rgb).digest("hex");
    }
    assert.equal(await frameHash(), manifest.rgbSha256.initial);
    if (mode === "drag") {
      const values = await evaluate(`(() => {
        const inputs = [...document.querySelectorAll("#sliders input")];
        const initial = inputs.map((input) => input.value);
        for (const input of inputs) {
          input.value = input.max;
          input.dispatchEvent(new Event("input", {bubbles:true}));
        }
        return initial;
      })()`);
      assert.deepEqual(values, ["25", "20"]);
      assert.equal(await frameHash(), manifest.rgbSha256.range);
    } else {
      await evaluate('document.querySelector("#controls button").click()');
      const end = Date.now() + 8000;
      let hash;
      while (Date.now() < end) {
        hash = await frameHash();
        if (hash === manifest.rgbSha256.final) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.equal(hash, manifest.rgbSha256.final);
    }
    await evaluate('document.querySelector("#reset").click()');
    assert.equal(await frameHash(), manifest.rgbSha256.initial);
    console.log(`Android WebView ${mode} initial, active and reset frames match independent hashes.`);
  } else if (mode === "invalid") {
    assert.deepEqual(await evaluate(`({
      sceneHidden: document.querySelector("#scene").hidden,
      previewHidden: document.querySelector("#preview").hidden,
      controls: document.querySelectorAll("#controls button").length
    })`), { sceneHidden: true, previewHidden: true, controls: 0 });
  } else {
    const rendered = await evaluate(`(() => {
      const canvas = document.querySelector("#scene");
      const pixel = () => [...canvas.getContext("2d").getImageData(16, 16, 1, 1).data];
      const controls = [...document.querySelectorAll("#controls button")];
      const labels = controls.map((button) => button.textContent);
      const before = pixel();
      if (${mode === "scripted"}) controls[0].click();
      return { labels, before, after: pixel(), pressed: controls[0].getAttribute("aria-pressed") };
    })()`);
    const initial = [250, 204, 21, 255];
    const active = [248, 113, 113, 255];
    assert.deepEqual(rendered, {
      labels: ["Lamp", "Switch"],
      before: mode === "active" ? active : initial,
      after: mode === "initial" ? initial : active,
      pressed: mode === "initial" ? "false" : "true",
    });
    if (process.argv[4]) {
      const frame = await evaluate(`(() => {
        const canvas = document.querySelector("#scene");
        return {
          width: canvas.width, height: canvas.height,
          rgba: [...canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data]
        };
      })()`);
      assert.equal(frame.width, 32);
      assert.equal(frame.height, 32);
      const rgb = Buffer.alloc(frame.width * frame.height * 3);
      for (let source = 0, destination = 0; source < frame.rgba.length; source += 4, destination += 3) {
        assert.equal(frame.rgba[source + 3], 255);
        rgb[destination] = frame.rgba[source];
        rgb[destination + 1] = frame.rgba[source + 1];
        rgb[destination + 2] = frame.rgba[source + 2];
      }
      const ppm = Buffer.concat([Buffer.from("P6\n32 32\n255\n"), rgb]);
      assert.deepEqual(ppm, await readFile(process.argv[4]));
      console.log("Android WebView frame matches the supplied reference PPM.");
    }
  }
} finally {
  socket.close();
}
