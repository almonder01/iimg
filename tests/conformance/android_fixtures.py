"""Generate Android picker cases and independently evaluated reference frames."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

from check import replace
from reference import envelope, replay_fixture


ROOT = Path(__file__).resolve().parents[2]


def generate(cli, output):
    output = output.resolve()
    if output.exists():
        raise FileExistsError(f"fixture output must be new: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    source = ROOT / "tests/fixtures/v0.2/two-controls.iimg"
    with tempfile.TemporaryDirectory(prefix="iimg-android-", dir=output.parent) as temporary:
        staging = Path(temporary) / "fixtures"
        staging.mkdir()
        subprocess.run([str(cli.resolve()), "upgrade-v1", str(source),
                        str(staging / "candidate.iimg")], check=True)
        candidate = (staging / "candidate.iimg").read_bytes()
        metadata = json.loads(dict(envelope(candidate)[1])[b"META"])
        metadata["required"].append("future-fill")
        files = {
            "candidate.iimg": candidate,
            "unsupported.iimg": replace(candidate, b"META", json.dumps(metadata).encode()),
            "corrupt.iimg": candidate[:-1] + bytes([candidate[-1] ^ 1]),
            "initial.ppm": replay_fixture(candidate, b'{"version":1,"events":[]}'),
            "active.ppm": replay_fixture(candidate, (source.parent / "two-controls-pointer.json").read_bytes()),
        }
        for name, data in files.items():
            (staging / name).write_bytes(data)
        manifest = {
            "source": "tests/fixtures/v0.2/two-controls.iimg",
            "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "license_status": "See the source fixture manifest; distribution terms require maintainer confirmation",
            "expected_modes": {"candidate.iimg": "initial", "unsupported.iimg": "preview", "corrupt.iimg": "invalid"},
            "sha256": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()},
        }
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        staging.rename(output)
    print(f"Android fixtures and independent frames written to {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    executable = "iimg-cli.exe" if os.name == "nt" else "iimg-cli"
    parser.add_argument("--cli", type=Path, default=ROOT / "target/debug" / executable)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    generate(args.cli, args.output)
