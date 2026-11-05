"""Compare bounded generated scenes and event traces with the Python evaluator."""

import argparse
import json
import os
from pathlib import Path
import random
import subprocess
import tempfile

from reference import read_preview, replay_fixture, validate


ROOT = Path(__file__).resolve().parents[2]
SEED = 0x49494D47
CASES = 40


def scene_source(rng, index):
    width, height = rng.randint(8, 64), rng.randint(8, 64)
    def rgb():
        return [rng.randrange(256) for _ in range(3)]
    objects = []
    for number in range(rng.randint(1, 16)):
        shape = {"id": f"shape-{number}", "fill": rgb()}
        if rng.choice((True, False)):
            x, y = rng.randrange(width), rng.randrange(height)
            shape.update(type="rect", x=x, y=y,
                         width=rng.randint(1, width - x), height=rng.randint(1, height - y))
        else:
            radius = rng.randint(1, min(width, height) // 2)
            shape.update(type="circle", radius=radius,
                         cx=rng.randint(radius, width - radius),
                         cy=rng.randint(radius, height - radius))
        objects.append(shape)
    selected = rng.sample(objects, rng.randint(0, min(len(objects), 8)))
    source = {"width": width, "height": height,
              "scene": {"background": rgb(), "objects": objects}}
    if selected:
        source["interaction"] = {"controls": [
            {"target": shape["id"], "label": f"مصباح {index}-{number}", "active_fill": rgb()}
            for number, shape in enumerate(selected)
        ]}
    return source


def trace(rng, width, height):
    events = []
    for _ in range(64):
        kind = rng.choice(("activate_pixel", "focus_next", "focus_previous",
                           "activate_focused", "reset"))
        event = {"type": kind}
        if kind == "activate_pixel":
            event.update(x=rng.randint(0, width + 4), y=rng.randint(0, height + 4))
        events.append(event)
    return {"version": 1, "events": events}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def run(cli):
    rng = random.Random(SEED)
    with tempfile.TemporaryDirectory(prefix="iimg-generated-") as temporary:
        scratch = Path(temporary)
        for index in range(CASES):
            source = scene_source(rng, index)
            # Keep one control even in the zero-selection cases, so the
            # independent replay target has an INTR payload to evaluate.
            source.setdefault("interaction", {"controls": [{
                "target": source["scene"]["objects"][0]["id"],
                "label": "مصباح", "active_fill": [255, 255, 255],
            }]})
            source_path = scratch / f"{index}.source.json"
            source_path.write_bytes(encoded(source))

            def invoke(*arguments):
                result = subprocess.run([str(cli), *map(str, arguments)], capture_output=True)
                if result.returncode:
                    raise AssertionError(f"case {index}, {arguments[0]}: {result.stderr!r}")

            files = []
            for command in ("compile", "compile-v1"):
                output = scratch / f"{index}-{command}.iimg"
                invoke(command, source_path, output)
                data = output.read_bytes()
                try:
                    validate(data)
                except ValueError as error:
                    raise AssertionError(f"case {index}, {command}: independent rejection") from error
                invoke("validate", output)
                _, width, height, preview = read_preview(data)
                initial = replay_fixture(data, b'{"version":1,"events":[]}')
                assert initial == f"P6\n{width} {height}\n255\n".encode() + preview, f"case {index}: initial pixels differ"
                files.append((output, data))

            migrated = scratch / f"{index}-migrated.iimg"
            invoke("upgrade-v1", files[0][0], migrated)
            assert migrated.read_bytes() == files[1][1], f"case {index}: migration differs"

            events = encoded(trace(rng, source["width"], source["height"]))
            trace_path = scratch / f"{index}.trace.json"
            trace_path.write_bytes(events)
            frames = []
            for version, (path, data) in enumerate(files):
                frame = scratch / f"{index}-{version}.ppm"
                invoke("replay", path, trace_path, frame)
                actual = frame.read_bytes()
                assert actual == replay_fixture(data, events), f"case {index}: replay differs"
                frames.append(actual)
            assert frames[0] == frames[1], f"case {index}: versioned behavior differs"
    print(f"Seed {SEED:#x}: {CASES} generated scenes, {2 * CASES} versioned replays and migrations matched Python.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    executable = "iimg-cli.exe" if os.name == "nt" else "iimg-cli"
    parser.add_argument("--cli", type=Path, default=ROOT / "target/debug" / executable)
    run(parser.parse_args().cli.resolve())
