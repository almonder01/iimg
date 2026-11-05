"""Verify an IIMG review package before uploading or distributing it."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
LICENSE_FILES = ("LICENSES.md", "LICENSE-MIT", "LICENSE-APACHE", "LICENSE-CC-BY-4.0")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def extract(path, destination):
    with ZipFile(path) as archive:
        names = set()
        for member in archive.infolist():
            name = member.filename
            posix = PurePosixPath(name)
            if (posix.is_absolute() or ".." in posix.parts or "\\" in name or ":" in name
                    or not posix.parts or name in names or member.is_dir()):
                raise ValueError(f"unexpected archive entry {name!r}")
            names.add(name)
            target = destination.joinpath(*posix.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as output:
                output.write(archive.read(member))
            if member.external_attr >> 16 & 0o111:
                target.chmod(0o755)


def verify_notices(directory, bom):
    inventory = json.loads((directory / "licenses/cargo/manifest.json").read_text(encoding="utf-8"))
    expected = {(entry["name"], entry["version"]) for entry in bom["components"]
                if entry.get("purl", "").startswith("pkg:cargo/")}
    seen = set()
    paths = set()
    for component in inventory:
        identity = component["name"], component["version"]
        if identity not in expected or identity in seen or not component["files"]:
            raise ValueError("unexpected or incomplete dependency license inventory")
        seen.add(identity)
        prefix = f"licenses/cargo/{identity[0]}-{identity[1]}/"
        for record in component["files"]:
            name = record["path"]
            posix = PurePosixPath(name)
            if (not name.startswith(prefix) or ".." in posix.parts or "\\" in name
                    or ":" in name or name in paths):
                raise ValueError("invalid dependency license path")
            if sha256(directory.joinpath(*posix.parts)) != record["sha256"]:
                raise ValueError(f"dependency license digest differs for {name}")
            paths.add(name)
    actual = {path.relative_to(directory).as_posix()
              for path in (directory / "licenses/cargo").rglob("*") if path.is_file()}
    if seen != expected or actual != paths | {"licenses/cargo/manifest.json"}:
        raise ValueError("missing dependency license inventory entries")


def verify(package, require_clean):
    record = json.loads((package / "candidate-build.json").read_text(encoding="utf-8"))
    target = record["cli_target"]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", target):
        raise ValueError("invalid target in build record")
    if require_clean and record.get("dirty_worktree") is not False:
        raise ValueError("candidate must be built from a clean checkout")
    cli_archive = f"iimg-cli-{target}.zip"
    expected_files = {
        cli_archive, "iimg-web.zip", "iimg-spec-and-conformance.zip",
        f"iimg-cli-{target}.cdx.json", "iimg-web.cdx.json", "candidate-build.json",
    }
    checksums = {}
    for line in (package / "SHA256SUMS").read_text(encoding="ascii").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9_.-]+)", line)
        if not match or match[2] in checksums:
            raise ValueError("malformed or duplicate checksum")
        checksums[match[2]] = match[1]
    if checksums.keys() != expected_files or {path.name for path in package.iterdir()} != expected_files | {"SHA256SUMS"}:
        raise ValueError("incomplete or unexpected candidate package")
    for name, expected in checksums.items():
        if sha256(package / name) != expected:
            raise ValueError(f"SHA-256 mismatch for {name}")

    with tempfile.TemporaryDirectory(prefix="iimg-candidate-") as temporary:
        scratch = Path(temporary)
        cli_name = "iimg-cli.exe" if "windows" in target.split("-") else "iimg-cli"
        extract(package / cli_archive, scratch / "cli")
        extract(package / "iimg-web.zip", scratch / "web")
        extract(package / "iimg-spec-and-conformance.zip", scratch / "suite")
        for bundle in ("cli", "web", "suite"):
            if any(not (scratch / bundle / name).is_file()
                   or not (scratch / bundle / name).stat().st_size for name in LICENSE_FILES):
                raise ValueError(f"missing project license files in {bundle}")
        for bundle, filename in (("cli", f"iimg-cli-{target}.cdx.json"), ("web", "iimg-web.cdx.json")):
            bom = json.loads((package / filename).read_text(encoding="utf-8"))
            verify_notices(scratch / bundle, bom)
        cli = scratch / "cli" / cli_name
        wasm = scratch / "web/iimg_web.wasm"
        binaries = record["provided_binary_sha256"]
        if sha256(cli) != binaries[cli_name] or sha256(wasm) != binaries[wasm.name]:
            raise ValueError("extracted binary digest differs from build record")
        subprocess.run([sys.executable, "-B", scratch / "suite/tests/conformance/check.py",
                        "--cli", cli], check=True)
        subprocess.run([sys.executable, "-B", scratch / "suite/tests/conformance/mail_transport.py",
                        "--cli", cli], check=True)
        subprocess.run(["node", ROOT / "viewers/web/smoke.mjs", wasm], check=True)
    print(f"Verified {len(checksums)} candidate files and extracted CLI/WASM behavior.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("--require-clean", action="store_true")
    args = parser.parse_args()
    verify(args.package, args.require_clean)
