import assert from "node:assert/strict";

const port = Number(process.argv[2]);
const mode = process.argv[3] ?? "scripted";
assert.ok(["scripted", "initial", "active"].includes(mode), "Invalid WebView check mode");
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
  let status;
  while (Date.now() < deadline) {
    status = await evaluate('document.querySelector("#status")?.textContent');
    if (status?.startsWith("Image ready")) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.match(status ?? "", /^Image ready/, `Android viewer status: ${status}`);
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
} finally {
  socket.close();
}
