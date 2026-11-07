const file = document.querySelector("#file");
const status = document.querySelector("#status");
const canvas = document.querySelector("#scene");
const preview = document.querySelector("#preview");
const controls = document.querySelector("#controls");
const reset = document.querySelector("#reset");
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
  const output = () => new Uint8Array(wasm.memory.buffer, wasm.output_ptr(), wasm.output_len());
  const describe = () => {
    wasm.describe();
    return JSON.parse(decoder.decode(output()));
  };

  function draw() {
    const { width, height, controls: state } = describe();
    if (wasm.render() !== 0) throw new Error("The scene exceeds the rendering budget.");
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const image = context.createImageData(width, height);
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
  }

  function clear() {
    canvas.hidden = preview.hidden = controls.hidden = reset.hidden = help.hidden = true;
    controls.replaceChildren();
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
      const state = describe().controls;
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
      draw();
      canvas.hidden = false;
      controls.hidden = reset.hidden = state.length === 0;
      help.hidden = state.length === 0;
      if (state.length) canvas.setAttribute("aria-describedby", "interaction-help");
      else canvas.removeAttribute("aria-describedby");
      status.textContent = state.length ? "Image ready. Tap the image or use its controls." : "Image ready.";
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

  canvas.addEventListener("click", (event) => {
    const bounds = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - bounds.left) * canvas.width / bounds.width);
    const y = Math.floor((event.clientY - bounds.top) * canvas.height / bounds.height);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
    wasm.activate_pixel(x, y);
    draw();
  });
  reset.addEventListener("click", () => {
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
