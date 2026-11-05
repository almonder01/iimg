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
