// Visual tools for RFC 0003. Only accepted source transactions reach the host.
export function mountStateTools(root, { model, selected, edit, message, core, hex, rgb }) {
  const get = (name) => root.querySelector(`#editor-${name}`);
  const machine = () => model()?.interaction?.states ? model().interaction : undefined;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const option = (value, text = value) => { const node = document.createElement("option"); node.value = value; node.textContent = text; return node; };
  const shape = () => model()?.scene.objects.find((entry) => entry.id === selected());
  function choices(name, entries) {
    const field = get(name), value = field.value;
    field.replaceChildren(...entries.map((state) => option(state.id)));
    if (entries.some((state) => state.id === value)) field.value = value;
  }
  function actionValue() {
    const state = machine()?.states.find((entry) => entry.id === get("action-state").value);
    get("action-value").disabled = get("action-type").value !== "set";
    get("action-value").max = state?.max ?? 15;
  }
  function bindingRows() {
    const current = machine(), target = shape();
    const state = current?.states.find((entry) => entry.id === get("binding-state").value);
    const container = get("binding-values"); container.replaceChildren();
    if (!state || !target) return;
    const binding = current.bindings.find((entry) => entry.target === target.id && entry.state === state.id);
    for (let index = 0; index <= state.max; index++) {
      const row = document.createElement("div"); row.className = "editor-fields";
      const visible = document.createElement("input"); visible.type = "checkbox";
      visible.checked = binding?.values[index]?.visible ?? true; visible.dataset.styleVisible = String(index);
      const override = document.createElement("input"); override.type = "checkbox";
      override.checked = binding?.values[index]?.fill != null;
      override.disabled = target.type === "image"; override.dataset.styleOverride = String(index);
      const color = document.createElement("input"); color.type = "color";
      color.value = hex(binding?.values[index]?.fill ?? target.fill ?? [0, 0, 0]); color.dataset.styleColor = String(index);
      color.disabled = !override.checked || target.type === "image";
      override.addEventListener("change", () => { color.disabled = !override.checked; });
      for (const [input, label] of [[visible, `Value ${index} visible`], [override, `Value ${index} override color`], [color, `Value ${index} color`]]) {
        const node = document.createElement("label"); node.append(document.createTextNode(label), input); row.append(node);
      }
      container.append(row);
    }
  }
  function refresh() {
    const current = machine(), target = shape();
    get("enable-states").disabled = !model() || !!current || model().scene.objects.length === 0;
    get("state-fields").hidden = !current;
    if (!current) return;
    core();
    for (const name of ["state-list", "action-state", "binding-state", "motion-state"]) choices(name, current.states);
    const active = current.states.find((entry) => entry.id === get("state-list").value);
    get("state-id").value = active?.id ?? "";
    get("state-initial").value = active?.initial ?? 0; get("state-max").value = active?.max ?? 1;
    const control = current.controls.find((entry) => entry.target === target?.id);
    get("action-label").value = control?.label ?? target?.id ?? "";
    get("action-form").querySelector("button").disabled = !target;
    get("binding-form").querySelector("button").disabled = !target;
    get("remove-binding").disabled = !target || !current.bindings.some((entry) => entry.target === target.id);
    get("actions").replaceChildren(...(control?.actions ?? []).map((action) => {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = `Remove ${action.type} action: ${action.state}${action.type === "set" ? ` = ${action.value}` : ""}`;
      button.addEventListener("click", () => {
        if (control.actions.length === 1 && current.controls.length === 1) { message("Keep at least one control; add another before removing the last action."); return; }
        edit((next) => {
          const entry = next.interaction.controls.find((item) => item.target === target.id);
          entry.actions = entry.actions.filter((item) => item.state !== action.state);
          next.interaction.controls = next.interaction.controls.filter((item) => item.actions.length);
        });
      });
      return button;
    }));
    const track = model().motion?.tracks.find((entry) => entry.target === target?.id);
    if (track) get("motion-state").value = track.state;
    const variable = current.states.find((entry) => entry.id === get("motion-state").value);
    get("motion-equals").max = variable?.max ?? 15;
    get("motion-equals").value = track?.equals ?? Math.min(1, variable?.max ?? 1);
    get("motion-duration").value = track?.duration_ms ?? 1000;
    get("motion-repeat").value = track?.repeat ?? 1;
    const x = target?.type === "circle" ? target.cx - target.radius : target?.x ?? 0;
    const y = target?.type === "circle" ? target.cy - target.radius : target?.y ?? 0;
    for (const side of ["from", "to"]) {
      get(`motion-${side}-x`).value = track?.[side].x ?? x;
      get(`motion-${side}-y`).value = track?.[side].y ?? y;
    }
    get("motion-form").querySelector("button").disabled = !target;
    get("remove-motion").disabled = !track;
    actionValue(); bindingRows();
  }
  get("enable-states").addEventListener("click", () => {
    const value = model(); if (!value || machine()) return;
    const existing = value.interaction?.controls ?? [];
    if (existing.length > 32) { message("Conversion supports up to 32 independent states. Reduce the toggle controls first."); return; }
    const controls = existing.length ? existing : [{ target: value.scene.objects[0].id, label: value.scene.objects[0].id, active_fill: [248, 113, 113] }];
    edit((next) => {
      next.interaction = {
        states: controls.map((_, index) => ({ id: `state${index + 1}`, initial: 0, max: 1 })),
        controls: controls.map((entry, index) => ({ target: entry.target, label: entry.label, actions: [{ type: "cycle", state: `state${index + 1}` }] })),
        bindings: controls.map((entry, index) => ({ target: entry.target, state: `state${index + 1}`, values:
          next.scene.objects.find((object) => object.id === entry.target).type === "image"
            ? [{ visible: true }, { visible: false }]
            : [{ visible: true }, { visible: true, fill: entry.active_fill }] }))
      };
    });
  });
  get("state-list").addEventListener("change", () => {
    const state = machine()?.states.find((entry) => entry.id === get("state-list").value);
    if (state) { get("state-id").value = state.id; get("state-initial").value = state.initial; get("state-max").value = state.max; }
  });
  get("state-form").addEventListener("submit", (event) => {
    event.preventDefault(); if (!machine()) return;
    const state = { id: get("state-id").value, initial: Number(get("state-initial").value), max: Number(get("state-max").value) };
    edit((next) => {
      const existing = next.interaction.states.findIndex((entry) => entry.id === state.id);
      if (existing < 0) next.interaction.states.push(state); else next.interaction.states[existing] = state;
      for (const binding of next.interaction.bindings.filter((entry) => entry.state === state.id)) {
        binding.values = Array.from({ length: state.max + 1 }, (_, index) => copy(binding.values[Math.min(index, binding.values.length - 1)]));
      }
    });
  });
  get("delete-state").addEventListener("click", () => {
    const value = machine(), id = get("state-list").value; if (!value) return;
    if (value.states.length === 1 || value.bindings.some((entry) => entry.state === id)
        || model().motion?.tracks.some((entry) => entry.state === id)
        || value.controls.some((entry) => entry.actions.some((action) => action.state === id))) {
      message("State is still referenced, or is the last state. Remove its bindings/actions first."); return;
    }
    edit((next) => { next.interaction.states = next.interaction.states.filter((entry) => entry.id !== id); });
  });
  for (const name of ["action-state", "action-type"]) get(name).addEventListener("change", actionValue);
  get("action-form").addEventListener("submit", (event) => {
    event.preventDefault(); if (!machine() || !shape()) return;
    const target = selected(), state = get("action-state").value;
    const action = { type: get("action-type").value, state };
    if (action.type === "set") action.value = Number(get("action-value").value);
    edit((next) => {
      let control = next.interaction.controls.find((entry) => entry.target === target);
      if (!control) { control = { target, label: get("action-label").value, actions: [] }; next.interaction.controls.push(control); }
      control.label = get("action-label").value;
      const index = control.actions.findIndex((entry) => entry.state === state);
      if (index < 0) control.actions.push(action); else control.actions[index] = action;
    });
  });
  get("binding-state").addEventListener("change", bindingRows);
  get("binding-form").addEventListener("submit", (event) => {
    event.preventDefault(); if (!machine() || !shape()) return;
    const target = selected(), state = get("binding-state").value;
    const definition = machine().states.find((entry) => entry.id === state);
    const values = Array.from({ length: definition.max + 1 }, (_, index) => {
      const style = { visible: get("binding-values").querySelector(`[data-style-visible="${index}"]`).checked };
      if (shape().type !== "image" && get("binding-values").querySelector(`[data-style-override="${index}"]`).checked)
        style.fill = rgb(get("binding-values").querySelector(`[data-style-color="${index}"]`).value);
      return style;
    });
    edit((next) => {
      next.interaction.bindings = next.interaction.bindings.filter((entry) => entry.target !== target);
      next.interaction.bindings.push({ target, state, values });
    });
  });
  get("remove-binding").addEventListener("click", () => {
    if (machine() && shape()) edit((next) => { next.interaction.bindings = next.interaction.bindings.filter((entry) => entry.target !== selected()); });
  });
  get("motion-state").addEventListener("change", () => {
    get("motion-equals").max = machine()?.states.find((entry) => entry.id === get("motion-state").value)?.max ?? 15;
  });
  get("motion-form").addEventListener("submit", (event) => {
    event.preventDefault(); if (!machine() || !shape()) return;
    const track = { target: selected(), state: get("motion-state").value, equals: Number(get("motion-equals").value),
      duration_ms: Number(get("motion-duration").value), repeat: Number(get("motion-repeat").value),
      from: { x: Number(get("motion-from-x").value), y: Number(get("motion-from-y").value) },
      to: { x: Number(get("motion-to-x").value), y: Number(get("motion-to-y").value) } };
    edit((next) => { next.motion = { tracks: [...(next.motion?.tracks ?? []).filter((entry) => entry.target !== selected()), track] }; });
  });
  get("remove-motion").addEventListener("click", () => {
    if (machine() && shape()) edit((next) => {
      next.motion.tracks = next.motion.tracks.filter((entry) => entry.target !== selected());
      if (!next.motion.tracks.length) delete next.motion;
    });
  });
  return { refresh };
}
