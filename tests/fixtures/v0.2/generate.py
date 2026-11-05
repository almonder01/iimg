"""Generate the visual test fixture independently of the Rust encoder."""

import json
import argparse
import struct
import zlib
from pathlib import Path


def chunk(kind, payload):
    body = kind + payload
    return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))


def json_bytes(value):
    return json.dumps(value, separators=(",", ":")).encode()


def rgb_png(width, height, scanlines):
    return b"\x89PNG\r\n\x1a\n" + b"".join((
        chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)),
        chunk(b"IDAT", zlib.compress(scanlines)),
        chunk(b"IEND", b""),
    ))


def fixture(raster=False, interactive=False, multi=False, candidate=False):
    side = 32
    background = (26, 32, 44)
    fill = (250, 204, 21)
    radius = 8
    center = side // 2
    tile = (80, 175, 240)
    switch = (64, 96, 128)
    scanlines = bytearray()
    for y in range(side):
        scanlines.append(0)
        for x in range(side):
            inside = (2 * x + 1 - 2 * center) ** 2 + (2 * y + 1 - 2 * center) ** 2 <= (2 * radius) ** 2
            behind = tile if raster and 6 <= x < 10 and 15 <= y < 17 else background
            if multi and x < 5 and y < 5:
                behind = switch
            scanlines.extend(fill if inside else behind)
    png = rgb_png(side, side, scanlines)
    meta = {"profile": "iimg-core-1" if candidate else "iimg-visual-0.2",
            "width": side, "height": side, "required": []}
    scene = {"background": background, "objects": [
        {"type": "circle", "id": "lamp", "cx": center, "cy": center, "radius": radius, "fill": fill}
    ]}
    assets = b""
    interaction = b""
    if raster:
        meta["required"] = ["raster-png"]
        scene["objects"].insert(0, {"type": "image", "id": "plate", "asset": "tile", "x": 6, "y": 15})
        tile_png = rgb_png(4, 2, (b"\0" + bytes(tile) * 4) * 2)
        entry = b"\x04tile" + struct.pack(">I", len(tile_png)) + tile_png
        assets = chunk(b"ASST", b"\x00\x01" + entry)
    if interactive:
        meta["required"].append("toggle-fill")
        controls = [
            {"target": "lamp", "label": "Lamp", "active_fill": [248, 113, 113]}
        ]
        if multi:
            scene["objects"].append({
                "type": "rect", "id": "switch", "x": 0, "y": 0,
                "width": 5, "height": 5, "fill": switch,
            })
            controls.append({"target": "switch", "label": "Switch", "active_fill": [88, 210, 130]})
        interaction = chunk(b"INTR", json_bytes({"controls": controls}))
    version = b"\x01\x00" if candidate else b"\x00\x02"
    return b"IIMG\r\n\x1a\n" + version + b"\x00\x00" + b"".join((
        chunk(b"META", json_bytes(meta)),
        chunk(b"PREV", png),
        chunk(b"SCNE", json_bytes(scene)),
        assets,
        interaction,
        chunk(b"IEND", b""),
    ))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-render", type=Path, metavar="LAMP.PPM")
    parser.add_argument("--candidate", type=Path, metavar="NEW.IIMG")
    args = parser.parse_args()
    path = Path(__file__).with_name("lamp.iimg")
    if args.candidate:
        args.candidate.write_bytes(fixture(raster=True, interactive=True, candidate=True))
    elif args.check_render is None:
        path.write_bytes(fixture())
        path.with_name("raster-lamp.iimg").write_bytes(fixture(raster=True))
        path.with_name("interactive-lamp.iimg").write_bytes(fixture(interactive=True))
        path.with_name("two-controls.iimg").write_bytes(fixture(interactive=True, multi=True))
    else:
        # Decode the known RGB/filter-0 fixture using the standard library.
        envelope = path.read_bytes()
        meta_len = struct.unpack_from(">I", envelope, 12)[0]
        preview_start = 12 + 12 + meta_len + 8
        idat_start = preview_start + 8 + 25
        idat_len, kind = struct.unpack_from(">I4s", envelope, idat_start)
        if kind != b"IDAT":
            raise SystemExit("expected fixture IDAT")
        side = 32
        stride = 1 + side * 3
        compressed = envelope[idat_start + 8:idat_start + 8 + idat_len]
        inflater = zlib.decompressobj()
        rows = inflater.decompress(compressed, side * stride + 1)
        if (len(rows) != side * stride or not inflater.eof or inflater.unused_data
                or any(rows[::stride])):
            raise SystemExit("unexpected fixture scanlines")
        pixels = b"".join(rows[row + 1:row + stride] for row in range(0, len(rows), stride))
        if args.check_render.read_bytes() != b"P6\n32 32\n255\n" + pixels:
            raise SystemExit("render differs from the fixture's decoded preview")
        print("render matches all 1024 independently decoded preview pixels")
