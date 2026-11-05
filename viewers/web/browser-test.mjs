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
  assert.deepEqual(errors, []);
  console.log(`Chromium ${browser.version()} passed offline reload, input, live authoring, export, reopen and inert document labels.`);

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
