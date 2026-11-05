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
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const hex = (color) => `#${color.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const object = () => model?.scene.objects.find((shape) => shape.id === selected);
  const controls = (value) => value.interaction?.controls ?? [];

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
    if (!box) return;
    Object.assign(outline.style, { left: `${box.x * 100 / model.width}%`, top: `${box.y * 100 / model.height}%`,
      width: `${box.width * 100 / model.width}%`, height: `${box.height * 100 / model.height}%` });
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
    accept(JSON.stringify(next, null, 2) + "\n", true);
  }

  function invalidate() {
    model = undefined; drag = undefined;
    canvas.hidden = outline.hidden = save.hidden = true;
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
    drag.next = move(drag.box, at.x - drag.start.x, at.y - drag.start.y);
    selectionBox(drag.next);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const next = drag.next, old = drag.box; drag = undefined;
    if (next.x !== old.x || next.y !== old.y) relocate(next);
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
  invalidate();
  accept(source.value);
}
