"""Independent draft IIMG envelope and RGB8 preview reader."""

import json
import re
import struct
import zlib

IIMG_MAGIC = b"IIMG\r\n\x1a\n"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
CORE = {b"META", b"PREV", b"SCNE", b"ASST", b"INTR", b"STAC", b"MOTN", b"DRAG", b"IEND"}
PROFILES = {(0, 2): "iimg-visual-0.2", (1, 0): "iimg-core-1"}


class Invalid(ValueError):
    pass


def chunks(data, max_chunk):
    offset = 0
    for _ in range(1024):
        if offset == len(data):
            return
        if len(data) - offset < 12:
            raise Invalid("truncated chunk")
        size, kind = struct.unpack_from(">I4s", data, offset)
        end = offset + 8 + size
        if size > max_chunk or end + 4 > len(data):
            raise Invalid("invalid chunk size")
        if not re.fullmatch(rb"[A-Za-z]{4}", kind):
            raise Invalid("invalid chunk type")
        if zlib.crc32(data[offset + 4:end]) != struct.unpack_from(">I", data, end)[0]:
            raise Invalid("chunk CRC")
        yield kind, data[offset + 8:end]
        offset = end + 4
    if offset != len(data):
        raise Invalid("chunk count")


def envelope(data, preview_only=False):
    if len(data) > 16 * 1024 * 1024 or not data.startswith(IIMG_MAGIC):
        raise Invalid("invalid envelope header")
    header = data[8:12]
    if len(header) != 4 or header[2:] != b"\0\0":
        raise Invalid("unsupported envelope version or flags")
    version = tuple(header[:2])
    visual = version in PROFILES
    if not visual and version != (0, 1):
        raise Invalid("unsupported envelope version or flags")
    records = list(chunks(data[12:], 8 * 1024 * 1024))
    if not records or records[0][0] != b"META" or records[-1] != (b"IEND", b""):
        raise Invalid("missing envelope boundary")
    kinds = [kind for kind, _ in records]
    if kinds.count(b"META") != 1 or kinds.count(b"IEND") != 1:
        raise Invalid("duplicate envelope boundary")
    if not (preview_only and visual):
        if any(kind not in CORE and kind[:1].isupper() for kind in kinds):
            raise Invalid("unknown critical chunk")
    if visual:
        if kinds.count(b"aTXT") > 1 or (b"aTXT" in kinds and (b"SCNE" not in kinds or kinds.index(b"aTXT") < kinds.index(b"SCNE"))):
            raise Invalid("alternative description ordering/count")
        known = [kind for kind in kinds if kind in CORE]
        expected = [b"META", b"PREV", b"SCNE"]
        expected.extend(kind for kind in (b"ASST", b"INTR", b"STAC", b"MOTN", b"DRAG") if kind in known)
        if b"INTR" in known and b"STAC" in known:
            raise Invalid("conflicting interaction chunks")
        if b"MOTN" in known and not ({b"INTR", b"STAC"} & set(known)):
            raise Invalid("motion ordering")
        if kinds[1] != b"PREV" or known != expected + [b"IEND"]:
            raise Invalid("invalid visual chunk order")
    return version, records


def strict_json(data, limit):
    if len(data) > limit:
        raise Invalid("JSON payload exceeds limit")

    def unique(pairs):
        result = dict(pairs)
        if len(result) != len(pairs):
            raise Invalid("duplicate JSON field")
        return result

    def invalid_constant(_):
        raise Invalid("invalid JSON constant")

    def unsigned_integer(token):
        if token.startswith("-"):
            raise Invalid("negative integer token")
        return int(token)

    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=unique,
                           parse_int=unsigned_integer, parse_float=invalid_constant,
                           parse_constant=invalid_constant)
        pending = [value]
        while pending:
            item = pending.pop()
            if isinstance(item, str):
                item.encode("utf-8")
            elif isinstance(item, dict):
                pending.extend(item)
                pending.extend(item.values())
            elif isinstance(item, list):
                pending.extend(item)
        return value
    except (ValueError, RecursionError) as error:
        raise Invalid("invalid JSON payload") from error


def metadata(data, version, preview_only=False):
    meta = strict_json(data, 4096)
    if not isinstance(meta, dict) or set(meta) != {"profile", "width", "height", "required"}:
        raise Invalid("invalid metadata")
    if meta["profile"] != PROFILES[version]:
        raise Invalid("unsupported profile")
    width, height = meta["width"], meta["height"]
    if any(type(side) is not int or not 1 <= side <= 2048 for side in (width, height)):
        raise Invalid("invalid canvas dimensions")
    required = meta["required"]
    if not isinstance(required, list) or not all(isinstance(item, str) for item in required):
        raise Invalid("invalid capability list")
    if not preview_only:
        if set(required) - {"raster-png", "toggle-fill", "state-actions", "motion-linear", "drag-value"} or len(set(required)) != len(required):
            raise Invalid("unsupported or duplicate capability")
        if "state-actions" in required and (version != (1, 0) or "toggle-fill" in required):
            raise Invalid("invalid state capability")
        if "drag-value" in required and version != (1, 0):
            raise Invalid("invalid drag capability")
        if "motion-linear" in required and (version != (1, 0) or "state-actions" not in required):
            raise Invalid("invalid motion capability")
    return width, height


def paeth(left, up, upper_left):
    prediction = left + up - upper_left
    return min((left, up, upper_left), key=lambda value: abs(prediction - value))


def decode_png(png, width, height):
    if len(png) > 1024 * 1024 or not png.startswith(PNG_MAGIC):
        raise Invalid("invalid PNG framing")
    records = list(chunks(png[8:], 1024 * 1024))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    if (len(records) < 3 or records[0] != (b"IHDR", header)
            or records[-1] != (b"IEND", b"")
            or any(kind != b"IDAT" for kind, _ in records[1:-1])):
        raise Invalid("unsupported PNG layout")
    compressed = b"".join(payload for _, payload in records[1:-1])
    stride = width * 3
    length = height * (stride + 1)
    inflater = zlib.decompressobj()
    try:
        filtered = inflater.decompress(compressed, length + 1)
    except zlib.error as error:
        raise Invalid("invalid PNG zlib stream") from error
    if len(filtered) != length or not inflater.eof or inflater.unused_data:
        raise Invalid("incorrect PNG stream length")
    rgb = bytearray(height * stride)
    for y in range(height):
        method = filtered[y * (stride + 1)]
        if method > 4:
            raise Invalid("invalid PNG filter")
        for x in range(stride):
            offset = y * stride + x
            left = rgb[offset - 3] if x >= 3 else 0
            up = rgb[offset - stride] if y else 0
            upper_left = rgb[offset - stride - 3] if x >= 3 and y else 0
            predictors = (0, left, up, (left + up) // 2, paeth(left, up, upper_left))
            rgb[offset] = (filtered[offset + y + 1] + predictors[method]) % 256
    return bytes(rgb)


def read_preview(data):
    version, records = envelope(data, preview_only=True)
    if version not in PROFILES:
        raise Invalid("preview requires a visual wire version")
    width, height = metadata(records[0][1], version, preview_only=True)
    png = records[1][1]
    return png, width, height, decode_png(png, width, height)


def fields(value, *keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise Invalid("unexpected object fields")


def integer(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise Invalid("integer outside permitted range")
    return value


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value):
        raise Invalid("invalid identifier")
    return value


def color(value):
    if not isinstance(value, list) or len(value) != 3:
        raise Invalid("invalid RGB color")
    return bytes(integer(channel, 0, 255) for channel in value)


def asset_table(data):
    offset = 0

    def take(length):
        nonlocal offset
        end = offset + length
        if end > len(data):
            raise Invalid("truncated asset table")
        value = data[offset:end]
        offset = end
        return value

    count = integer(int.from_bytes(take(2), "big"), 1, 32)
    headers = {}
    area = 0
    for _ in range(count):
        size = take(1)[0]
        try:
            name = identifier(take(size).decode("ascii"))
        except UnicodeError as error:
            raise Invalid("invalid asset ID") from error
        if name in headers:
            raise Invalid("duplicate asset ID")
        size = integer(int.from_bytes(take(4), "big"), 1, 1024 * 1024)
        png = take(size)
        if len(png) < 24 or png[:16] != PNG_MAGIC + b"\0\0\0\rIHDR":
            raise Invalid("invalid asset PNG header")
        width, height = struct.unpack_from(">II", png, 16)
        integer(width, 1, 2048)
        integer(height, 1, 2048)
        area += width * height
        if area > 4 * 1024 * 1024:
            raise Invalid("asset area budget")
        headers[name] = (width, height, png)
    if offset != len(data):
        raise Invalid("trailing asset bytes")
    return {name: (w, h, decode_png(png, w, h)) for name, (w, h, png) in headers.items()}


def scene_payload(data, width, height, assets):
    scene = strict_json(data, 128 * 1024)
    fields(scene, "background", "objects")
    color(scene["background"])
    objects = scene["objects"]
    if not isinstance(objects, list) or len(objects) > 256:
        raise Invalid("invalid object list")
    targets = {}
    for shape in objects:
        kind = shape.get("type") if isinstance(shape, dict) else None
        if kind == "rect":
            fields(shape, "type", "id", "x", "y", "width", "height", "fill")
            x, y = integer(shape["x"], 0, width), integer(shape["y"], 0, height)
            integer(shape["width"], 1, width - x)
            integer(shape["height"], 1, height - y)
            color(shape["fill"])
        elif kind == "circle":
            fields(shape, "type", "id", "cx", "cy", "radius", "fill")
            x, y = integer(shape["cx"], 0, width), integer(shape["cy"], 0, height)
            integer(shape["radius"], 1, min(x, y, width - x, height - y))
            color(shape["fill"])
        elif kind == "image":
            fields(shape, "type", "id", "asset", "x", "y")
            asset = identifier(shape["asset"])
            if asset not in assets:
                raise Invalid("missing asset reference")
            asset_width, asset_height, _ = assets[asset]
            integer(shape["x"], 0, width - asset_width)
            integer(shape["y"], 0, height - asset_height)
        else:
            raise Invalid("unknown shape type")
        target = identifier(shape["id"])
        if target in targets:
            raise Invalid("duplicate object ID")
        targets[target] = kind
    return scene, targets


def controls_payload(data, targets):
    payload = strict_json(data, 32 * 1024)
    fields(payload, "controls")
    controls = payload["controls"]
    if not isinstance(controls, list) or not 1 <= len(controls) <= 64:
        raise Invalid("invalid control list")
    seen = set()
    for control in controls:
        fields(control, "target", "label", "active_fill")
        target = identifier(control["target"])
        if target in seen or targets.get(target) not in ("rect", "circle"):
            raise Invalid("invalid control target")
        seen.add(target)
        label = control["label"]
        if not isinstance(label, str) or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in label):
            raise Invalid("invalid control label")
        try:
            length = len(label.encode("utf-8"))
        except UnicodeError as error:
            raise Invalid("invalid control label encoding") from error
        if not label.strip() or length > 256:
            raise Invalid("invalid control label length")
        color(control["active_fill"])
    return controls


def states_payload(data, targets):
    payload = strict_json(data, 32 * 1024)
    fields(payload, "states", "controls", "bindings")
    states, controls, bindings = (payload[key] for key in ("states", "controls", "bindings"))
    for values, low, high in ((states, 1, 32), (controls, 1, 64), (bindings, 0, 256)):
        if not isinstance(values, list) or not low <= len(values) <= high:
            raise Invalid("state payload count")
    variables = {}
    for state in states:
        fields(state, "id", "initial", "max")
        name = identifier(state["id"])
        if name in variables:
            raise Invalid("duplicate state")
        maximum = integer(state["max"], 1, 15)
        integer(state["initial"], 0, maximum)
        variables[name] = state
    controlled = set()
    for control in controls:
        fields(control, "target", "label", "actions")
        target, label, actions = control["target"], control["label"], control["actions"]
        if not isinstance(target, str) or target not in targets or target in controlled:
            raise Invalid("invalid state control target")
        controlled.add(target)
        if (not isinstance(label, str) or not label.strip() or len(label.encode("utf-8")) > 256
                or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in label)):
            raise Invalid("invalid state control label")
        if not isinstance(actions, list) or not 1 <= len(actions) <= 8:
            raise Invalid("state action count")
        written = set()
        for action in actions:
            if not isinstance(action, dict):
                raise Invalid("invalid state action")
            kind = action.get("type")
            if kind == "cycle":
                fields(action, "type", "state")
            elif kind == "set":
                fields(action, "type", "state", "value")
            else:
                raise Invalid("unknown state action")
            name = action["state"]
            if not isinstance(name, str) or name not in variables or name in written:
                raise Invalid("invalid state action reference")
            written.add(name)
            if kind == "set":
                integer(action["value"], 0, variables[name]["max"])
    bound = set()
    for binding in bindings:
        fields(binding, "target", "state", "values")
        target, name, values = binding["target"], binding["state"], binding["values"]
        if not isinstance(target, str) or target not in targets or target in bound:
            raise Invalid("invalid binding target")
        bound.add(target)
        if not isinstance(name, str) or name not in variables or not isinstance(values, list) or len(values) != variables[name]["max"] + 1:
            raise Invalid("invalid binding values")
        for style in values:
            if not isinstance(style, dict) or "visible" not in style or set(style) - {"visible", "fill"} or type(style["visible"]) is not bool:
                raise Invalid("invalid binding style")
            if style.get("fill") is not None:
                if targets[target] == "image":
                    raise Invalid("image fill override")
                color(style["fill"])
    return payload


def motion_payload(data, scene, states, width, height, assets):
    payload = strict_json(data, 32 * 1024)
    fields(payload, "tracks")
    tracks = payload["tracks"]
    if not isinstance(tracks, list) or not 1 <= len(tracks) <= 64:
        raise Invalid("motion track count")
    objects = {shape["id"]: shape for shape in scene["objects"]}
    variables = {state["id"]: state for state in states["states"]}
    targets = set()
    for track in tracks:
        fields(track, "target", "state", "equals", "duration_ms", "repeat", "from", "to")
        target, name = track["target"], track["state"]
        if not isinstance(target, str) or target not in objects or target in targets or not isinstance(name, str) or name not in variables:
            raise Invalid("motion target/state")
        targets.add(target)
        integer(track["equals"], 0, variables[name]["max"])
        duration, count = integer(track["duration_ms"], 1, 60000), integer(track["repeat"], 1, 16)
        if duration * count > 600000:
            raise Invalid("motion lifetime")
        shape = objects[target]
        if shape["type"] == "rect":
            w, h = shape["width"], shape["height"]
        elif shape["type"] == "circle":
            w = h = 2 * shape["radius"]
        else:
            w, h, _ = assets[shape["asset"]]
        for point in (track["from"], track["to"]):
            fields(point, "x", "y")
            integer(point["x"], 0, width - w)
            integer(point["y"], 0, height - h)
    return tracks


def drag_payload(data, scene, width, height, assets, controls, tracks):
    payload = strict_json(data, 32 * 1024)
    fields(payload, "sliders")
    sliders = payload["sliders"]
    if not isinstance(sliders, list) or not 1 <= len(sliders) <= 32:
        raise Invalid("slider count")
    objects = {shape["id"]: shape for shape in scene["objects"]}
    ids, targets = set(), {item["target"] for item in controls + tracks}
    for slider in sliders:
        fields(slider, "id", "target", "label", "axis", "min", "max", "step", "initial", "from", "to")
        name, target, label = identifier(slider["id"]), slider["target"], slider["label"]
        if name in ids or not isinstance(target, str) or target not in objects or target in targets:
            raise Invalid("slider target/ID conflict")
        ids.add(name); targets.add(target)
        if (not isinstance(label, str) or not label.strip() or len(label.encode("utf-8")) > 256
                or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in label)):
            raise Invalid("slider label")
        low, high = integer(slider["min"], 0, 1023), integer(slider["max"], 1, 1024)
        step = integer(slider["step"], 1, 1024)
        initial = integer(slider["initial"], low, high)
        if low >= high or (high-low) % step or (initial-low) % step:
            raise Invalid("slider range alignment")
        shape = objects[target]
        if shape["type"] == "circle": w = h = shape["radius"] * 2
        elif shape["type"] == "rect": w, h = shape["width"], shape["height"]
        else: w, h, _ = assets[shape["asset"]]
        for point in (slider["from"], slider["to"]):
            fields(point, "x", "y")
            integer(point["x"], 0, width-w); integer(point["y"], 0, height-h)
        axis = slider["axis"]
        if axis not in ("x", "y") or slider["from"][axis] == slider["to"][axis] or slider["from"]["y" if axis == "x" else "x"] != slider["to"]["y" if axis == "x" else "x"]:
            raise Invalid("slider axis/path")
    return sliders


def validate(data):
    version, records = envelope(data)
    if version == (0, 1):
        return
    payloads = dict(records)
    if b"aTXT" in payloads:
        accessibility_payload(payloads[b"aTXT"])
    width, height = metadata(payloads[b"META"], version)
    capabilities = strict_json(payloads[b"META"], 4096)["required"]
    for enabled, kind in (("raster-png" in capabilities, b"ASST"),
                          ("toggle-fill" in capabilities, b"INTR"), ("state-actions" in capabilities, b"STAC"),
                          ("motion-linear" in capabilities, b"MOTN"), ("drag-value" in capabilities, b"DRAG")):
        if enabled != (kind in payloads):
            raise Invalid("capability and payload disagree")
    assets = asset_table(payloads[b"ASST"]) if b"ASST" in payloads else {}
    scene, targets = scene_payload(payloads[b"SCNE"], width, height, assets)
    if b"STAC" in payloads:
        states = states_payload(payloads[b"STAC"], targets)
        if b"MOTN" in payloads:
            motion_payload(payloads[b"MOTN"], scene, states, width, height, assets)
    elif b"INTR" in payloads:
        controls_payload(payloads[b"INTR"], targets)
    if b"DRAG" in payloads:
        interaction = strict_json(payloads.get(b"STAC", payloads.get(b"INTR", b'{"controls":[]}')), 32768)
        tracks = strict_json(payloads[b"MOTN"],32768)["tracks"] if b"MOTN" in payloads else []
        drag_payload(payloads[b"DRAG"], scene, width, height, assets, interaction["controls"], tracks)
    decode_png(payloads[b"PREV"], width, height)


def accessibility_payload(data):
    value = strict_json(data, 4096)
    fields(value, "description", "language")
    description, language = value["description"], value["language"]
    if (not isinstance(description,str) or not description.strip() or len(description.encode("utf-8"))>2048
            or any(ord(c)<32 or 127<=ord(c)<=159 for c in description)
            or not isinstance(language,str) or len(language)>35
            or not re.fullmatch(r"[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*",language)):
        raise Invalid("alternative description/language")
    return value


def trace_events(trace):
    payload = strict_json(trace, 64 * 1024)
    fields(payload, "version", "events")
    integer(payload["version"], 1, 1)
    events = payload["events"]
    if not isinstance(events, list) or len(events) > 1024:
        raise Invalid("invalid trace event list")
    for event in events:
        kind = event.get("type") if isinstance(event, dict) else None
        if kind in ("activate_pixel", "drag_start", "drag_move"):
            fields(event, "type", "x", "y")
            integer(event["x"], 0, 65535)
            integer(event["y"], 0, 65535)
        elif kind in ("focus_next", "focus_previous", "activate_focused", "reset", "drag_end", "drag_cancel"):
            fields(event, "type")
        elif kind == "set_slider":
            fields(event, "type", "index", "value")
            integer(event["index"], 0, 65535); integer(event["value"], 0, 65535)
        elif kind == "advance_time":
            fields(event, "type", "milliseconds")
            integer(event["milliseconds"], 0, 86400000)
        elif kind == "motion_preference":
            fields(event, "type", "reduced")
            if type(event["reduced"]) is not bool:
                raise Invalid("motion preference type")
        else:
            raise Invalid("invalid trace event type")
    return events


def replay_fixture(data, trace):
    """Evaluate normalized events for the valid conformance fixtures."""
    version, records = envelope(data)
    width, height = metadata(records[0][1], version)
    payloads = dict(records)
    scene = strict_json(payloads[b"SCNE"], 128 * 1024)
    assets = asset_table(payloads[b"ASST"]) if b"ASST" in payloads else {}
    interaction = strict_json(payloads.get(b"STAC", payloads.get(b"INTR", b'{"controls":[]}')), 32 * 1024)
    controls = interaction["controls"]
    machine = "states" in interaction
    definitions = {state["id"]: state for state in interaction.get("states", [])}
    states = {name: state["initial"] for name, state in definitions.items()}
    bindings = {binding["target"]: binding for binding in interaction.get("bindings", [])}
    events = trace_events(trace)
    tracks = strict_json(payloads[b"MOTN"], 32 * 1024)["tracks"] if b"MOTN" in payloads else []
    sliders = strict_json(payloads[b"DRAG"], 32768)["sliders"] if b"DRAG" in payloads else []
    values = [slider["initial"] for slider in sliders]
    capture = None
    clock = 0
    reduced = False
    for event in events:
        if event["type"] in ("drag_start", "drag_move", "drag_end", "drag_cancel", "set_slider") and not sliders:
            raise Invalid("drag event without capability")
        if event["type"] == "set_slider":
            index = integer(event["index"], 0, len(sliders)-1)
            slider = sliders[index]; value = integer(event["value"], slider["min"], slider["max"])
            if (value-slider["min"]) % slider["step"]: raise Invalid("unaligned slider value")
        if event["type"] == "reset":
            clock = 0
        if event["type"] in ("advance_time", "motion_preference") and not tracks:
            raise Invalid("motion event without capability")
        if event["type"] == "advance_time":
            if event["milliseconds"] < clock:
                raise Invalid("backward motion clock")
            clock = event["milliseconds"]
    clock = 0
    active = [states[track["state"]] == track["equals"] for track in tracks]
    origins = [0] * len(tracks)
    targets = {control["target"]: index for index, control in enumerate(controls)}
    pressed = [False] * len(controls)
    focus = None

    def style(target):
        binding = bindings.get(target)
        return binding["values"][states[binding["state"]]] if binding else {}

    def visible(target):
        return style(target).get("visible", True)

    def activate(index):
        nonlocal focus, capture
        if not visible(controls[index]["target"]):
            return
        if machine:
            for action in controls[index]["actions"]:
                name = action["state"]
                states[name] = action["value"] if action["type"] == "set" else (states[name] + 1) % (definitions[name]["max"] + 1)
            if focus is not None and not visible(controls[focus]["target"]):
                focus = None
            for i, track in enumerate(tracks):
                enabled = states[track["state"]] == track["equals"]
                if enabled and not active[i]:
                    origins[i] = clock
                active[i] = enabled
        else:
            pressed[index] = not pressed[index]
        if capture is not None and not visible(sliders[capture[0]]["target"]):
            values[capture[0]] = capture[1]; capture = None

    def traverse(step):
        origin = focus if focus is not None else (-1 if step == 1 else 0)
        return next((index for offset in range(1, len(controls) + 1)
                     if visible(controls[index := (origin + offset * step) % len(controls)]["target"])), None)

    def hit(shape, x, y):
        x += 0.5
        y += 0.5
        if shape["type"] == "rect":
            return (shape["x"] <= x < shape["x"] + shape["width"]
                    and shape["y"] <= y < shape["y"] + shape["height"])
        if shape["type"] == "circle":
            return (x - shape["cx"]) ** 2 + (y - shape["cy"]) ** 2 <= shape["radius"] ** 2
        if shape["type"] == "image":
            w, h, _ = assets[shape["asset"]]
            return shape["x"] <= x < shape["x"] + w and shape["y"] <= y < shape["y"] + h
        raise Invalid("unknown fixture shape")

    def placed(shape):
        for i, slider in enumerate(sliders):
            if slider["target"] != shape["id"]: continue
            point = {}
            for key in ("x", "y"):
                delta = (slider["to"][key] - slider["from"][key]) * (values[i] - slider["min"])
                point[key] = slider["from"][key] + (1 if delta >= 0 else -1) * (abs(delta) // (slider["max"] - slider["min"]))
            shape = dict(shape)
            if shape["type"] == "circle": shape["cx"], shape["cy"] = point["x"] + shape["radius"], point["y"] + shape["radius"]
            else: shape["x"], shape["y"] = point["x"], point["y"]
            return shape
        for i, track in enumerate(tracks):
            if track["target"] != shape["id"] or not active[i]:
                continue
            elapsed = clock - origins[i]
            if reduced or clock == 86400000 or elapsed >= track["duration_ms"] * track["repeat"]:
                point = track["to"]
            else:
                phase = elapsed % track["duration_ms"]
                point = {}
                for key in ("x", "y"):
                    delta = (track["to"][key] - track["from"][key]) * phase
                    point[key] = track["from"][key] + (1 if delta >= 0 else -1) * (abs(delta) // track["duration_ms"])
            shape = dict(shape)
            if shape["type"] == "circle":
                shape["cx"], shape["cy"] = point["x"] + shape["radius"], point["y"] + shape["radius"]
            else:
                shape["x"], shape["y"] = point["x"], point["y"]
            break
        return shape

    def top(x, y):
        return next((current for shape in reversed(scene["objects"])
                     if visible(shape["id"]) and hit(current := placed(shape), x, y)), None)

    for event in events:
        kind = event["type"]
        if kind == "drag_start":
            shape = top(event["x"], event["y"])
            if capture is None and shape is not None:
                for i, slider in enumerate(sliders):
                    if slider["target"] != shape["id"]: continue
                    axis = slider["axis"]
                    origin = shape["c"+axis] - shape["radius"] if shape["type"] == "circle" else shape[axis]
                    capture = (i, values[i], event[axis] - origin)
        elif kind == "drag_move":
            if capture is not None:
                i, _, offset = capture; slider = sliders[i]; axis = slider["axis"]
                delta = slider["to"][axis] - slider["from"][axis]; distance = abs(delta)
                along = max(0, min(distance, (event[axis] - offset - slider["from"][axis]) * (1 if delta > 0 else -1)))
                steps = (slider["max"]-slider["min"]) // slider["step"]
                values[i] = slider["min"] + ((along*steps + distance//2)//distance)*slider["step"]
        elif kind in ("drag_end", "drag_cancel"):
            if kind == "drag_cancel" and capture is not None: values[capture[0]] = capture[1]
            capture = None
        elif kind == "set_slider":
            if capture is not None: values[capture[0]] = capture[1]
            capture = None
            if visible(sliders[event["index"]]["target"]): values[event["index"]] = event["value"]
        elif kind == "activate_pixel":
            shape = top(event["x"], event["y"])
            if shape is not None and shape["id"] in targets:
                focus = targets[shape["id"]]
                activate(focus)
        elif kind == "focus_next":
            focus = traverse(1)
        elif kind == "focus_previous":
            focus = traverse(-1)
        elif kind == "activate_focused":
            if focus is not None:
                activate(focus)
        elif kind == "reset":
            focus = None
            capture = None
            values = [slider["initial"] for slider in sliders]
            pressed = [False] * len(controls)
            states = {name: state["initial"] for name, state in definitions.items()}
            clock = 0
            origins = [0] * len(tracks)
            active = [states[track["state"]] == track["equals"] for track in tracks]
        elif kind == "advance_time":
            clock = event["milliseconds"]
        elif kind == "motion_preference":
            reduced = event["reduced"]
        else:
            raise Invalid("unsupported trace event")

    pixels = bytearray()
    for y in range(height):
        for x in range(width):
            shape = top(x, y)
            if shape is None:
                pixels.extend(scene["background"])
            elif shape["type"] == "image":
                stride, _, rgb = assets[shape["asset"]]
                offset = ((y - shape["y"]) * stride + x - shape["x"]) * 3
                pixels.extend(rgb[offset:offset + 3])
            else:
                index = targets.get(shape["id"])
                pixels.extend(style(shape["id"]).get("fill") or (controls[index]["active_fill"]
                              if not machine and index is not None and pressed[index] else shape["fill"]))
    return f"P6\n{width} {height}\n255\n".encode() + pixels
