"""Build and test two source-only IIMG snapshots in new directories."""

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
CLI = "iimg-cli.exe" if os.name == "nt" else "iimg-cli"
WASM = Path("target/wasm32-unknown-unknown/release/iimg_web.wasm")


def run(folder, *command, env=None):
    subprocess.run(command, cwd=folder, env=env, check=True)


def source_snapshot(destination, files):
    destination.mkdir()
    for name in files:
        source = ROOT / name
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"expected regular source file: {name}")
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)


def build(folder, verify):
    env = os.environ.copy()
    env.pop("CARGO_TARGET_DIR", None)
    env.pop("RUSTFLAGS", None)
    env["CARGO_INCREMENTAL"] = "0"
    env["CARGO_ENCODED_RUSTFLAGS"] = f"--remap-path-prefix={folder}=/iimg"

    if verify:
        run(folder, "cargo", "fmt", "--all", "--", "--check", env=env)
        run(folder, "cargo", "clippy", "--locked", "--offline", "--workspace",
            "--all-targets", "--", "-D", "warnings", env=env)
        run(folder, "cargo", "test", "--locked", "--offline", "--workspace", env=env)
        doc_env = {**env, "RUSTDOCFLAGS": "-D warnings"}
        run(folder, "cargo", "doc", "--locked", "--offline", "--workspace",
            "--no-deps", env=doc_env)
    rustc = subprocess.check_output(["rustc", "-vV"], cwd=folder, text=True)
    host = next(line.removeprefix("host: ") for line in rustc.splitlines() if line.startswith("host: "))
    if host.endswith("-windows-msvc"):
        run(folder, "cargo", "rustc", "--locked", "--offline", "--release", "-p", "iimg-cli",
            "--", "-C", "link-arg=/Brepro", env=env)
    else:
        run(folder, "cargo", "build", "--locked", "--offline", "--release", "-p", "iimg-cli", env=env)
    run(folder, "cargo", "build", "--locked", "--offline", "--release",
        "--target", "wasm32-unknown-unknown", "-p", "iimg-web", env=env)
    if verify:
        run(folder, sys.executable, "-B", "tests/conformance/check.py", "--cli",
            folder / "target/release" / CLI, env=env)
        run(folder, "node", "viewers/web/smoke.mjs", env=env)


def verify(scratch):
    raw = subprocess.check_output(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=ROOT)
    files = sorted({Path(name.decode("utf-8")) for name in raw.split(b"\0") if name})
    scratch.mkdir(parents=True, exist_ok=False)
    first, second = scratch / "first", scratch / "second"
    for folder in (first, second):
        source_snapshot(folder, files)
    print(f"Copied {len(files)} source files per snapshot", flush=True)
    build(first, verify=True)
    build(second, verify=False)
    differences = []
    for artifact in (Path("target/release") / CLI, WASM):
        a, b = (folder.joinpath(artifact).read_bytes() for folder in (first, second))
        print(f"{artifact.name}: {hashlib.sha256(a).hexdigest()}", flush=True)
        if a != b:
            print(f"{artifact.name} second build: {hashlib.sha256(b).hexdigest()}", flush=True)
            differences.append(artifact.name)
    if differences:
        raise AssertionError(f"Independent build bytes differ for {', '.join(differences)}")
    print("CLI and WebAssembly binaries match across both source-only builds.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scratch", type=Path, required=True, help="New directory for both builds")
    verify(parser.parse_args().scratch.resolve())
