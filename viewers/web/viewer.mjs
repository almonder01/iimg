const file = document.querySelector("#file");
const status = document.querySelector("#status");
const canvas = document.querySelector("#scene");
const preview = document.querySelector("#preview");
const controls = document.querySelector("#controls");
const sliders = document.querySelector("#sliders");
const reset = document.querySelector("#reset");
const pauseMotion = document.querySelector("#pause-motion");
const help = document.querySelector("#interaction-help");
const main = document.querySelector("main");
const context = canvas.getContext("2d");
const decoder = new TextDecoder();
const androidHost = location.origin === "https://viewer.iimg.invalid";
let previewUrl;
let selection = 0;

async function start() {
  const response = await fetch(new URL("./iimg_web.wasm", import.meta.url));
  if (!response.ok) throw new Error("The WebAssembly engine could not be loaded.");
  const { instance, module } = await WebAssembly.instantiate(await response.arrayBuffer());
  const wasm = instance.exports;
  let pointer, suppressClick = false, clickTimer;
  function releasePointer() {
    const previous = pointer; pointer = undefined;
    if (previous !== undefined && canvas.hasPointerCapture(previous)) canvas.releasePointerCapture(previous);
    if (previous !== undefined) { clearTimeout(clickTimer); clickTimer = setTimeout(() => { suppressClick = false; }, 0); }
  }
  function cancelDrag(event) {
    if (pointer === undefined) return;
    if (event?.pointerId !== undefined && event.pointerId !== pointer) return;
    wasm.drag_cancel(); releasePointer(); draw();
  }
  let animationFrame = 0, lastTick, logicalClock = 0, motion = false, paused = false, imageData, hostBackground = false;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  function stopAnimation() { if (animationFrame) cancelAnimationFrame(animationFrame); animationFrame = 0; lastTick = undefined; }
  function scheduleAnimation() {
    if (!motion || paused || hostBackground || document.hidden || reducedMotion.matches || !wasm.motion_running()) { stopAnimation(); return; }
    if (animationFrame) return;
    animationFrame = requestAnimationFrame((now) => {
      animationFrame = 0;
      if (!motion || paused || hostBackground || document.hidden || reducedMotion.matches) { stopAnimation(); return; }
      if (lastTick === undefined) lastTick = now;
      const elapsed = Math.floor(now - lastTick);
      if (elapsed < 33) { scheduleAnimation(); return; }
      logicalClock = Math.min(86400000, logicalClock + elapsed); lastTick += elapsed;
      if (wasm.advance_time(logicalClock) !== 0) { stopAnimation(); status.textContent = "Motion clock stopped."; return; }
      draw();
    });
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelDrag(); stopAnimation(); scheduleAnimation(); });
  window.addEventListener("blur", cancelDrag);
  if (androidHost) window.iimgHostVisibility = (hidden) => { hostBackground = !!hidden; if (hostBackground) cancelDrag(); stopAnimation(); scheduleAnimation(); };
  reducedMotion.addEventListener("change", () => { if (motion) { wasm.motion_preference(Number(reducedMotion.matches)); draw(); } });
  pauseMotion.addEventListener("click", () => { paused = !paused; stopAnimation(); draw(); });
  const output = () => new Uint8Array(wasm.memory.buffer, wasm.output_ptr(), wasm.output_len());
  const describe = () => {
    wasm.describe();
    return JSON.parse(decoder.decode(output()));
  };

  function draw() {
    const description = describe();
    const { width, height, controls: state } = description;
    motion = !!description.motion;
    if (description.clock_ms < logicalClock) stopAnimation();
    logicalClock = description.clock_ms ?? 0;
    if (wasm.render() !== 0) throw new Error("The scene exceeds the rendering budget.");
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const image = imageData?.width === width && imageData?.height === height ? imageData : (imageData = context.createImageData(width, height));
    const rgb = output();
    for (let source = 0, dest = 0; source < rgb.length; source += 3, dest += 4) {
      image.data[dest] = rgb[source];
      image.data[dest + 1] = rgb[source + 1];
      image.data[dest + 2] = rgb[source + 2];
      image.data[dest + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    for (const [index, control] of state.entries()) {
      controls.children[index].setAttribute("aria-pressed", String(control.pressed));
      controls.children[index].hidden = control.visible === false;
    }
    for (const [index, slider] of (description.sliders ?? []).entries()) {
      const row = sliders.children[index];
      row.hidden = !slider.visible;
      row.querySelector("input").value = slider.value;
      row.querySelector("output").textContent = slider.value;
    }
    if (pointer !== undefined && description.drag_index == null) releasePointer();
    pauseMotion.hidden = !motion;
    pauseMotion.textContent = paused ? "Resume motion" : "Pause motion";
    pauseMotion.setAttribute("aria-pressed", String(paused));
    scheduleAnimation();
  }

  function clear() {
    releasePointer(); clearTimeout(clickTimer); suppressClick = false;
    stopAnimation(); motion = false; paused = false; logicalClock = 0; imageData = undefined;
    canvas.width = canvas.height = 1;
    pauseMotion.hidden = true;
    canvas.hidden = preview.hidden = controls.hidden = reset.hidden = help.hidden = true;
    controls.replaceChildren(); sliders.replaceChildren(); sliders.hidden = true;
    canvas.setAttribute("aria-label", "Interactive image");
    canvas.removeAttribute("lang"); controls.removeAttribute("lang"); sliders.removeAttribute("lang");
    if (previewUrl) {
      preview.removeAttribute("src");
      URL.revokeObjectURL(previewUrl);
      previewUrl = undefined;
    }
  }

  async function open(read) {
    const current = ++selection;
    wasm.unload();
    clear();
    main.setAttribute("aria-busy", String(!!read));
    if (!read) {
      status.textContent = "Choose an IIMG file.";
      return;
    }
    try {
      const bytes = new Uint8Array(await read());
      if (current !== selection) return;
      const input = wasm.prepare_input(bytes.length);
      if (!input) throw new Error("The file is empty or exceeds the size limit.");
      new Uint8Array(wasm.memory.buffer, input, bytes.length).set(bytes);
      const result = wasm.load();
      if (result === 1) {
        previewUrl = URL.createObjectURL(new Blob([output()], { type: "image/png" }));
        preview.src = previewUrl;
        preview.hidden = false;
        status.textContent = "Showing the static preview. This file requires unsupported features.";
        return;
      }
      if (result !== 0) throw new Error("This IIMG file is invalid or unsupported.");
      wasm.motion_preference(Number(reducedMotion.matches));
      const description = describe(), state = description.controls;
      if (description.accessibility) {
        canvas.setAttribute("aria-label", description.accessibility.description);
        for (const element of [canvas, controls, sliders]) element.lang = description.accessibility.language;
      }
      for (const [index, control] of state.entries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = control.label;
        button.dir = "auto";
        button.addEventListener("focus", () => wasm.focus_control(index));
        button.addEventListener("click", () => {
          wasm.focus_control(index);
          wasm.activate_focused();
          draw();
        });
        controls.append(button);
      }
      for (const [index, slider] of description.sliders.entries()) {
        const row = document.createElement("label"), name = document.createElement("span"), range = document.createElement("input"), value = document.createElement("output");
        name.textContent = slider.label; name.dir = "auto";
        range.type = "range"; range.min = slider.min; range.max = slider.max; range.step = slider.step; range.value = slider.value;
        range.setAttribute("aria-label", slider.label);
        range.addEventListener("focus", () => wasm.focus_control(-1));
        range.addEventListener("input", () => { wasm.set_slider_value(index, Number(range.value)); draw(); });
        row.append(name, range, value); sliders.append(row);
      }
      draw();
      canvas.hidden = false;
      const interactive = state.length + description.sliders.length > 0;
      controls.hidden = state.length === 0;
      sliders.hidden = description.sliders.length === 0;
      reset.hidden = help.hidden = !interactive;
      if (interactive) canvas.setAttribute("aria-describedby", "interaction-help");
      else canvas.removeAttribute("aria-describedby");
      status.textContent = interactive ? "Image ready. Use the image or its controls." : "Image ready.";
    } catch (error) {
      if (current !== selection) return;
      clear();
      status.textContent = error.message;
    } finally {
      if (current === selection) main.setAttribute("aria-busy", "false");
    }
  }

  file.addEventListener("change", () => {
    const selected = file.files[0];
    open(selected && (() => {
      if (selected.size > 16 * 1024 * 1024) throw new Error("The file exceeds 16 MiB.");
      return selected.arrayBuffer();
    }));
  });

  function coordinates(event, clamp = false) {
    const bounds = canvas.getBoundingClientRect();
    let x = Math.floor((event.clientX - bounds.left) * canvas.width / bounds.width);
    let y = Math.floor((event.clientY - bounds.top) * canvas.height / bounds.height);
    if (clamp) { x = Math.max(0, Math.min(canvas.width - 1, x)); y = Math.max(0, Math.min(canvas.height - 1, y)); }
    return { x, y };
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0 || pointer !== undefined) return;
    const { x, y } = coordinates(event);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height || wasm.drag_start(x, y) !== 0) return;
    pointer = event.pointerId; suppressClick = true; clearTimeout(clickTimer);
    canvas.setPointerCapture(pointer); event.preventDefault(); draw();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (pointer !== event.pointerId) return;
    const { x, y } = coordinates(event, true); wasm.drag_move(x, y); event.preventDefault(); draw();
  });
  canvas.addEventListener("pointerup", (event) => {
    if (pointer !== event.pointerId) return;
    const { x, y } = coordinates(event, true); wasm.drag_move(x, y); wasm.drag_end(); releasePointer(); draw();
    clickTimer = setTimeout(() => { suppressClick = false; }, 0);
  });
  canvas.addEventListener("pointercancel", cancelDrag);
  canvas.addEventListener("lostpointercapture", (event) => {
    // A queued loss from an earlier gesture may arrive after recapture with
    // the same mouse pointer ID. Do not cancel the newer live capture.
    if (pointer !== undefined && !canvas.hasPointerCapture(pointer)) cancelDrag(event);
  });
  canvas.addEventListener("click", (event) => {
    if (suppressClick) { suppressClick = false; return; }
    const { x, y } = coordinates(event);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
    wasm.activate_pixel(x, y);
    draw();
  });
  reset.addEventListener("click", () => {
    stopAnimation();
    wasm.reset();
    draw();
  });
  if (!androidHost) {
    const author = document.querySelector("#author");
    const source = document.querySelector("#source");
    const candidate = document.querySelector("#author-v1");
    const message = document.querySelector("#author-status");
    const download = document.querySelector("#download");
    const encoder = new TextEncoder();
    const sourceLimit = wasm.author_source_limit();
    let documentBytes;
    let downloadUrl;
    let validationTimer;
    let editorStarted = false;

    function scheduleValidation() {
      clearTimeout(validationTimer);
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = undefined;
      documentBytes = undefined;
      download.hidden = true;
      download.removeAttribute("href");
      message.textContent = "";
      validationTimer = setTimeout(validateSource, 250);
    }

    function validateSource() {
      clearTimeout(validationTimer);
      if (documentBytes) return;
      const value = source.value;
      if (value.length > sourceLimit) {
        message.textContent = "The source exceeds the authoring size limit.";
        return;
      }
      const bytes = encoder.encode(value);
      if (bytes.length > sourceLimit) {
        message.textContent = "The source exceeds the authoring size limit.";
        return;
      }
      const input = wasm.prepare_input(bytes.length);
      if (!input) {
        message.textContent = "Enter a source document.";
        return;
      }
      new Uint8Array(wasm.memory.buffer, input, bytes.length).set(bytes);
      const compile = candidate.checked ? wasm.compile_source_v1 : wasm.compile_source;
      if (compile() !== 0) {
        message.textContent = decoder.decode(output());
        return;
      }
      documentBytes = output().slice();
      downloadUrl = URL.createObjectURL(new Blob([documentBytes], { type: "application/octet-stream" }));
      download.href = downloadUrl;
      download.hidden = false;
      message.textContent = "Valid source. Download is ready.";
    }

    source.addEventListener("input", scheduleValidation);
    candidate.addEventListener("change", scheduleValidation);
    author.addEventListener("toggle", () => {
      if (author.open && !documentBytes) scheduleValidation();
      if (author.open && !editorStarted) {
        editorStarted = true;
        (async () => {
          try {
            const { mountEditor } = await import("./editor.mjs");
            const editor = await WebAssembly.instantiate(module);
            mountEditor(document.querySelector("#visual-editor"), source, editor.exports);
          } catch (error) {
            message.textContent = `Visual editor could not start: ${error.message}. JSON authoring is available.`;
          }
        })();
      }
    });
    document.querySelector("#compile").addEventListener("click", async () => {
      validateSource();
      const bytes = documentBytes;
      if (bytes) await open(() => bytes);
    });
    author.hidden = false;
  }
  file.disabled = false;
  status.textContent = "Choose an IIMG file.";
  return open;
}

const ready = start();
ready.catch((error) => { status.textContent = error.message; });

if (androidHost) {
  let sharedGeneration = 0;
  file.closest("label").hidden = true;
  window.iimgOpenShared = async (id) => {
    if (!Number.isSafeInteger(id) || id < sharedGeneration) return;
    sharedGeneration = id;
    const open = await ready;
    if (id !== sharedGeneration) return;
    await open(async () => {
      const response = await fetch(new URL(`./incoming/${id}`, import.meta.url));
      if (!response.ok) throw new Error("The selected document could not be opened.");
      return response.arrayBuffer();
    });
  };
  window.iimgClearShared = async (id, reading = false) => {
    if (!Number.isSafeInteger(id) || id < sharedGeneration) return;
    sharedGeneration = id;
    const open = await ready;
    if (id !== sharedGeneration) return;
    await open();
    if (id !== sharedGeneration) return;
    status.textContent = "";
    main.setAttribute("aria-busy", String(reading));
  };
}

if (!androidHost && "serviceWorker" in navigator) {
  navigator.serviceWorker.register(new URL("./offline.js", import.meta.url)).catch((error) => {
    console.warn("Offline cache could not be installed.", error);
  });
}
