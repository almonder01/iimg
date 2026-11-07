// Core validates the entire draft before any edit is accepted.
export function mountDragTools(root, api) {
  const get = (name) => root.querySelector(`#editor-drag-${name}`);
  const names = ["id", "label", "axis", "min", "max", "step", "initial", "from-x", "from-y", "to-x", "to-y"];
  get("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const model = api.model(), target = api.selected();
    if (!model || !target) return;
    if ((model.interaction?.controls ?? []).some((entry) => entry.target === target)
        || model.motion?.tracks.some((entry) => entry.target === target)) {
      api.message("Remove this object's button or motion track before making it a slider."); return;
    }
    const value = Object.fromEntries(names.slice(0, 3).map((name) => [name, get(name).value]));
    for (const name of ["min", "max", "step", "initial"]) value[name] = Number(get(name).value);
    for (const key of ["from", "to"]) value[key] = { x: Number(get(`${key}-x`).value), y: Number(get(`${key}-y`).value) };
    value.target = target;
    const applied = api.edit((next) => {
      const sliders = (next.drag ??= { sliders: [] }).sliders;
      const index = sliders.findIndex((entry) => entry.target === target);
      if (index < 0) sliders.push(value); else sliders[index] = value;
    });
    if (applied) api.core();
  });
  get("remove").addEventListener("click", () => api.edit((next) => {
    if (!next.drag) return;
    next.drag.sliders = next.drag.sliders.filter((entry) => entry.target !== api.selected());
    if (!next.drag.sliders.length) delete next.drag;
  }));
  return { refresh() {
    const model = api.model(), target = api.selected();
    const shape = model?.scene.objects.find((entry) => entry.id === target);
    get("fields").disabled = !shape;
    const slider = model?.drag?.sliders.find((entry) => entry.target === target);
    get("remove").disabled = !slider;
    if (!shape) return;
    const box = api.bounds(shape);
    const value = slider ?? { id: `slider_${target}`.slice(0, 64), label: target, axis: "x", min: 0, max: 100, step: 1, initial: 0,
      from: { x: box.x, y: box.y }, to: { x: model.width - box.width, y: box.y } };
    for (const name of names.slice(0, 7)) get(name).value = value[name];
    for (const key of ["from", "to"]) for (const coordinate of ["x", "y"]) get(`${key}-${coordinate}`).value = value[key][coordinate];
  } };
}
