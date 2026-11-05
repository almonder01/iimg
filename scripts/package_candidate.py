"""Package local IIMG Core 1.0 candidate artifacts for review."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
WEB_FILES = ("index.html", "offline.js", "viewer.mjs", "editor.mjs", "README.md")
LICENSE_FILES = ("LICENSES.md", "LICENSE", "NOTICE", "LICENSE-CC-BY-4.0")
SPEC_FILES = (
    "CHANGELOG.md",
    "spec/IIMG-0.1.md", "spec/IIMG-0.2-visual.md", "spec/IIMG-0.2-interaction.md",
    "spec/IIMG-1.0-candidate.md", "rfcs/0001-wire-compatibility.md",
    "rfcs/0002-raster-assets.md", "docs/AUTHORING.md", "docs/SDK.md", "docs/ARCHITECTURE.md",
    "docs/SECURITY-MODEL.md",
    "docs/TESTING.md", "docs/reviews/2026-11-05-core-candidate.md",
    "docs/ACCESSIBILITY.md", "docs/NEXT-DEVELOPMENT.md",
    "docs/BENCHMARKS.md", "docs/benchmarks/2026-11-05-gallery-windows.json",
    "docs/adr/0001-container-first.md", "viewers/web/README.md", "viewers/android/README.md",
)


def command(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True, encoding="utf-8").strip()


def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def archive(path, entries):
    with zipfile.ZipFile(path, "x") as output:
        for name, (data, mode) in sorted(entries.items()):
            item = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            item.create_system = 3
            item.external_attr = (0o100000 | mode) << 16
            output.writestr(item, data)


def source_entries(paths):
    return {name: ((ROOT / name).read_bytes(), 0o644) for name in paths}


def dependency_artifacts(crate, target):
    graph = json.loads(command("cargo", "metadata", "--format-version", "1", "--locked",
                               "--offline", "--filter-platform", target))
    packages = {package["id"]: package for package in graph["packages"]}
    nodes = {node["id"]: node for node in graph["resolve"]["nodes"]}
    root, = [package for package in graph["workspace_members"] if packages[package]["name"] == crate]

    def dependencies(identifier):
        return [dep["pkg"] for dep in nodes[identifier]["deps"]
                if any(kind["kind"] != "dev" for kind in dep["dep_kinds"])]

    def component(identifier):
        package = packages[identifier]
        name, version = package["name"], package["version"]
        entry = {"type": "library", "name": name, "version": version,
                 "bom-ref": f"{name}@{version}"}
        if package["source"]:
            entry["purl"] = f"pkg:cargo/{name}@{version}"
        if package["license"]:
            entry["licenses"] = [{"expression": package["license"]}]
        return entry

    seen = set()
    pending = [root]
    while pending:
        identifier = pending.pop()
        if identifier not in seen:
            seen.add(identifier)
            pending.extend(dependencies(identifier))
    entries = {identifier: component(identifier) for identifier in seen}
    root_entry = entries[root]
    root_entry["type"] = "application"
    order = sorted(seen, key=lambda identifier: entries[identifier]["bom-ref"])
    bom = {
        "$schema": "http://cyclonedx.org/schema/bom-1.6.schema.json",
        "bomFormat": "CycloneDX", "specVersion": "1.6", "version": 1,
        "metadata": {"component": root_entry},
        "components": [entries[identifier] for identifier in order if identifier != root],
        "dependencies": [
            {"ref": entries[identifier]["bom-ref"],
             "dependsOn": sorted({entries[dep]["bom-ref"] for dep in dependencies(identifier)})}
            for identifier in order
        ],
    }
    notices = {}
    inventory = []
    for identifier in order:
        package = packages[identifier]
        if not package["source"]:
            continue
        directory = Path(package["manifest_path"]).parent
        files = {path for path in directory.iterdir() if path.is_file()
                 and path.name.upper().startswith(("LICENSE", "COPYING", "NOTICE"))}
        if package["license_file"]:
            files.add(directory / package["license_file"])
        if not files:
            raise ValueError(f"missing license files for {package['name']} {package['version']}")
        records = []
        for path in sorted(files):
            data = path.read_bytes()
            name = f"licenses/cargo/{package['name']}-{package['version']}/{path.name}"
            notices[name] = (data, 0o644)
            records.append({"path": name, "sha256": digest(data)})
        inventory.append({"name": package["name"], "version": package["version"],
                          "license": package["license"], "files": records})
    notices["licenses/cargo/manifest.json"] = (json_bytes(inventory), 0o644)
    return bom, notices


def package(output, cli, wasm, target):
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", target):
        raise ValueError("invalid Rust target triple")
    cli_name = "iimg-cli.exe" if "windows" in target.split("-") else "iimg-cli"
    cli_data, wasm_data = cli.read_bytes(), wasm.read_bytes()
    if not cli_data or not wasm_data.startswith(b"\0asm\x01\0\0\0"):
        raise ValueError("missing CLI binary or invalid WebAssembly header")
    cli_bom, cli_notices = dependency_artifacts("iimg-cli", target)
    web_bom, web_notices = dependency_artifacts("iimg-web", "wasm32-unknown-unknown")
    project_licenses = source_entries(LICENSE_FILES)
    web = {name: ((ROOT / "viewers/web" / name).read_bytes(), 0o644) for name in WEB_FILES}
    web["iimg_web.wasm"] = (wasm_data, 0o644)
    web["serve.py"] = ((ROOT / "scripts/serve_web.py").read_bytes(), 0o644)
    web.update(project_licenses)
    web.update(web_notices)
    spec = source_entries(SPEC_FILES)
    spec.update(project_licenses)
    schema_files = [path for path in (ROOT / "spec/schemas").iterdir()
                    if path.is_file() and path.suffix in (".json", ".md")]
    spec.update(source_entries(path.relative_to(ROOT).as_posix() for path in schema_files))
    fixture_files = [path for path in (ROOT / "tests/fixtures").rglob("*") if path.is_file()
                     and path.suffix in (".iimg", ".json", ".py")]
    spec.update(source_entries(path.relative_to(ROOT).as_posix() for path in fixture_files))
    spec.update(source_entries((
        "examples/showcase/generate.py", "examples/showcase/README.md",
        "examples/showcase/previews/orbital-night.png", "examples/showcase/previews/solar-house.png",
        "examples/showcase/previews/signal-garden.png",
        "viewers/web/smoke-showcase.mjs",
        "viewers/web/benchmark-gallery.mjs", "viewers/web/benchmark.mjs", "viewers/web/benchmark-native.mjs",
        "examples/hello.iimg", "examples/lamp.source.json", "examples/raster-lamp.source.json",
        "tests/conformance/check.py",
        "tests/conformance/generated.py",
        "tests/conformance/reference.py", "tests/conformance/mail_transport.py", "tests/README.md",
        "tests/conformance/android_fixtures.py",
        "scripts/test_android_webview.mjs", "scripts/test_android_handoff.py",
        "viewers/web/schema-test.mjs", "viewers/web/package.json", "viewers/web/package-lock.json",
    )))

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="iimg-gallery-", dir=output.parent) as temporary:
        generated = Path(temporary) / "showcase"
        subprocess.run([sys.executable, "-B", ROOT / "examples/showcase/generate.py",
                        "--cli", cli.resolve(), "--output", generated], cwd=ROOT, check=True)
        for path in generated.iterdir():
            spec[f"examples/showcase/generated/{path.name}"] = (path.read_bytes(), 0o644)

    commit = command("git", "rev-parse", "HEAD")
    status = command("git", "status", "--porcelain", "--untracked-files=normal")
    toolchain = command("rustc", "--version")
    output.mkdir(parents=True, exist_ok=False)
    archive(output / f"iimg-cli-{target}.zip",
            {cli_name: (cli_data, 0o755), **project_licenses, **cli_notices})
    archive(output / "iimg-web.zip", web)
    archive(output / "iimg-spec-and-conformance.zip", spec)
    (output / f"iimg-cli-{target}.cdx.json").write_bytes(json_bytes(cli_bom))
    (output / "iimg-web.cdx.json").write_bytes(json_bytes(web_bom))
    (output / "candidate-build.json").write_bytes(json_bytes({
        "status": "local candidate package",
        "wire_version": "1.0-candidate",
        "git_head": commit,
        "dirty_worktree": bool(status),
        "toolchain": toolchain,
        "cli_target": target,
        "cargo_lock_sha256": digest((ROOT / "Cargo.lock").read_bytes()),
        "provided_binary_sha256": {cli_name: digest(cli_data), "iimg_web.wasm": digest(wasm_data)},
    }))
    checksums = "".join(f"{digest(path.read_bytes())}  {path.name}\n"
                        for path in sorted(output.iterdir()))
    (output / "SHA256SUMS").write_bytes(checksums.encode("ascii"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--wasm", type=Path, required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    package(args.output, args.cli, args.wasm, args.target)
