// A source editor for the existing Core vocabulary. Its WASM instance is private:
// changing the design must not change the image open in the viewer.
export function mountEditor(root, source, wasm) {
  const get = (name) => root.querySelector(`#editor-${name}`);
  const canvas = get("canvas");
  const context = canvas.getContext("2d");
  const stage = get("stage");
  const outline = get("selection");
  const list = get("objects");
  const status = get("status");
  const save = get("save");
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const limit = wasm.author_source_limit();
  const history = [];
  let cursor = -1;
  let model;
  let selected;
  let drag;
  let timer;
  let revision = 0;
  let ownChange = false;
  let saveUrl;
  const recoveryKey = "iimg.editor.recovery.v1";
  const recoveryLimit = 2 * 1024 * 1024;
  let recoveryCopy;
  let recoveryPending = false;
  let recoveryTimer;
  let recoveryText;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const hex = (color) => `#${color.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const object = () => model?.scene.objects.find((shape) => shape.id === selected);
  const controls = (value) => value.interaction?.controls ?? [];

  function recoveryMessage(text) { get("recovery-status").textContent = text; }
  function readRecovery() {
    try {
      const stored = localStorage.getItem(recoveryKey);
      if (!stored) return;
      recoveryPending = true;
      if (stored.length * 2 > recoveryLimit) throw new Error("Recovery copy exceeds its limit.");
      const record = JSON.parse(stored);
      if (record.version !== 1 || typeof record.source !== "string"
          || record.source.length * 2 > recoveryLimit || typeof record.savedAt !== "string") throw new Error("Unknown recovery copy.");
      recoveryCopy = record.source;
      get("restore").hidden = get("discard").hidden = false;
      recoveryMessage("A local recovery copy is available. Restore or discard it before saving a replacement.");
    } catch { recoveryMessage("Recovery storage is unavailable or contains an invalid copy. Save source JSON; use Discard to clear the copy."); get("discard").hidden = false; }
  }
  function scheduleRecovery(text) {
    recoveryText = text;
    clearTimeout(recoveryTimer);
    if (!get("autosave").checked || recoveryPending) return;
    if (text.length * 2 > recoveryLimit) {
      recoveryMessage("This project exceeds the 2 MiB recovery text budget. Save source JSON; the previous copy is retained.");
      return;
    }
    recoveryTimer = setTimeout(() => {
      try {
        const stored = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), source: text });
        if (stored.length * 2 > recoveryLimit) {
          recoveryMessage("This project exceeds the 2 MiB recovery text budget. Save source JSON; the previous copy is retained.");
          return;
        }
        localStorage.setItem(recoveryKey, stored);
        recoveryMessage("Local recovery copy saved. Keep source JSON as your portable project backup.");
      } catch { recoveryMessage("Could not save recovery copy (storage disabled or full). Save source JSON."); }
    }, 350);
  }

  function compile(text) {
    if (text.length > limit) throw new Error("Source exceeds 12 MiB.");
    const bytes = encoder.encode(text);
    if (bytes.length > limit) throw new Error("Source exceeds 12 MiB.");
    wasm.unload();
    const write = (data) => {
      const pointer = wasm.prepare_input(data.length);
      if (!pointer) throw new Error("Source is empty or too large.");
      new Uint8Array(wasm.memory.buffer, pointer, data.length).set(data);
    };
    const output = () => new Uint8Array(wasm.memory.buffer, wasm.output_ptr(), wasm.output_len());
    try {
      write(bytes);
      if (wasm.compile_source_v1() !== 0) throw new Error(decoder.decode(output()));
      const compiled = output().slice();
      write(compiled);
      if (wasm.load() !== 0 || wasm.render() !== 0) throw new Error("Cannot render this Core source.");
      // Parse only after the compiler has checked lexical and semantic rules.
      const value = JSON.parse(text);
      const frame = context.createImageData(value.width, value.height);
      const pixels = output();
      for (let src = 0, dest = 0; src < pixels.length; src += 3, dest += 4) {
        frame.data[dest] = pixels[src]; frame.data[dest + 1] = pixels[src + 1];
        frame.data[dest + 2] = pixels[src + 2]; frame.data[dest + 3] = 255;
      }
      return { value, frame };
    } finally { wasm.unload(); }
  }

  function bounds(shape) {
    if (shape.type === "circle") return { x: shape.cx - shape.radius, y: shape.cy - shape.radius,
      width: shape.radius * 2, height: shape.radius * 2 };
    if (shape.type === "image") {
      const asset = model.assets.find((entry) => entry.id === shape.asset);
      // IHDR dimensions from an already Core-validated PNG; do not decode a
      // second bitmap or accept arbitrary browser image types/URLs here.
      const prefix = Uint8Array.from(atob(asset.png_base64.slice(0, 44)), (char) => char.charCodeAt(0));
      const view = new DataView(prefix.buffer);
      return { x: shape.x, y: shape.y, width: view.getUint32(16), height: view.getUint32(20) };
    }
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  }

  function selectionBox(box = object() && bounds(object())) {
    outline.hidden = !box || canvas.hidden;
    get("resize").hidden = !box || canvas.hidden || object()?.type === "image";
    if (!box) return;
    Object.assign(outline.style, { left: `${box.x * 100 / model.width}%`, top: `${box.y * 100 / model.height}%`,
      width: `${box.width * 100 / model.width}%`, height: `${box.height * 100 / model.height}%` });
    Object.assign(get("resize").style, { left: `clamp(0px, calc(${(box.x + box.width) * 100 / model.width}% - 24px), calc(100% - 48px))`,
      top: `clamp(0px, calc(${(box.y + box.height) * 100 / model.height}% - 24px), calc(100% - 48px))` });
  }

  function toggleFields() {
    const enabled = get("interactive").checked && object()?.type !== "image";
    get("label").disabled = get("active").disabled = !enabled;
    get("label").required = enabled;
  }

  function inspect() {
    drag = undefined;
    const shape = object();
    const index = model?.scene.objects.indexOf(shape) ?? -1;
    get("properties").disabled = !shape;
    get("delete").disabled = !shape;
    get("backward").disabled = !shape || index === 0;
    get("forward").disabled = !shape || index === model.scene.objects.length - 1;
    list.value = selected ?? "";
    if (shape) {
      const box = bounds(shape);
      get("object-name").textContent = `${shape.id} (${shape.type})`;
      get("x").value = box.x; get("y").value = box.y;
      for (const name of ["shape-width", "shape-height"]) {
        get(`${name}-row`).hidden = shape.type !== "rect";
        get(name).disabled = shape.type !== "rect";
      }
      get("shape-width").value = box.width; get("shape-height").value = box.height;
      get("radius-row").hidden = shape.type !== "circle";
      get("radius").disabled = shape.type !== "circle";
      get("radius").value = shape.radius ?? 1;
      get("fill-row").hidden = shape.type === "image";
      get("fill").disabled = shape.type === "image";
      get("fill").value = hex(shape.fill ?? [0, 0, 0]);
      const control = controls(model).find((entry) => entry.target === shape.id);
      get("interactive").disabled = shape.type === "image";
      get("interactive").checked = !!control;
      get("label").value = control?.label ?? shape.id;
      get("active").value = hex(control?.active_fill ?? [248, 113, 113]);
    } else { get("object-name").textContent = "Select an object"; }
    toggleFields();
    selectionBox();
  }

  function remember(text) {
    if (history[cursor] === text) return;
    history.splice(cursor + 1);
    history.push(text);
    // Approximate UTF-16 text storage, not a claim about total JS heap usage.
    let bytes = history.reduce((sum, value) => sum + value.length * 2, 0);
    while (history.length > 1 && (history.length > 40 || bytes > 4 * 1024 * 1024)) {
      bytes -= history.shift().length * 2;
    }
    cursor = history.length - 1;
  }

  function present(result, text) {
    model = result.value;
    if (!object()) selected = model.scene.objects[0]?.id;
    canvas.width = model.width; canvas.height = model.height;
    context.putImageData(result.frame, 0, 0);
    canvas.hidden = false;
    list.replaceChildren(...model.scene.objects.map((shape) => {
      const option = document.createElement("option");
      option.value = shape.id; option.textContent = `${shape.id} (${shape.type})`;
      return option;
    }));
    get("width").value = model.width; get("height").value = model.height;
    get("background").value = hex(model.scene.background);
    get("canvas-form").querySelector("button").disabled = false;
    get("add-rect").disabled = model.scene.objects.length >= 256;
    get("add-circle").disabled = model.scene.objects.length >= 256 || Math.min(model.width, model.height) < 2;
    get("undo").disabled = cursor <= 0;
    get("redo").disabled = cursor >= history.length - 1;
    if (saveUrl) URL.revokeObjectURL(saveUrl);
    saveUrl = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    save.href = saveUrl; save.hidden = false;
    inspect();
    status.textContent = `${model.width} × ${model.height}; ${model.scene.objects.length}/256 objects; ${controls(model).length}/64 controls. Design ready.`;
    scheduleRecovery(text);
  }

  function writeSource(text) {
    ownChange = true;
    source.value = text;
    source.dispatchEvent(new Event("input", { bubbles: true }));
    ownChange = false;
  }

  function accept(text, write = false, record = true) {
    try {
      const result = compile(text);
      if (record) remember(text);
      if (write) { revision++; writeSource(text); }
      present(result, text);
      return true;
    } catch (error) {
      status.textContent = `Not applied: ${error.message}`;
      return false;
    }
  }

  function edit(change) {
    if (!model) return;
    const next = clone(model);
    change(next);
    return accept(JSON.stringify(next, null, 2) + "\n", true);
  }

  function invalidate() {
    model = undefined; drag = undefined;
    canvas.hidden = outline.hidden = save.hidden = true;
    get("resize").hidden = true;
    save.removeAttribute("href");
    if (saveUrl) URL.revokeObjectURL(saveUrl);
    saveUrl = undefined;
    list.replaceChildren();
    for (const name of ["properties", "add-rect", "add-circle", "delete", "forward", "backward", "undo", "redo"]) get(name).disabled = true;
    get("canvas-form").querySelector("button").disabled = true;
    status.textContent = "Checking source…";
  }

  source.addEventListener("input", () => {
    if (ownChange) return;
    revision++;
    clearTimeout(timer);
    invalidate();
    timer = setTimeout(() => accept(source.value), 300);
  });
  list.addEventListener("change", () => { selected = list.value; inspect(); });
  get("interactive").addEventListener("change", toggleFields);
  get("new").addEventListener("click", () => {
    clearTimeout(timer); selected = undefined;
    accept(JSON.stringify({ width: 512, height: 320, scene: { background: [26, 32, 44], objects: [] } }, null, 2) + "\n", true);
  });
  get("use-template").addEventListener("click", () => {
    const rect = (id, x, y, width, height, fill) => ({ type: "rect", id, x, y, width, height, fill });
    const circle = (id, cx, cy, radius, fill) => ({ type: "circle", id, cx, cy, radius, fill });
    const control = (target, label, active_fill) => ({ target, label, active_fill });
    const templates = {
      card: { width: 512, height: 320, scene: { background: [20, 36, 54], objects: [
        rect("panel", 24, 24, 464, 272, [36, 59, 80]), circle("lamp", 256, 160, 72, [92, 117, 136])
      ] }, interaction: { controls: [control("lamp", "إضاءة البطاقة", [255, 209, 102])] } },
      signals: { width: 256, height: 512, scene: { background: [226, 232, 240], objects: [
        rect("case", 48, 24, 160, 464, [30, 41, 59]),
        ...[[112, "red"], [256, "amber"], [400, "green"]].map(([y, id]) => circle(id, 128, y, 56, [71, 85, 105]))
      ] }, interaction: { controls: [control("red", "إشارة حمراء", [239, 68, 68]), control("amber", "إشارة صفراء", [250, 204, 21]), control("green", "إشارة خضراء", [74, 222, 128])] } },
      rooms: { width: 640, height: 320, scene: { background: [220, 232, 225], objects: [
        ...[0, 1, 2].map((i) => rect(`room${i}`, 20 + i * 200, 20, 180, 280, [49, 75, 72])),
        ...[0, 1, 2].map((i) => circle(`light${i}`, 110 + i * 200, 100, 28, [100, 116, 110]))
      ] }, interaction: { controls: [0, 1, 2].map((i) => control(`light${i}`, `مصباح الغرفة ${i + 1}`, [255, 223, 128])) } }
    };
    clearTimeout(timer); selected = undefined;
    accept(JSON.stringify(templates[get("template").value], null, 2) + "\n", true);
  });
  get("autosave").addEventListener("change", () => {
    clearTimeout(recoveryTimer);
    if (get("autosave").checked) {
      if (recoveryPending) recoveryMessage("Restore or discard the existing recovery copy first.");
      else if (recoveryText !== undefined) scheduleRecovery(recoveryText);
    } else {
      try {
        localStorage.removeItem(recoveryKey); recoveryCopy = undefined; recoveryPending = false;
        get("restore").hidden = get("discard").hidden = true;
        recoveryMessage("Recovery is off; the local copy was deleted. Save source JSON before closing.");
      } catch { recoveryMessage("Recovery is off, but storage could not be cleared. Clear this site's storage in browser settings if needed."); }
    }
  });
  get("restore").addEventListener("click", () => {
    clearTimeout(timer);
    if (recoveryCopy !== undefined && accept(recoveryCopy, true)) {
      recoveryCopy = undefined; recoveryPending = false; get("restore").hidden = true;
      get("autosave").checked = true;
      scheduleRecovery(source.value);
    }
  });
  get("discard").addEventListener("click", () => {
    clearTimeout(recoveryTimer);
    try {
      localStorage.removeItem(recoveryKey); recoveryCopy = undefined; recoveryPending = false;
      get("restore").hidden = get("discard").hidden = true;
      recoveryMessage("Local recovery copy deleted.");
      if (get("autosave").checked && recoveryText !== undefined) scheduleRecovery(recoveryText);
    } catch { recoveryMessage("Could not delete recovery copy; browser storage is unavailable."); }
  });
  get("png").addEventListener("change", async (event) => {
    const file = event.target.files[0], expected = ++revision;
    event.target.value = "";
    if (!file || !model) return;
    if (file.size > 1024 * 1024) { status.textContent = "PNG rejected: maximum encoded size is 1 MiB."; return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (revision !== expected || !model) { status.textContent = "PNG import cancelled because the design changed."; return; }
      const signature = [137, 80, 78, 71, 13, 10, 26, 10];
      if (bytes.length < 33 || !signature.every((v, i) => bytes[i] === v)
          || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") throw new Error("Not a PNG image.");
      if (bytes[24] !== 8 || bytes[25] !== 2 || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0)
        throw new Error("Use non-interlaced RGB8 PNG without transparency. Other PNG profiles are not supported.");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = view.getUint32(16), height = view.getUint32(20);
      if (!width || !height || width > model.width || height > model.height) throw new Error("PNG must fit inside the canvas. Increase the canvas size first.");
      if ((model.assets?.length ?? 0) >= 32 || model.scene.objects.length >= 256) throw new Error("Asset or object limit reached.");
      let number = 1;
      while ((model.assets ?? []).some((asset) => asset.id === `png${number}`)
          || model.scene.objects.some((shape) => shape.id === `png${number}`)) number++;
      const id = `png${number}`;
      const pieces = [];
      for (let i = 0; i < bytes.length; i += 8192) pieces.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
      const next = clone(model);
      (next.assets ??= []).push({ id, png_base64: btoa(pieces.join("")) });
      next.scene.objects.push({ type: "image", id, asset: id, x: 0, y: 0 });
      const previous = selected; selected = id;
      if (!accept(JSON.stringify(next, null, 2) + "\n", true)) selected = previous;
    } catch (error) { status.textContent = `PNG not applied: ${error.message}`; }
  });

  function add(type) {
    if (!model || model.scene.objects.length >= 256) return;
    let number = 1;
    while (model.scene.objects.some((shape) => shape.id === `shape${number}`)) number++;
    const id = `shape${number}`;
    const size = Math.max(1, Math.floor(Math.min(model.width, model.height) / 4));
    const shape = type === "rect"
      ? { type, id, x: 0, y: 0, width: size, height: size, fill: [96, 165, 250] }
      : { type, id, cx: size, cy: size, radius: size, fill: [250, 204, 21] };
    const previous = selected; selected = id;
    edit((next) => next.scene.objects.push(shape));
    if (!object()) { selected = previous; inspect(); }
  }
  get("add-rect").addEventListener("click", () => add("rect"));
  get("add-circle").addEventListener("click", () => add("circle"));
  get("canvas-form").addEventListener("submit", (event) => {
    event.preventDefault();
    edit((next) => {
      next.width = Number(get("width").value); next.height = Number(get("height").value);
      next.scene.background = rgb(get("background").value);
    });
  });
  get("object-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!object()) return;
    edit((next) => {
      const shape = next.scene.objects.find((entry) => entry.id === selected);
      const x = Number(get("x").value), y = Number(get("y").value);
      if (shape.type === "circle") {
        shape.radius = Number(get("radius").value);
        shape.cx = x + shape.radius; shape.cy = y + shape.radius;
      } else {
        shape.x = x; shape.y = y;
        if (shape.type === "rect") {
          shape.width = Number(get("shape-width").value); shape.height = Number(get("shape-height").value);
        }
      }
      if (shape.type !== "image") shape.fill = rgb(get("fill").value);
      const entries = controls(next).filter((entry) => entry.target !== selected);
      const old = controls(next).findIndex((entry) => entry.target === selected);
      if (get("interactive").checked && shape.type !== "image") {
        entries.splice(old < 0 ? entries.length : old, 0,
          { target: selected, label: get("label").value, active_fill: rgb(get("active").value) });
      }
      if (entries.length) next.interaction = { controls: entries };
      else delete next.interaction;
    });
  });

  get("delete").addEventListener("click", () => edit((next) => {
    next.scene.objects = next.scene.objects.filter((shape) => shape.id !== selected);
    const entries = controls(next).filter((entry) => entry.target !== selected);
    if (entries.length) next.interaction = { controls: entries }; else delete next.interaction;
  }));
  for (const [name, direction] of [["backward", -1], ["forward", 1]]) {
    get(name).addEventListener("click", () => edit((next) => {
      const index = next.scene.objects.findIndex((shape) => shape.id === selected);
      if (index < 0 || index + direction < 0 || index + direction >= next.scene.objects.length) return;
      [next.scene.objects[index], next.scene.objects[index + direction]] = [next.scene.objects[index + direction], next.scene.objects[index]];
    }));
  }
  for (const [name, direction] of [["undo", -1], ["redo", 1]]) {
    get(name).addEventListener("click", () => {
      const target = cursor + direction;
      if (target < 0 || target >= history.length) return;
      if (accept(history[target], true, false)) {
        cursor = target;
        get("undo").disabled = cursor <= 0; get("redo").disabled = cursor >= history.length - 1;
      }
    });
  }

  function move(box, dx, dy) {
    return { ...box, x: Math.max(0, Math.min(model.width - box.width, box.x + dx)),
      y: Math.max(0, Math.min(model.height - box.height, box.y + dy)) };
  }
  function relocate(box) {
    edit((next) => {
      const shape = next.scene.objects.find((entry) => entry.id === selected);
      if (shape.type === "circle") { shape.cx = box.x + shape.radius; shape.cy = box.y + shape.radius; }
      else { shape.x = box.x; shape.y = box.y; }
    });
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.floor((event.clientX - rect.left) * model.width / rect.width),
      y: Math.floor((event.clientY - rect.top) * model.height / rect.height) };
  }
  function resized(box, dx, dy, circle) {
    if (circle) {
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      const size = 2 * Math.max(1, Math.min(Math.floor((model.width - box.x) / 2),
        Math.floor((model.height - box.y) / 2), Math.floor((box.width + delta) / 2)));
      return { ...box, width: size, height: size };
    }
    const width = Math.max(circle ? 2 : 1, Math.min(model.width - box.x, box.width + dx));
    const height = Math.max(circle ? 2 : 1, Math.min(model.height - box.y, box.height + dy));
    const size = Math.max(2, Math.floor(Math.min(width, height) / 2) * 2);
    return { ...box, width: circle ? size : width, height: circle ? size : height };
  }
  function applySize(box) {
    if (!object()) return;
    const applied = edit((next) => {
      const shape = next.scene.objects.find((entry) => entry.id === selected);
      if (shape.type === "rect") { shape.width = box.width; shape.height = box.height; }
      if (shape.type === "circle") { shape.radius = box.width / 2; shape.cx = box.x + shape.radius; shape.cy = box.y + shape.radius; }
    });
    if (!applied) selectionBox();
  }
  get("resize").addEventListener("pointerdown", (event) => {
    if (!object() || object().type === "image" || event.button !== 0) return;
    event.preventDefault(); stage.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    drag = { mode: "resize", pointer: event.pointerId, start: point(event), box: bounds(object()), next: bounds(object()) };
  });
  get("resize").addEventListener("click", () => {
    if (object()) get(object().type === "circle" ? "radius" : "shape-width").focus();
  });
  get("resize").addEventListener("keydown", (event) => {
    const offset = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!offset || !object()) return;
    event.preventDefault(); event.stopPropagation();
    const step = (event.shiftKey ? 10 : 1) * (object().type === "circle" ? 2 : 1);
    applySize(resized(bounds(object()), offset[0] * step, offset[1] * step, object().type === "circle"));
    get("resize").focus();
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (!model || event.button !== 0 || drag) return;
    const start = point(event);
    const hit = [...model.scene.objects].reverse().find((shape) => {
      const box = bounds(shape), x = start.x + .5, y = start.y + .5;
      return shape.type === "circle" ? (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.radius ** 2
        : x >= box.x && y >= box.y && x < box.x + box.width && y < box.y + box.height;
    });
    selected = hit?.id;
    inspect(); stage.focus({ preventScroll: true });
    if (!hit) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drag = { pointer: event.pointerId, start, box: bounds(hit), next: bounds(hit) };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointer !== event.pointerId || !model) return;
    const at = point(event);
    drag.next = drag.mode === "resize"
      ? resized(drag.box, at.x - drag.start.x, at.y - drag.start.y, object().type === "circle")
      : move(drag.box, at.x - drag.start.x, at.y - drag.start.y);
    selectionBox(drag.next);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const next = drag.next, old = drag.box, mode = drag.mode; drag = undefined;
    if (mode === "resize" && (next.width !== old.width || next.height !== old.height)) applySize(next);
    else if (next.x !== old.x || next.y !== old.y) relocate(next);
    else selectionBox();
  });
  canvas.addEventListener("pointercancel", () => { drag = undefined; selectionBox(); });
  canvas.addEventListener("lostpointercapture", () => { drag = undefined; selectionBox(); });
  stage.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { drag = undefined; selectionBox(); return; }
    const offset = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!offset || !object()) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    relocate(move(bounds(object()), offset[0] * step, offset[1] * step));
  });

  get("import").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    const expected = ++revision;
    event.target.value = "";
    if (!file) return;
    if (file.size > limit) { status.textContent = "Import rejected: source exceeds 12 MiB."; return; }
    try {
      const text = await file.text();
      if (revision !== expected) { status.textContent = "Import cancelled because the design changed while reading."; return; }
      clearTimeout(timer);
      accept(text, true);
    } catch { status.textContent = "Could not read the source file."; }
  });
  root.hidden = false;
  readRecovery();
  invalidate();
  accept(source.value);
}
