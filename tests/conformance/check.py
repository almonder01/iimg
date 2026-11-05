"""Compare the independent envelope/preview reader with the Rust CLI."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import zlib

from reference import Invalid, envelope, read_preview, replay_fixture, trace_events, validate


ROOT = Path(__file__).resolve().parents[2]


def record(kind, payload):
    body = kind + payload
    return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))


def with_records(data, records):
    return data[:12] + b"".join(record(kind, payload) for kind, payload in records)


def replace(data, tag, payload):
    _, records = envelope(data)
    return with_records(data, [(kind, payload if kind == tag else old) for kind, old in records])


def candidate_envelope(data):
    """Rewrite the envelope independently so invalid semantic cases can target 1.0."""
    version, records = envelope(data)
    if version != (0, 2):
        raise AssertionError("candidate test transform requires draft 0.2 input")
    meta = records[0][1].replace(b'"iimg-visual-0.2"', b'"iimg-core-1"')
    return with_records(data[:8] + b"\x01\0\0\0", [(b"META", meta), *records[1:]])


def decision(reader, data):
    try:
        reader(data)
    except Invalid:
        return False
    return True


def run(cli):
    count = 0
    with tempfile.TemporaryDirectory(prefix="iimg-conformance-") as temporary:
        scratch = Path(temporary)

        def invoke(*args):
            return subprocess.run([str(cli), *map(str, args)], capture_output=True, timeout=15)

        def compare(name, data, can_inspect, can_preview):
            nonlocal count
            source = scratch / f"{name}.iimg"
            output = scratch / f"{name}.png"
            source.write_bytes(data)
            inspect = invoke("inspect", source)
            extract = invoke("extract-preview", source, output)
            if not (decision(envelope, data) == (inspect.returncode == 0) == can_inspect):
                raise AssertionError(f"{name}: inspect disagreed: {inspect.stderr!r}")
            if not (decision(read_preview, data) == (extract.returncode == 0) == can_preview):
                raise AssertionError(f"{name}: preview disagreed: {extract.stderr!r}")
            if can_preview:
                png, _, _, _ = read_preview(data)
                if output.read_bytes() != png:
                    raise AssertionError(f"{name}: preview bytes differ")
            count += 1

        def compare_validation(name, data, valid, diagnostic=None):
            source = scratch / f"validate-{name}.iimg"
            source.write_bytes(data)
            result = invoke("validate", source)
            if not (decision(validate, data) == (result.returncode == 0) == valid):
                raise AssertionError(f"{name}: semantic decision disagreed: {result.stderr!r}")
            if diagnostic and diagnostic.encode() not in result.stderr:
                raise AssertionError(f"{name}: unexpected diagnostic: {result.stderr!r}")

        for version in ("0.1", "0.2", "1.0"):
            directory = ROOT / "tests" / "fixtures" / f"v{version}"
            manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
            for fixture in manifest["fixtures"]:
                source = directory / fixture["path"]
                data = source.read_bytes()
                name = fixture["id"]
                if len(data) != fixture["bytes"] or hashlib.sha256(data).hexdigest() != fixture["sha256"]:
                    raise AssertionError(f"{name}: manifest mismatch")
                compare(name, data, True, version != "0.1")
                compare_validation(name, data, True)
                if version != "0.1":
                    _, width, height, pixels = read_preview(data)
                    output = scratch / f"{name}.ppm"
                    rendered = invoke("render", source, output)
                    if rendered.returncode or output.read_bytes() != f"P6\n{width} {height}\n255\n".encode() + pixels:
                        raise AssertionError(f"{name}: rendered frame differs from independent PNG decode")

        lamp = (ROOT / "tests/fixtures/v0.2/lamp.iimg").read_bytes()
        _, records = envelope(lamp)
        compare("truncated", lamp[:-1], False, False)
        compare("trailing", lamp + b"\0", False, False)
        compare("wrong-version", lamp[:9] + b"\xff" + lamp[10:], False, False)
        compare("duplicate-preview", with_records(lamp, records[:2] + records[1:]), False, False)
        compare("late-crc", lamp[:-1] + bytes([lamp[-1] ^ 1]), False, False)
        compare("unknown-critical", with_records(lamp, records[:2] + [(b"FUTR", b"opaque")] + records[2:]), False, True)
        compare("unknown-ancillary", with_records(lamp, records[:2] + [(b"fUTR", b"opaque")] + records[2:]), True, True)

        kind, png = records[1]
        malformed = png[:-1] + bytes([png[-1] ^ 1])
        compare("inner-crc", with_records(lamp, [records[0], (kind, malformed), *records[2:]]), True, False)
        directory = ROOT / "tests/fixtures/v0.2"
        raster = (directory / "raster-lamp.iimg").read_bytes()
        _, raster_records = envelope(raster)
        assets = dict(raster_records)[b"ASST"]
        interactive = (directory / "interactive-lamp.iimg").read_bytes()
        _, interactive_records = envelope(interactive)
        controls = dict(interactive_records)[b"INTR"]
        scene = dict(raster_records)[b"SCNE"]
        scene_value = json.loads(scene)
        array_shape_scene = dict(scene_value, objects=[
            list(scene_value["objects"][0].values()), *scene_value["objects"][1:]])
        control_values = json.loads(controls)["controls"]
        invalid_documents = [
            ("array-scene", replace(raster, b"SCNE", json.dumps(list(scene_value.values())).encode()), "InvalidJson"),
            ("array-shape", replace(raster, b"SCNE", json.dumps(array_shape_scene).encode()), "InvalidJson"),
            ("array-interaction", replace(interactive, b"INTR", json.dumps([control_values]).encode()), "InvalidJson"),
            ("array-control", replace(interactive, b"INTR", json.dumps({"controls": [
                list(control_values[0].values())]}).encode()), "InvalidJson"),
            ("duplicate-field", replace(lamp, b"SCNE", b'{"background":[0,0,0],"background":[1,1,1],"objects":[]}'), "InvalidJson"),
            ("boolean-coordinate", replace(raster, b"SCNE", scene.replace(b'"x":6', b'"x":true')), "InvalidJson"),
            ("negative-zero-coordinate", replace(raster, b"SCNE", scene.replace(b'"x":6', b'"x":-0')), "InvalidJson"),
            ("decimal-coordinate", replace(raster, b"SCNE", scene.replace(b'"x":6', b'"x":6.0')), "InvalidJson"),
            ("exponent-coordinate", replace(raster, b"SCNE", scene.replace(b'"x":6', b'"x":6e0')), "InvalidJson"),
            ("off-canvas", replace(raster, b"SCNE", scene.replace(b'"x":6', b'"x":32')), "InvalidGeometry"),
            ("missing-asset", replace(raster, b"SCNE", scene.replace(b'"asset":"tile"', b'"asset":"missing"')), "MissingAsset"),
            ("extra-asset-byte", replace(raster, b"ASST", assets + b"\0"), "InvalidAssetTable"),
            ("truncated-asset", replace(raster, b"ASST", assets[:-1]), "InvalidAssetTable"),
            ("asset-crc", replace(raster, b"ASST", assets[:-1] + bytes([assets[-1] ^ 1])), "InvalidAssetImage"),
            ("missing-target", replace(interactive, b"INTR", controls.replace(b'"target":"lamp"', b'"target":"other"')), "InvalidInteraction"),
            ("invalid-label", replace(interactive, b"INTR", controls.replace(b'"label":"Lamp"', b'"label":" "')), "InvalidInteraction"),
            ("missing-interaction", with_records(interactive, [(tag, body) for tag, body in interactive_records if tag != b"INTR"]), "InvalidCapabilities"),
            ("duplicate-capability", replace(interactive, b"META", dict(interactive_records)[b"META"].replace(b'"toggle-fill"', b'"toggle-fill","toggle-fill"')), "InvalidCapabilities"),
            ("unadvertised-interaction", replace(interactive, b"META", dict(interactive_records)[b"META"].replace(b'["toggle-fill"]', b'[]')), "InvalidCapabilities"),
            ("future-and-missing-declaration", replace(interactive, b"META", dict(interactive_records)[b"META"].replace(b'"toggle-fill"', b'"future-fill"')), "InvalidCapabilities"),
            ("future-capability", replace(interactive, b"META", dict(interactive_records)[b"META"].replace(b'"toggle-fill"', b'"toggle-fill","future-fill"')), "UnsupportedProfile"),
        ]
        for name, data, diagnostic in invalid_documents:
            for variant, binary in (("draft", data), ("candidate", candidate_envelope(data))):
                case = f"{variant}-{name}"
                compare_validation(case, binary, False, diagnostic)
                compare(case, binary, True, True)

        invalid_metadata = [
            ("array-metadata", json.dumps(list(json.loads(records[0][1]).values())).encode()),
            ("unpaired-surrogate", records[0][1].replace(b'[]', br'["\ud800"]')),
        ]
        for name, payload in invalid_metadata:
            data = replace(lamp, b"META", payload)
            for variant, binary in (("draft", data), ("candidate", candidate_envelope(data))):
                compare_validation(f"{variant}-{name}", binary, False, "InvalidJson")
                compare(f"{variant}-{name}", binary, True, False)

        unicode_controls = json.loads(controls)
        unicode_controls["controls"][0]["label"] = "مصباح 💡"
        unicode_document = replace(interactive, b"INTR", json.dumps(unicode_controls).encode())
        for variant, binary in (("draft", unicode_document),
                                ("candidate", candidate_envelope(unicode_document))):
            compare_validation(f"{variant}-unicode-label", binary, True)
            compare(f"{variant}-unicode-label", binary, True, True)

        source = directory / "two-controls.iimg"
        authored = scratch / "direct-authoring.iimg"
        authored_result = invoke("compile-v1", ROOT / "examples/raster-lamp.source.json", authored)
        if authored_result.returncode:
            raise AssertionError(f"1.0 authoring failed: {authored_result.stderr!r}")
        authored_data = authored.read_bytes()
        if envelope(authored_data)[0] != (1, 0):
            raise AssertionError("direct authoring wrote the wrong wire version")
        compare_validation("direct-authoring", authored_data, True)
        compare("direct-authoring", authored_data, True, True)
        upgraded = scratch / "upgraded.iimg"
        result = invoke("upgrade-v1", source, upgraded)
        if result.returncode:
            raise AssertionError(f"upgrade failed: {result.stderr!r}")
        original_data, upgraded_data = source.read_bytes(), upgraded.read_bytes()
        original_version, original_records = envelope(original_data)
        upgraded_version, upgraded_records = envelope(upgraded_data)
        if original_version != (0, 2) or upgraded_version != (1, 0) or original_records[1:] != upgraded_records[1:]:
            raise AssertionError("upgrade changed scene, preview or interaction payloads")
        compare_validation("upgraded", upgraded_data, True)
        optional = scratch / "with-ancillary.iimg"
        optional.write_bytes(with_records(original_data, [*original_records[:2],
                                 (b"fUTR", b"version-sensitive payload"), *original_records[2:]]))
        stripped = scratch / "upgraded-without-ancillary.iimg"
        result = invoke("upgrade-v1", optional, stripped)
        if result.returncode or stripped.read_bytes() != upgraded_data:
            raise AssertionError("upgrade did not discard the unknown ancillary chunk")
        for name, unsupported in (("historical", ROOT / "examples/hello.iimg"),
                                  ("already-candidate", upgraded)):
            refused = scratch / f"refused-{name}.iimg"
            result = invoke("upgrade-v1", unsupported, refused)
            if result.returncode == 0 or b"UnsupportedVersion" not in result.stderr or refused.exists():
                raise AssertionError(f"{name}: invalid migration accepted")
        for mode in ("pointer", "keyboard"):
            trace = directory / f"two-controls-{mode}.json"
            output = scratch / f"replay-{mode}.ppm"
            expected = replay_fixture(source.read_bytes(), trace.read_bytes())
            rendered = invoke("replay", source, trace, output)
            if rendered.returncode or output.read_bytes() != expected:
                raise AssertionError(f"{mode}: replay frame differs from independent evaluator")
            upgraded_frame = scratch / f"upgraded-{mode}.ppm"
            rendered = invoke("replay", upgraded, trace, upgraded_frame)
            if rendered.returncode or upgraded_frame.read_bytes() != expected:
                raise AssertionError(f"{mode}: upgraded replay frame changed")
        candidate = ROOT / "tests/fixtures/v1.0/raster-toggle.iimg"
        candidate_data = candidate.read_bytes()
        _, candidate_records = envelope(candidate_data)
        compare("candidate-reserved-flag", candidate_data[:10] + b"\x01" + candidate_data[11:], False, False)
        compare("candidate-unknown-minor", candidate_data[:9] + b"\x01" + candidate_data[10:], False, False)
        compare("candidate-critical-after-preview", with_records(candidate_data, [
            *candidate_records[:2], (b"FUTR", b"extension"), *candidate_records[2:]]), False, True)
        compare("candidate-ancillary-before-preview", with_records(candidate_data, [
            candidate_records[0], (b"fUTR", b"extension"), *candidate_records[1:]]), False, False)
        wrong_profile = replace(candidate_data, b"META", candidate_records[0][1].replace(
            b'"iimg-core-1"', b'"iimg-visual-0.2"'))
        compare("candidate-draft-profile", wrong_profile, True, False)
        compare_validation("candidate-draft-profile", wrong_profile, False, "UnsupportedProfile")
        trace = scratch / "candidate-pointer.json"
        trace.write_bytes(b'{"version":1,"events":[{"type":"activate_pixel","x":16,"y":16}]}')
        output = scratch / "candidate-active.ppm"
        rendered = invoke("replay", candidate, trace, output)
        if rendered.returncode or output.read_bytes() != replay_fixture(candidate_data, trace.read_bytes()):
            raise AssertionError("candidate raster replay differs from independent evaluator")
        invalid_traces = [
            b'[1,[{"type":"reset"}]]',
            b'{"version":1,"events":[["activate_pixel",16,16]]}',
            b'{"version":1,"events":[["reset"]]}',
            b'{"version":1,"events":[{"type":"activate_pixel","x":-0,"y":0}]}',
            b'{"version":2,"events":[]}',
            b'{"version":1,"events":[{"type":"reset","extra":true}]}',
            b'{"version":1,"events":[{"type":"activate_pixel","x":65536,"y":0}]}',
            b'{"version":1,"events":[{"type":"focus_next","type":"reset"}]}',
        ]
        for index, data in enumerate(invalid_traces):
            trace = scratch / f"invalid-trace-{index}.json"
            output = scratch / f"invalid-trace-{index}.ppm"
            trace.write_bytes(data)
            result = invoke("replay", source, trace, output)
            if decision(trace_events, data) or result.returncode == 0 or output.exists():
                raise AssertionError(f"trace {index}: invalid input accepted")
    print(f"{count} envelope and preview cases matched the Rust CLI.")
    print(f"{2 * (len(invalid_documents) + len(invalid_metadata)) + 1} semantic rejections and {len(invalid_traces)} invalid traces matched.")
    print("Migration preserved known payloads and dropped unknown ancillary data.")
    print("Three interaction traces matched the independent evaluator, including the mixed-raster candidate.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    executable = "iimg-cli.exe" if os.name == "nt" else "iimg-cli"
    parser.add_argument("--cli", type=Path, default=ROOT / "target" / "debug" / executable)
    run(parser.parse_args().cli.resolve())
