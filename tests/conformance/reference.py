"""Independent draft IIMG envelope and RGB8 preview reader."""

import json
import re
import struct
import zlib

IIMG_MAGIC = b"IIMG\r\n\x1a\n"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
CORE = {b"META", b"PREV", b"SCNE", b"ASST", b"INTR", b"IEND"}
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
        known = [kind for kind in kinds if kind in CORE]
        expected = [b"META", b"PREV", b"SCNE"]
        expected.extend(kind for kind in (b"ASST", b"INTR") if kind in known)
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
        if set(required) - {"raster-png", "toggle-fill"} or len(set(required)) != len(required):
            raise Invalid("unsupported or duplicate capability")
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


def validate(data):
    version, records = envelope(data)
    if version == (0, 1):
        return
    payloads = dict(records)
    width, height = metadata(payloads[b"META"], version)
    capabilities = strict_json(payloads[b"META"], 4096)["required"]
    for name, kind in (("raster-png", b"ASST"), ("toggle-fill", b"INTR")):
        if (name in capabilities) != (kind in payloads):
            raise Invalid("capability and payload disagree")
    assets = asset_table(payloads[b"ASST"]) if b"ASST" in payloads else {}
    _, targets = scene_payload(payloads[b"SCNE"], width, height, assets)
    if b"INTR" in payloads:
        controls_payload(payloads[b"INTR"], targets)
    decode_png(payloads[b"PREV"], width, height)


def trace_events(trace):
    payload = strict_json(trace, 64 * 1024)
    fields(payload, "version", "events")
    integer(payload["version"], 1, 1)
    events = payload["events"]
    if not isinstance(events, list) or len(events) > 1024:
        raise Invalid("invalid trace event list")
    for event in events:
        kind = event.get("type") if isinstance(event, dict) else None
        if kind == "activate_pixel":
            fields(event, "type", "x", "y")
            integer(event["x"], 0, 65535)
            integer(event["y"], 0, 65535)
        elif kind in ("focus_next", "focus_previous", "activate_focused", "reset"):
            fields(event, "type")
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
    controls = strict_json(payloads[b"INTR"], 32 * 1024)["controls"]
    events = trace_events(trace)
    targets = {control["target"]: index for index, control in enumerate(controls)}
    pressed = [False] * len(controls)
    focus = None

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

    def top(x, y):
        return next((shape for shape in reversed(scene["objects"]) if hit(shape, x, y)), None)

    for event in events:
        kind = event["type"]
        if kind == "activate_pixel":
            shape = top(event["x"], event["y"])
            if shape is not None and shape["id"] in targets:
                focus = targets[shape["id"]]
                pressed[focus] = not pressed[focus]
        elif kind == "focus_next":
            focus = 0 if focus is None else (focus + 1) % len(controls)
        elif kind == "focus_previous":
            focus = len(controls) - 1 if focus is None else (focus - 1) % len(controls)
        elif kind == "activate_focused":
            if focus is not None:
                pressed[focus] = not pressed[focus]
        elif kind == "reset":
            focus = None
            pressed = [False] * len(controls)
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
                pixels.extend(controls[index]["active_fill"]
                              if index is not None and pressed[index] else shape["fill"])
    return f"P6\n{width} {height}\n255\n".encode() + pixels
