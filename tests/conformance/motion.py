"""Finite-motion native/reference frame and rejection acceptance."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
from reference import Invalid, envelope, replay_fixture, validate
from check import record
ROOT = Path(__file__).resolve().parents[2]
def run(cli):
    fixture = ROOT / "tests/fixtures/motion"
    data = (fixture / "motion.iimg").read_bytes()
    validate(data)
    with tempfile.TemporaryDirectory(prefix="iimg-motion-") as temporary:
        scratch = Path(temporary)
        def invoke(*args): return subprocess.run([str(cli),*map(str,args)],capture_output=True,timeout=15)
        assert invoke("validate",fixture / "motion.iimg").returncode == 0
        manifest = json.loads((fixture / "manifest.json").read_text())
        for name in manifest["rgbSha256"]:
            trace = fixture / f"{name}.trace.json"
            output = scratch / f"{name}.ppm"
            assert invoke("replay",fixture / "motion.iimg",trace,output).returncode == 0
            assert output.read_bytes() == replay_fixture(data,trace.read_bytes()), name
        _, entries = envelope(data)
        original = json.loads(dict(entries)[b"MOTN"])
        mutations = []
        for field,value in [("duration_ms",0),("duration_ms",60001),("duration_ms",4294967295),
                            ("repeat",0),("repeat",17),("state","missing"),("target","missing"),("equals",2)]:
            payload = json.loads(json.dumps(original)); payload["tracks"][0][field]=value; mutations.append(payload)
        payload=json.loads(json.dumps(original));payload["tracks"][1]["target"]="orb";mutations.append(payload)
        payload=json.loads(json.dumps(original));payload["tracks"][0]["to"]["x"]=81;mutations.append(payload)
        payload=json.loads(json.dumps(original));payload["tracks"][0].update(duration_ms=60000,repeat=11);mutations.append(payload)
        for index,payload in enumerate(mutations):
            changed=data[:12]+b"".join(record(kind,json.dumps(payload).encode() if kind==b"MOTN" else body) for kind,body in entries)
            path=scratch/f"bad-{index}.iimg";path.write_bytes(changed)
            try: validate(changed)
            except Invalid: pass
            else: raise AssertionError(f"Python accepted motion mutation {index}")
            assert invoke("validate",path).returncode != 0, index
        for index,events in enumerate([
            [{"type":"advance_time","milliseconds":100},{"type":"advance_time","milliseconds":99}],
            [{"type":"advance_time","milliseconds":86400001}],
            [{"type":"motion_preference","reduced":1}]
        ]):
            raw=json.dumps({"version":1,"events":events}).encode();trace=scratch/f"bad-trace-{index}.json";trace.write_bytes(raw)
            try: replay_fixture(data,raw)
            except Invalid: pass
            else: raise AssertionError(f"Python accepted motion trace {index}")
            assert invoke("replay",fixture/"motion.iimg",trace,scratch/f"bad-frame-{index}.ppm").returncode != 0
    print(f"Motion: {len(manifest['rgbSha256'])} independent/native frames, {len(mutations)} semantic rejections and three invalid time/preference traces matched.")
if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli",type=Path,default=ROOT/"target/debug"/("iimg-cli.exe" if os.name=="nt" else "iimg-cli"))
    run(parser.parse_args().cli.resolve())
