"""Query OSV for the exact third-party versions in the IIMG lockfiles."""

import argparse
import json
from pathlib import Path
import subprocess
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = "https://api.osv.dev/v1/querybatch"


def cargo_packages(manifest):
    data = subprocess.check_output([
        "cargo", "metadata", "--locked", "--offline", "--format-version", "1",
        "--manifest-path", manifest,
    ], cwd=ROOT)
    packages = json.loads(data)["packages"]
    if any(package["source"] and package["source"] != "registry+https://github.com/rust-lang/crates.io-index"
           for package in packages):
        raise ValueError(f"unsupported third-party Cargo source in {manifest}")
    return {("crates.io", package["name"], package["version"])
            for package in packages if package["source"]}


def npm_packages():
    lock = json.loads((ROOT / "viewers/web/package-lock.json").read_text(encoding="utf-8"))
    return {("npm", package.get("name") or path.rsplit("node_modules/", 1)[-1], package["version"])
            for path, package in lock["packages"].items() if path}


def osv(packages):
    findings = {}
    pending = {key: None for key in packages}
    while pending:
        batch = []
        for (ecosystem, name, version), token in pending.items():
            item = {"package": {"ecosystem": ecosystem, "name": name}, "version": version}
            if token:
                item["page_token"] = token
            batch.append(item)
        request = Request(ENDPOINT, data=json.dumps({"queries": batch}).encode(),
                          headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=30) as response:
            results = json.load(response)["results"]
        if len(results) != len(pending):
            raise ValueError("OSV response length differs from the query")
        continuation = {}
        for key, result in zip(pending, results):
            findings.setdefault(key, set()).update(item["id"] for item in result.get("vulns", ()))
            token = result.get("next_page_token")
            if token:
                if token == pending[key]:
                    raise ValueError("OSV repeated the pagination token")
                continuation[key] = token
        pending = continuation
    return findings


def main(android_report=None):
    scopes = {
        "Runtime and build": cargo_packages("Cargo.toml"),
        "Fuzz harness": cargo_packages("fuzz/Cargo.toml"),
        "Browser test tooling": npm_packages(),
    }
    if android_report:
        report = json.loads(android_report.read_text(encoding="utf-8"))
        modules = (":app", ":handoffFixture")
        labels = ("build tools", "debug runtime", "release runtime")
        if (set(report) != {f"{module} {label}" for module in modules for label in labels}
                or any(not report[f"{module} build tools"] for module in modules)):
            raise ValueError("incomplete Android dependency report")
        scopes.update({
            f"Android {scope}": {("Maven", item["name"], item["version"]) for item in items}
            for scope, items in report.items()
        })
    packages = sorted(set().union(*scopes.values()))
    findings = osv(packages)
    failed = False
    for scope, dependencies in scopes.items():
        print(f"{scope}: {len(dependencies)} package versions queried")
        for key in sorted(dependencies):
            if findings[key]:
                failed = True
                print(f"  {' '.join(key)}: {', '.join(sorted(findings[key]))}")
    affected = sum(bool(ids) for ids in findings.values())
    print(f"OSV checked {len(packages)} distinct package versions; {affected} matched advisories.")
    return int(failed)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--android-report", type=Path)
    raise SystemExit(main(parser.parse_args().android_report))
