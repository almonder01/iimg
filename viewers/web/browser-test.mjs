import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const viewerSource = await readFile(process.env.IIMG_TEST_VIEWER_MODULE ?? new URL("viewer.mjs", import.meta.url));
let releaseHeldRequest;
let heldSharedRequest;

const shell = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/viewer.mjs", ["viewer.mjs", "text/javascript"]],
  ["/editor.mjs", ["editor.mjs", "text/javascript"]],
  ["/state-editor.mjs", ["state-editor.mjs", "text/javascript"]],
  ["/drag-editor.mjs", ["drag-editor.mjs", "text/javascript"]],
  ["/offline.js", ["offline.js", "text/javascript"]],
  ["/iimg_web.wasm", ["../../target/wasm32-unknown-unknown/release/iimg_web.wasm", "application/wasm"]],
]);
const server = createServer(async (request, response) => {
  const entry = shell.get(request.url);
  if (!entry) {
    response.writeHead(404).end();
    return;
  }
  try {
    const [file, type] = entry;
    const body = file === "viewer.mjs" ? viewerSource : await readFile(new URL(file, import.meta.url));
    response.writeHead(200, { "Content-Type": type }).end(body);
  } catch {
    response.writeHead(500).end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

let browser;
try {
  const executablePath = process.env.IIMG_CHROMIUM;
  const browserOptions = executablePath ? { executablePath }
    : process.env.IIMG_PLAYWRIGHT_CHROMIUM === "1" ? {} : { channel: "chrome" };
  browser = await chromium.launch(browserOptions);
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector("#file").disabled);
  const fixture = fileURLToPath(new URL("../../tests/fixtures/v0.2/two-controls.iimg", import.meta.url));
  await page.locator("#file").setInputFiles(fixture);

  const lamp = page.getByRole("button", { name: "Lamp", exact: true });
  const toggle = page.getByRole("button", { name: "Switch", exact: true });
  await lamp.waitFor({ state: "visible" });
  assert.equal(await lamp.getAttribute("aria-pressed"), "false");
  const canvas = page.locator("#scene");
  const pixel = (x, y) => canvas.evaluate((element, [px, py]) =>
    [...element.getContext("2d").getImageData(px, py, 1, 1).data], [x, y]);
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);
  const point = (x, y) => ({
    x: bounds.x + (x + 0.5) * bounds.width / 32,
    y: bounds.y + (y + 0.5) * bounds.height / 32,
  });

  const center = point(16, 16);
  await page.mouse.click(center.x, center.y);
  assert.equal(await lamp.getAttribute("aria-pressed"), "true");
  assert.deepEqual(await pixel(16, 16), [248, 113, 113, 255]);
  const corner = point(2, 2);
  await page.touchscreen.tap(corner.x, corner.y);
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  assert.deepEqual(await pixel(2, 2), [88, 210, 130, 255]);

  await lamp.focus();
  await page.keyboard.press("Enter");
  assert.equal(await lamp.getAttribute("aria-pressed"), "false");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Switch");
  await page.keyboard.press("Space");
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  assert.deepEqual(await pixel(2, 2), [64, 96, 128, 255]);
  await page.getByText("Author an IIMG image", { exact: true }).click();
  const source = page.getByLabel("IIMG source JSON");
  const validSource = await readFile(new URL("../../examples/raster-lamp.source.json", import.meta.url), "utf8");
  const downloadLink = page.getByRole("link", { name: "Download IIMG" });
  await downloadLink.waitFor({ state: "visible", timeout: 5000 });
  await source.fill("{");
  assert.equal(await downloadLink.count(), 0);
  assert.equal(await page.locator("#download").getAttribute("href"), null);
  await page.waitForFunction(() => document.querySelector("#author-status").textContent.includes("InvalidJson"));
  await source.fill(validSource);
  await downloadLink.waitFor({ state: "visible" });
  assert.deepEqual(await pixel(6, 15), [26, 32, 44, 255]);
  const draftUrl = await downloadLink.getAttribute("href");
  await page.getByLabel("Export as Core 1.0 candidate").check();
  assert.equal(await downloadLink.count(), 0);
  await downloadLink.waitFor({ state: "visible" });
  assert.notEqual(await downloadLink.getAttribute("href"), draftUrl);
  await page.getByRole("button", { name: "Validate and preview" }).click();
  assert.deepEqual(await pixel(6, 15), [80, 175, 240, 255]);
  const [download] = await Promise.all([page.waitForEvent("download"), downloadLink.click()]);
  assert.equal(download.suggestedFilename(), "authored.iimg");
  const downloaded = await download.path();
  assert.deepEqual([...(await readFile(downloaded)).subarray(8, 12)], [1, 0, 0, 0]);
  await page.locator("#file").setInputFiles(downloaded);
  await lamp.waitFor({ state: "visible" });
  assert.deepEqual(await pixel(16, 16), [250, 204, 21, 255]);
  assert.deepEqual(await pixel(6, 15), [80, 175, 240, 255]);
  await lamp.click();
  assert.deepEqual(await pixel(16, 16), [248, 113, 113, 255]);

  // Author a new document using only the visual workspace, then exercise its
  // actual exported file. Editing must not alter the already-open viewer.
  const editor = page.getByRole("region", { name: "Visual editor", exact: true });
  const design = page.locator("#editor-canvas");
  await design.waitFor({ state: "visible" });
  const designPixel = (x, y) => design.evaluate((element, [px, py]) =>
    [...element.getContext("2d").getImageData(px, py, 1, 1).data], [x, y]);
  assert.deepEqual(await designPixel(16, 16), [250, 204, 21, 255]);
  await editor.getByRole("button", { name: "New canvas", exact: true }).click();
  assert.equal(await page.locator("#editor-objects option").count(), 0);
  await editor.getByRole("button", { name: "Add rectangle", exact: true }).click();
  await editor.getByLabel("Left", { exact: true }).fill("64");
  await editor.getByLabel("Top", { exact: true }).fill("48");
  await editor.getByLabel("Shape width", { exact: true }).fill("120");
  await editor.getByLabel("Shape height", { exact: true }).fill("80");
  await editor.getByLabel("Shape color", { exact: true }).fill("#2288cc");
  await editor.getByLabel("Toggle color on activation", { exact: true }).check();
  await editor.getByLabel("Control name", { exact: true }).fill("مصباح الاختبار");
  await editor.getByLabel("Active color", { exact: true }).fill("#ffcc00");
  await editor.getByRole("button", { name: "Apply object", exact: true }).click();
  await editor.getByRole("button", { name: "Add circle", exact: true }).click();
  await page.locator("#editor-objects").selectOption("shape1");
  await editor.getByRole("button", { name: "Move forward", exact: true }).click();
  await design.scrollIntoViewIfNeeded();
  const designBounds = await design.boundingBox();
  const designPoint = (x, y) => ({ x: designBounds.x + (x + .5) * designBounds.width / 512,
    y: designBounds.y + (y + .5) * designBounds.height / 320 });
  const from = designPoint(100, 90), to = designPoint(140, 110);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
  assert.equal(await editor.getByLabel("Left", { exact: true }).inputValue(), "104");
  assert.equal(await editor.getByLabel("Top", { exact: true }).inputValue(), "68");
  assert.deepEqual(await designPixel(110, 75), [34, 136, 204, 255]);
  assert.deepEqual(await pixel(16, 16), [248, 113, 113, 255]);
  const touchCircle = designPoint(40, 40), touchRect = designPoint(130, 90);
  await page.touchscreen.tap(touchCircle.x, touchCircle.y);
  assert.equal(await page.locator("#editor-object-name").textContent(), "shape2 (circle)");
  await page.touchscreen.tap(touchRect.x, touchRect.y);
  assert.equal(await page.locator("#editor-object-name").textContent(), "shape1 (rect)");

  // A cancelled gesture changes neither the source nor history.
  const beforeCancel = await source.inputValue();
  const cancelFrom = designPoint(130, 90), cancelTo = designPoint(200, 120);
  await page.mouse.move(cancelFrom.x, cancelFrom.y); await page.mouse.down();
  await page.mouse.move(cancelTo.x, cancelTo.y);
  await design.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  assert.equal(await source.inputValue(), beforeCancel);
  await page.locator("#editor-stage").focus();
  await page.keyboard.press("Shift+ArrowRight");
  assert.equal(await editor.getByLabel("Left", { exact: true }).inputValue(), "114");
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await editor.getByLabel("Left", { exact: true }).inputValue(), "104");
  await editor.getByRole("button", { name: "Redo", exact: true }).click();
  assert.equal(await editor.getByLabel("Left", { exact: true }).inputValue(), "114");
  await editor.getByRole("button", { name: "Delete selected", exact: true }).click();
  assert.equal(JSON.parse(await source.inputValue()).interaction, undefined);
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(JSON.parse(await source.inputValue()).interaction.controls[0].label, "مصباح الاختبار");
  if (process.env.IIMG_EDITOR_SCREENSHOTS) {
    await editor.screenshot({ path: `${process.env.IIMG_EDITOR_SCREENSHOTS}/editor-desktop.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  if (process.env.IIMG_EDITOR_SCREENSHOTS) {
    await editor.screenshot({ path: `${process.env.IIMG_EDITOR_SCREENSHOTS}/editor-phone.png` });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await downloadLink.waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Validate and preview", exact: true }).click();
  assert.deepEqual(await pixel(120, 75), [34, 136, 204, 255]);
  await page.getByRole("button", { name: "مصباح الاختبار", exact: true }).click();
  assert.deepEqual(await pixel(120, 75), [255, 204, 0, 255]);
  assert.deepEqual(await designPixel(120, 75), [34, 136, 204, 255]);
  const [visualDownload] = await Promise.all([page.waitForEvent("download"), downloadLink.click()]);
  await page.locator("#file").setInputFiles(await visualDownload.path());
  await page.getByRole("button", { name: "مصباح الاختبار", exact: true }).waitFor({ state: "visible" });
  assert.deepEqual(await pixel(120, 75), [34, 136, 204, 255]);

  // Import/save preserves embedded assets, and a rejected resize must leave
  // the accepted document and export intact.
  await page.locator("#editor-import").setInputFiles({ name: "mixed.json", mimeType: "application/json", buffer: Buffer.from(validSource) });
  await page.waitForFunction(() => document.querySelector("#editor-width").value === "32");
  const [project] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Save source JSON", exact: true }).click()]);
  assert.equal(project.suggestedFilename(), "project.iimg.json");
  assert.deepEqual(JSON.parse(await readFile(await project.path(), "utf8")), JSON.parse(validSource));
  await page.locator("#editor-objects").selectOption("plate");
  await editor.getByLabel("Left", { exact: true }).fill("2");
  await editor.getByLabel("Top", { exact: true }).fill("2");
  await editor.getByRole("button", { name: "Apply object", exact: true }).click();
  assert.deepEqual(await designPixel(2, 2), [80, 175, 240, 255]);
  assert.deepEqual(JSON.parse(await source.inputValue()).assets, JSON.parse(validSource).assets);
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await editor.getByLabel("Canvas width", { exact: true }).fill("16");
  await editor.getByRole("button", { name: "Apply canvas", exact: true }).click();
  assert.match(await page.locator("#editor-status").textContent(), /Not applied:/);
  assert.deepEqual(JSON.parse(await source.inputValue()), JSON.parse(validSource));
  await page.locator("#editor-import").setInputFiles({ name: "oversized.json", mimeType: "application/json", buffer: Buffer.alloc(12 * 1024 * 1024 + 1, 32) });
  await page.waitForFunction(() => document.querySelector("#editor-status").textContent.includes("Import rejected"));
  assert.deepEqual(JSON.parse(await source.inputValue()), JSON.parse(validSource));

  // A slow file read must not overwrite a design edited after import started.
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== "slow.json") return original.call(this);
      return new Promise((resolve) => { window.releaseEditorImport = resolve; }).then(() => {
        File.prototype.text = original;
        return original.call(this);
      });
    };
  });
  await page.locator("#editor-import").setInputFiles({ name: "slow.json", mimeType: "application/json", buffer: Buffer.from(validSource) });
  await page.waitForFunction(() => typeof window.releaseEditorImport === "function");
  await editor.getByRole("button", { name: "Add rectangle", exact: true }).click();
  const newerDesign = await source.inputValue();
  await page.evaluate(() => window.releaseEditorImport());
  await page.waitForFunction(() => document.querySelector("#editor-status").textContent.includes("Import cancelled"));
  assert.equal(await source.inputValue(), newerDesign);

  const crowded = { width: 32, height: 32, scene: { background: [0, 0, 0], objects: Array.from({ length: 256 }, (_, index) =>
    ({ type: "rect", id: `object${index}`, x: 0, y: 0, width: 1, height: 1, fill: [1, 2, 3] })) } };
  await source.fill(JSON.stringify(crowded));
  await page.waitForFunction(() => document.querySelectorAll("#editor-objects option").length === 256);
  assert.equal(await editor.getByRole("button", { name: "Add rectangle", exact: true }).isDisabled(), true);
  await source.fill("{");
  assert.equal(await design.isVisible(), false);
  assert.equal(await editor.getByLabel("Left", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("link", { name: "Save source JSON", exact: true }).count(), 0);
  console.log("Visual editor passed isolated exact rendering, layer selection, drag/cancel, keyboard, history, controls, export/reopen, asset source round-trip and invalid/bounded input checks.");

  // Labels are untrusted document text: markup must remain literal, and must
  // never create an element or execute a handler inside the viewer origin.
  const hostileLabel = '<svg onload="globalThis.iimgLabelExecuted=1"></svg>';
  const hostileSource = JSON.parse(validSource);
  hostileSource.interaction.controls[0].label = hostileLabel;
  await source.fill(JSON.stringify(hostileSource));
  await downloadLink.waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Validate and preview" }).click();
  const literalControl = page.getByRole("button", { name: hostileLabel, exact: true });
  await literalControl.waitFor({ state: "visible" });
  await page.setViewportSize({ width: 360, height: 800 });
  const literalBounds = await literalControl.boundingBox();
  assert.ok(literalBounds.height >= 48 && literalBounds.width <= 328);
  assert.equal(await page.locator("#controls svg, #controls img, #controls script").count(), 0);
  assert.equal(await page.evaluate(() => globalThis.iimgLabelExecuted), undefined);
  await literalControl.click();
  assert.deepEqual(await pixel(16, 16), [248, 113, 113, 255]);
  // A DRAG-only file has no buttons, but retains named keyboard range controls.
  await page.locator("#file").setInputFiles(fileURLToPath(new URL("../../tests/fixtures/drag/drag.iimg", import.meta.url)));
  const horizontal = page.getByRole("slider", { name: "المستوى الأفقي", exact: true });
  await horizontal.waitFor({ state: "visible" });
  assert.equal(await horizontal.inputValue(), "25");
  assert.equal(await page.locator("#reset").isVisible(), true);
  assert.equal(await page.locator("#controls button").count(), 0);
  let dragBox = await canvas.boundingBox();
  const dragPoint = (x,y) => ({ x: dragBox.x + (x+.5)*dragBox.width/128, y: dragBox.y + (y+.5)*dragBox.height/96 });
  const beginDrag = async () => { await canvas.scrollIntoViewIfNeeded();dragBox=await canvas.boundingBox();const p=dragPoint(40,32);await page.mouse.move(p.x,p.y);await page.mouse.down(); };
  let middle = dragPoint(88,32);
  await beginDrag();await page.mouse.move(middle.x,middle.y);assert.equal(await horizontal.inputValue(),"75");
  await page.mouse.up();assert.equal(await horizontal.inputValue(),"75");
  await page.locator("#reset").click();await beginDrag();middle=dragPoint(88,32);await page.mouse.move(middle.x,middle.y);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.equal(await horizontal.inputValue(),"25");await page.mouse.up();
  await beginDrag();await page.mouse.move(dragBox.x+dragBox.width+20,dragPoint(88,32).y);await page.mouse.up();
  assert.equal(await horizontal.inputValue(),"100");
  await horizontal.focus();await page.keyboard.press("Home");assert.equal(await horizontal.inputValue(),"0");
  await page.keyboard.press("ArrowRight");assert.equal(await horizontal.inputValue(),"5");
  await page.keyboard.press("End");assert.equal(await horizontal.inputValue(),"100");
  const dragSource = await readFile(new URL("../../examples/drag.source.json",import.meta.url),"utf8");
  await source.fill(dragSource);await page.waitForFunction(() => document.querySelector("#editor-status").textContent.includes("Design ready"));
  await page.locator("#editor-objects").selectOption("handleX");
  const outlineDragLeft = await page.locator("#editor-selection").evaluate((element)=>parseFloat(element.style.left));
  assert.equal(outlineDragLeft,25);
  await page.getByText("Constrained sliders",{exact:true}).click();
  await page.locator("#editor-drag-initial").fill("50");
  await editor.getByRole("button",{name:"Apply slider",exact:true}).click();
  assert.equal(JSON.parse(await source.inputValue()).drag.sliders[0].initial,50);
  await page.locator("#editor-stage").focus();await page.keyboard.press("ArrowDown");
  const movedSlider = JSON.parse(await source.inputValue()).drag.sliders[0];
  assert.equal(movedSlider.from.y,25);assert.equal(movedSlider.to.y,25);
  await page.locator("#editor-drag-label").fill("<img src=x onerror=alert(1)>");
  await editor.getByRole("button",{name:"Apply slider",exact:true}).click();
  await page.getByRole("button",{name:"Validate and preview",exact:true}).click();
  await page.getByRole("slider",{name:"<img src=x onerror=alert(1)>",exact:true}).waitFor();
  assert.equal(await page.locator("#sliders img").count(),0);
  await page.locator("#editor-objects").selectOption("handleX");
  await editor.getByRole("button",{name:"Remove slider",exact:true}).click();
  assert.equal(JSON.parse(await source.inputValue()).drag.sliders.length,1);
  console.log("DRAG host/editor passed capture, commit, outside clamping, blur cancellation, real keyboard ranges, initial placement, path translation, literal labels and export.");
  assert.deepEqual(errors, []);
  console.log(`Chromium ${browser.version()} passed offline reload, input, live authoring, export, reopen and inert document labels.`);

  // Templates, bounded native PNG imports, resize and recovery all run offline.
  await page.locator("#editor-template").selectOption("card");
  await editor.getByRole("button", { name: "Use template", exact: true }).click();
  await page.locator("#editor-objects").selectOption("lamp");
  await page.locator("#editor-resize").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await editor.getByLabel("Radius", { exact: true }).inputValue(), "73");
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await editor.getByLabel("Radius", { exact: true }).inputValue(), "72");
  await page.locator("#editor-objects").selectOption("panel");
  const handle = page.locator("#editor-resize");
  await handle.scrollIntoViewIfNeeded();
  const handleBounds = await handle.boundingBox(), resizeBounds = await design.boundingBox();
  await page.mouse.move(handleBounds.x + 24, handleBounds.y + 24); await page.mouse.down();
  await page.mouse.move(handleBounds.x + 24 + 24 * resizeBounds.width / 512,
    handleBounds.y + 24 + 16 * resizeBounds.height / 320);
  await page.mouse.up();
  assert.equal(await editor.getByLabel("Shape width", { exact: true }).inputValue(), "488");
  assert.equal(await editor.getByLabel("Shape height", { exact: true }).inputValue(), "288");
  const tilePng = Buffer.from(JSON.parse(validSource).assets[0].png_base64, "base64");
  await page.locator("#editor-png").setInputFiles({ name: "tile.png", mimeType: "image/png", buffer: tilePng });
  await page.waitForFunction(() => document.querySelector("#editor-object-name").textContent === "png1 (image)");
  assert.deepEqual(await designPixel(0, 0), [80, 175, 240, 255]);
  assert.equal(await handle.isVisible(), false);
  const pngSource = await source.inputValue();
  assert.equal(JSON.parse(pngSource).assets[0].png_base64, tilePng.toString("base64"));
  const rgba = Buffer.from(tilePng); rgba[25] = 6;
  await page.locator("#editor-png").setInputFiles({ name: "alpha.png", mimeType: "image/png", buffer: rgba });
  await page.waitForFunction(() => document.querySelector("#editor-status").textContent.includes("without transparency"));
  assert.equal(await source.inputValue(), pngSource);
  const brokenPng = Buffer.from(tilePng); brokenPng[brokenPng.length - 1] ^= 1;
  await page.locator("#editor-png").setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: brokenPng });
  await page.waitForFunction(() => document.querySelector("#editor-status").textContent.includes("Not applied"));
  assert.equal(await source.inputValue(), pngSource);
  await page.locator("#editor-png").setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(1024 * 1024 + 1) });
  await page.waitForFunction(() => document.querySelector("#editor-status").textContent.includes("maximum encoded size"));
  assert.equal(await source.inputValue(), pngSource);
  const storageKey = "iimg.editor.recovery.v1";
  const autosave = editor.getByLabel("Keep a local recovery copy in this browser", { exact: true });
  assert.equal(await autosave.isChecked(), false);
  await autosave.check();
  await page.waitForFunction((key) => !!localStorage.getItem(key), storageKey);
  assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).source, storageKey), pngSource);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector("#file").disabled);
  await page.getByText("Author an IIMG image", { exact: true }).click();
  await editor.getByRole("button", { name: "Restore recovery copy", exact: true }).waitFor({ state: "visible" });
  assert.notEqual(await source.inputValue(), pngSource);
  assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).source, storageKey), pngSource);
  await editor.getByRole("button", { name: "Restore recovery copy", exact: true }).click();
  assert.equal(await source.inputValue(), pngSource);
  assert.deepEqual(await designPixel(0, 0), [80, 175, 240, 255]);
  await source.fill(pngSource + " ".repeat(1024 * 1024));
  await page.waitForFunction(() => document.querySelector("#editor-recovery-status").textContent.includes("exceeds the 2 MiB"));
  assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).source, storageKey), pngSource);
  await source.fill(pngSource);
  await page.waitForFunction(() => document.querySelector("#editor-status").textContent.includes("Design ready"));
  await autosave.uncheck();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), null);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.restoreStorageWriter = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) {
      if (key === "iimg.editor.recovery.v1") throw new DOMException("Test quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await autosave.check();
  await page.waitForFunction(() => document.querySelector("#editor-recovery-status").textContent.includes("Could not save"));
  assert.equal(await source.inputValue(), pngSource);
  await autosave.uncheck();
  await page.evaluate((key) => { window.restoreStorageWriter(); localStorage.setItem(key, "{corrupt"); }, storageKey);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector("#file").disabled);
  await page.getByText("Author an IIMG image", { exact: true }).click();
  await editor.getByRole("button", { name: "Discard recovery copy", exact: true }).waitFor({ state: "visible" });
  await autosave.check();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), "{corrupt");
  await autosave.uncheck();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), null);
  assert.deepEqual(errors, []);
  console.log("Authoring usability passed templates, pointer/keyboard resize, bounded PNG import/rejection, recovery restore/opt-out/corruption and quota-failure checks offline.");

  const stateSource = await readFile(new URL("../../examples/state-panel.source.json", import.meta.url), "utf8");
  await source.fill(stateSource);
  await page.waitForFunction(() => !document.querySelector("#editor-state-fields").hidden);
  assert.equal(await page.getByLabel("Export as Core 1.0 candidate", { exact: true }).isChecked(), true);
  await downloadLink.waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Validate and preview", exact: true }).click();
  const coverControl = page.getByRole("button", { name: "إخفاء الغطاء", exact: true });
  assert.equal(await coverControl.count(), 0);
  await page.getByRole("button", { name: "تغيير اللون", exact: true }).click();
  assert.deepEqual(await pixel(32, 28), [40, 80, 220, 255]);
  await page.getByRole("button", { name: "تبديل الغطاء واللون", exact: true }).click();
  assert.deepEqual(await pixel(32, 28), [0, 220, 220, 255]);
  assert.deepEqual(await pixel(2, 2), [128, 0, 0, 255]);
  await coverControl.click();
  assert.equal(await coverControl.count(), 0);
  assert.deepEqual(await pixel(2, 2), [0, 0, 180, 255]);
  const selfControl = page.getByRole("button", { name: "إخفاء هذا الزر", exact: true });
  await selfControl.focus(); await page.keyboard.press("Enter");
  assert.equal(await selfControl.count(), 0);
  await page.getByRole("button", { name: "Reset image", exact: true }).click();
  await selfControl.waitFor({ state: "visible" });
  assert.deepEqual(await pixel(2, 2), [0, 128, 0, 255]);
  await page.locator("#editor-objects").selectOption("switch");
  await editor.getByLabel("Left", { exact: true }).fill("21");
  await editor.getByRole("button", { name: "Apply object", exact: true }).click();
  assert.deepEqual(JSON.parse(await source.inputValue()).interaction, JSON.parse(stateSource).interaction);
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByText("Multi-state interactions", { exact: true }).click();
  await editor.getByLabel("Existing states", { exact: true }).selectOption("tone");
  await editor.getByLabel("Maximum value", { exact: true }).fill("3");
  await editor.getByRole("button", { name: "Add or update state", exact: true }).click();
  assert.equal(JSON.parse(await source.inputValue()).interaction.bindings.find((entry) => entry.target === "lamp").values.length, 4);
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await editor.getByLabel("State ID", { exact: true }).fill("extra");
  await editor.getByLabel("Initial value", { exact: true }).fill("0");
  await editor.getByLabel("Maximum value", { exact: true }).fill("1");
  await editor.getByRole("button", { name: "Add or update state", exact: true }).click();
  await page.locator("#editor-objects").selectOption("switch");
  await editor.getByLabel("Action state", { exact: true }).selectOption("extra");
  await editor.getByRole("button", { name: "Add or update action", exact: true }).click();
  assert.equal(JSON.parse(await source.inputValue()).interaction.controls.find((entry) => entry.target === "switch").actions.length, 3);
  await page.locator("#editor-objects").selectOption("lamp");
  await editor.getByLabel("Binding state", { exact: true }).selectOption("extra");
  await editor.getByLabel("Value 0 visible", { exact: true }).uncheck();
  await editor.getByRole("button", { name: "Apply state binding", exact: true }).click();
  const advanced = JSON.parse(await source.inputValue());
  assert.equal(advanced.interaction.bindings.find((entry) => entry.target === "lamp").values[0].visible, false);
  await downloadLink.waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Validate and preview", exact: true }).click();
  assert.deepEqual(await pixel(32, 28), [12, 20, 32, 255]);
  await page.getByRole("button", { name: "تبديل الغطاء واللون", exact: true }).click();
  assert.deepEqual(await pixel(32, 28), [250, 200, 0, 255]);
  await page.getByLabel("Export as Core 1.0 candidate", { exact: true }).uncheck();
  await page.waitForFunction(() => document.querySelector("#author-status").textContent.includes("UnsupportedProfile"));
  assert.equal(await downloadLink.count(), 0);
  assert.deepEqual(errors, []);
  console.log("State-actions viewer/editor passed grouped actions, semantic visibility, focus clearing, reset, safe geometry editing, state/action/style authoring and explicit legacy-export rejection.");

  // Drive the host RAF with exact timestamps; assert frames, not wall-clock
  // sleeps, and verify pause/background/reduced-motion/unload cancellation.
  await page.evaluate(() => {
    let id = 0, background = false;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (value) => callbacks.delete(value);
    window.motionFrame = (time) => { const pending = [...callbacks.values()]; callbacks.clear(); for (const callback of pending) callback(time); };
    window.motionQueueSize = () => callbacks.size;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => background });
    window.motionBackground = (hidden) => { background = hidden; document.dispatchEvent(new Event("visibilitychange")); };
  });
  const motionSource = await readFile(new URL("../../examples/motion.source.json", import.meta.url), "utf8");
  await source.fill(motionSource);
  await downloadLink.waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Validate and preview", exact: true }).click();
  const play = page.getByRole("button", { name: "تشغيل الحركة", exact: true });
  await play.click();
  await page.evaluate(() => { window.motionFrame(0); window.motionFrame(500); });
  assert.deepEqual(await pixel(48, 40), [250, 200, 0, 255]);
  await page.getByRole("button", { name: "Pause motion", exact: true }).click();
  await page.evaluate(() => window.motionFrame(1000));
  assert.deepEqual(await pixel(48, 40), [250, 200, 0, 255]);
  assert.equal(await page.evaluate(() => window.motionQueueSize()), 0);
  await page.getByRole("button", { name: "Resume motion", exact: true }).click();
  await page.evaluate(() => { window.motionFrame(1500); window.motionFrame(2000); });
  assert.deepEqual(await pixel(16, 40), [250, 200, 0, 255]);
  await page.evaluate(() => { window.motionBackground(true); window.motionFrame(3000); });
  assert.equal(await page.evaluate(() => window.motionQueueSize()), 0);
  await page.evaluate(() => { window.motionBackground(false); window.motionFrame(4000); window.motionFrame(4500); });
  assert.deepEqual(await pixel(48, 40), [250, 200, 0, 255]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => window.motionQueueSize() === 0);
  assert.deepEqual(await pixel(80, 40), [250, 200, 0, 255]);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Reset image", exact: true }).click();
  assert.equal(await page.evaluate(() => window.motionQueueSize()), 0);
  await play.click(); await page.evaluate(() => { window.motionFrame(0); window.motionFrame(2000); });
  assert.deepEqual(await pixel(80, 40), [250, 200, 0, 255]);
  assert.equal(await page.evaluate(() => window.motionQueueSize()), 0);
  await page.locator("#editor-objects").selectOption("orb");
  await page.getByText("Finite motion", { exact: true }).click();
  await editor.getByLabel("Duration ms", { exact: true }).fill("500");
  await editor.getByRole("button", { name: "Apply motion track", exact: true }).click();
  assert.equal(JSON.parse(await source.inputValue()).motion.tracks.find((track) => track.target === "orb").duration_ms, 500);
  await editor.getByRole("button", { name: "Remove motion track", exact: true }).click();
  assert.equal(JSON.parse(await source.inputValue()).motion.tracks.length, 1);
  const initiallyMoving = JSON.parse(motionSource);
  initiallyMoving.interaction.states[0].initial = 1;
  initiallyMoving.motion.tracks[0].from.x = 32;
  await source.fill(JSON.stringify(initiallyMoving));
  await page.waitForFunction(() => document.querySelector("#editor-status").textContent.includes("Design ready"));
  await design.scrollIntoViewIfNeeded();
  const activeDesign = await design.boundingBox();
  await page.mouse.click(activeDesign.x + 40.5 * activeDesign.width / 96, activeDesign.y + 40.5 * activeDesign.height / 64);
  assert.equal(await page.locator("#editor-object-name").textContent(), "orb (circle)");
  await editor.getByLabel("Shape color", { exact: true }).fill("#00ff00");
  await editor.getByRole("button", { name: "Apply object", exact: true }).click();
  assert.equal(JSON.parse(await source.inputValue()).motion.tracks[0].from.x, 32);
  assert.deepEqual(await designPixel(40,40), [0,255,0,255]);
  await page.locator("#editor-stage").focus(); await page.keyboard.press("ArrowRight");
  assert.equal(JSON.parse(await source.inputValue()).motion.tracks[0].from.x, 33);
  assert.equal(JSON.parse(await source.inputValue()).motion.tracks[0].to.x, 72);
  await page.locator("#file").setInputFiles(fixture);
  await lamp.waitFor({ state: "visible" });
  await page.evaluate(() => window.motionFrame(4000));
  assert.equal(await page.evaluate(() => window.motionQueueSize()), 0);
  assert.equal(await page.locator("#pause-motion").isVisible(), false);
  assert.deepEqual(await pixel(16,16), [250,204,21,255]);
  assert.deepEqual(errors, []);
  console.log("Motion host/editor passed exact RAF frames, pause/resume, background suspension, reduced motion, completion, track editing and stale-frame unload cancellation.");

  const android = await browser.newContext();
  const androidPage = await android.newPage();
  await androidPage.setViewportSize({ width: 360, height: 800 });
  const origin = "https://viewer.iimg.invalid";
  let releaseShared;
  let notifyHeld;
  const sharedHeld = new Promise((resolve) => { notifyHeld = resolve; });
  const sharedRelease = new Promise((resolve) => { releaseShared = releaseHeldRequest = resolve; });
  await androidPage.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/incoming/2") {
      notifyHeld();
      await sharedRelease;
      await route.fulfill({ path: fixture, contentType: "application/octet-stream" });
      return;
    }
    if (path === "/incoming/1" || path === "/incoming/4") {
      await route.fulfill({ path: fixture, contentType: "application/octet-stream" });
      return;
    }
    const [asset, type] = shell.get(path) ?? [];
    if (asset) {
      await route.fulfill({ body: asset === "viewer.mjs" ? viewerSource : await readFile(new URL(asset, import.meta.url)), contentType: type });
    } else {
      await route.fulfill({ status: 404 });
    }
  });
  await androidPage.goto(`${origin}/index.html`);
  await androidPage.waitForFunction(() => typeof window.iimgOpenShared === "function");
  await androidPage.evaluate(() => window.iimgOpenShared(1));
  const sharedLamp = androidPage.getByRole("button", { name: "Lamp", exact: true });
  await sharedLamp.click();
  assert.equal(await sharedLamp.getAttribute("aria-pressed"), "true");
  assert.equal(await androidPage.locator("#file").isVisible(), false);
  assert.ok((await sharedLamp.boundingBox()).height >= 48);
  const held = heldSharedRequest = androidPage.evaluate(() => window.iimgOpenShared(2));
  await sharedHeld;
  await androidPage.evaluate(() => window.iimgClearShared?.(3, true));
  assert.equal(await androidPage.locator("#scene").isVisible(), false);
  assert.equal(await androidPage.locator("#controls button").count(), 0);
  const loadingBusy = await androidPage.locator("main").getAttribute("aria-busy");
  releaseShared();
  await held;
  assert.equal(await androidPage.locator("#scene").isVisible(), false);
  assert.equal(loadingBusy, "true");
  await androidPage.evaluate(() => window.iimgClearShared(3, false));
  await androidPage.evaluate(() => window.iimgOpenShared(1));
  assert.equal(await androidPage.locator("#controls button").count(), 0);
  assert.equal(await androidPage.locator("main").getAttribute("aria-busy"), "false");
  await androidPage.evaluate(() => window.iimgOpenShared(4));
  await sharedLamp.waitFor({ state: "visible" });
  await sharedLamp.focus();
  await androidPage.keyboard.press("Space");
  assert.equal(await sharedLamp.getAttribute("aria-pressed"), "true");
  assert.equal(await androidPage.locator("#scene").getAttribute("role"), "img");
  console.log("Android shell passed shared loading, cancellation, stale-response rejection, recovery and accessible keyboard controls.");
} finally {
  releaseHeldRequest?.();
  await heldSharedRequest?.catch(() => {});
  await browser?.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
