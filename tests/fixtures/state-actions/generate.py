"""Independently encode the draft state-actions fixture and expected frames."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import zlib

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tests/conformance"))
from reference import IIMG_MAGIC, PNG_MAGIC, replay_fixture, scene_payload, states_payload, motion_payload, validate

def record(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()

def generate(directory, source_name="state-panel", file_name="panel.iimg", custom_traces=None):
    directory.mkdir(parents=True, exist_ok=True)
    source = json.loads((ROOT / f"examples/{source_name}.source.json").read_text(encoding="utf-8"))
    meta = dict(profile="iimg-core-1", width=source["width"], height=source["height"], required=["state-actions"] if "interaction" in source else [])
    if "motion" in source:
        meta["required"].append("motion-linear")
    if "drag" in source: meta["required"].append("drag-value")
    def envelope(preview):
        entries = [
            (b"META", compact(meta)), (b"PREV", preview), (b"SCNE", compact(source["scene"]))]
        if "interaction" in source: entries.append((b"STAC", compact(source["interaction"])))
        if "motion" in source:
            entries.append((b"MOTN", compact(source["motion"])))
        if "drag" in source: entries.append((b"DRAG", compact(source["drag"])))
        entries.append((b"IEND", b""))
        return IIMG_MAGIC + b"\x01\0\0\0" + b"".join(record(kind, data) for kind, data in entries)
    _, targets = scene_payload(compact(source["scene"]), source["width"], source["height"], {})
    if "interaction" in source: states_payload(compact(source["interaction"]), targets)
    if "motion" in source:
        motion_payload(compact(source["motion"]), source["scene"], source["interaction"], source["width"], source["height"], {})
    initial_trace = {"version":1,"events":[]}
    initial = replay_fixture(envelope(b""), compact(initial_trace))
    header = f"P6\n{source['width']} {source['height']}\n255\n".encode()
    rgb = initial[len(header):]
    stride = source["width"] * 3
    scanlines = b"".join(b"\0" + rgb[y * stride:(y + 1) * stride] for y in range(source["height"]))
    png = PNG_MAGIC + record(b"IHDR", struct.pack(">IIBBBBB", source["width"], source["height"], 8, 2, 0, 0, 0))
    # A single stored DEFLATE block keeps fixture bytes independent of the
    # host zlib compressor/version. This tiny canvas fits the 65535-byte block.
    assert len(scanlines) <= 65535
    stream = b"\x78\x01\x01" + struct.pack("<HH", len(scanlines), len(scanlines) ^ 65535) + scanlines
    stream += struct.pack(">I", zlib.adler32(scanlines))
    png += record(b"IDAT", stream) + record(b"IEND", b"")
    data = envelope(png)
    validate(data)
    traces = {
        "initial": initial_trace,
        "pointer": {"version":1,"events":[{"type":"activate_pixel","x":x,"y":y} for x,y in [(2,2),(22,2),(2,2),(42,2)]]},
        "keyboard": {"version":1,"events":[{"type":kind} for kind in ["focus_next","activate_focused"] * 4]},
        "reset": {"version":1,"events":[{"type":"activate_pixel","x":22,"y":2},{"type":"reset"}]},
    }
    if custom_traces is not None:
        traces = custom_traces
    frames = {}
    for name, trace in traces.items():
        (directory / f"{name}.trace.json").write_bytes(compact(trace) + b"\n")
        frames[name] = hashlib.sha256(replay_fixture(data, compact(trace))[len(header):]).hexdigest()
    if "pointer" in frames:
        assert frames["pointer"] == frames["keyboard"]
    assert frames["initial"] == frames["reset"]
    (directory / file_name).write_bytes(data)
    manifest = {"license":"Apache-2.0", "wire":"1.0", "file":file_name,"capability":meta["required"][-1], "bytes":len(data),
                "sha256":hashlib.sha256(data).hexdigest(), "rgbSha256":frames,
                "provenance":"Independent Python envelope/PNG encoder and state evaluator; original project-authored example."}
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")

if __name__ == "__main__":
    generate(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent)
