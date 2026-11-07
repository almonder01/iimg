"""Compare draft state actions against the independent Python evaluator."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from reference import Invalid, envelope, replay_fixture, validate
from check import record

ROOT = Path(__file__).resolve().parents[2]

def run(cli):
    fixture = ROOT / "tests/fixtures/state-actions"
    original = (fixture / "panel.iimg").read_bytes()
    manifest = json.loads((fixture / "manifest.json").read_text())
    assert len(original) == manifest["bytes"] and hashlib.sha256(original).hexdigest() == manifest["sha256"]
    with tempfile.TemporaryDirectory(prefix="iimg-states-") as temporary:
        scratch = Path(temporary)
        def invoke(*args):
            return subprocess.run([str(cli), *map(str, args)], capture_output=True, timeout=15)
        assert invoke("validate", fixture / "panel.iimg").returncode == 0
        for name in ("initial", "pointer", "keyboard", "reset"):
            trace = fixture / f"{name}.trace.json"
            result = scratch / (name + ".ppm")
            expected = replay_fixture(original, trace.read_bytes())
            assert invoke("replay", fixture / "panel.iimg", trace, result).returncode == 0
            assert result.read_bytes() == expected, name
        _, entries = envelope(original)
        payload = json.loads(dict(entries)[b"STAC"])
        mutations = []
        def case(change):
            value = json.loads(json.dumps(payload)); change(value); mutations.append(value)
        case(lambda p: p["states"][0].update(max=0))
        case(lambda p: p["states"][0].update(max=16))
        case(lambda p: p["states"][0].update(initial=2))
        case(lambda p: p["states"][1].update(id="panel"))
        case(lambda p: p.update(states=p["states"] * 12))
        case(lambda p: p["controls"][0].update(target="missing"))
        case(lambda p: p["controls"][1].update(target="cover"))
        case(lambda p: p["controls"][0].update(label="\n"))
        case(lambda p: p["controls"][0].update(label="💡" * 65))
        case(lambda p: p["controls"][0].update(actions=[]))
        case(lambda p: p["controls"][0]["actions"][0].update(value=2))
        case(lambda p: p["controls"][0]["actions"][0].update(state="missing"))
        case(lambda p: p["controls"][1].update(actions=[{"type":"cycle","state":"tone"}] * 2))
        case(lambda p: p["controls"][0].update(actions=[{"type":"cycle","state":"panel"}] * 9))
        case(lambda p: p["bindings"][0].update(target="missing"))
        case(lambda p: p["bindings"][1].update(target="cover"))
        case(lambda p: p["bindings"][0].update(values=[{"visible":True}]))
        case(lambda p: p["bindings"][0]["values"][0].update(visible=1))
        case(lambda p: p["bindings"][0]["values"][0].update(fill=[0,256,0]))
        case(lambda p: p["bindings"][0]["values"][0].update(extra=True))
        for index, value in enumerate(mutations):
            data = original[:12] + b"".join(record(kind, json.dumps(value).encode() if kind == b"STAC" else body) for kind, body in entries)
            path = scratch / f"invalid-{index}.iimg"; path.write_bytes(data)
            try: validate(data)
            except Invalid: pass
            else: raise AssertionError(f"Python accepted state mutation {index}")
            assert invoke("validate", path).returncode != 0, f"Rust accepted state mutation {index}"
    print(f"State actions: four native/reference replay frames and {len(mutations)} semantic rejection cases matched.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, default=ROOT / "target/debug" / ("iimg-cli.exe" if os.name == "nt" else "iimg-cli"))
    run(parser.parse_args().cli.resolve())
