"""Verify the APK contains the expected shared viewer and release WASM bytes."""

import argparse
import hashlib
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
WASM = ROOT / "target/wasm32-unknown-unknown/release/iimg_web.wasm"


def check(apk, wasm):
    expected = {
        "assets/index.html": ROOT / "viewers/web/index.html",
        "assets/viewer.mjs": ROOT / "viewers/web/viewer.mjs",
        "assets/iimg_web.wasm": wasm,
    }
    with ZipFile(apk) as archive:
        names = archive.namelist()
        for entry in (*expected, "classes.dex", "AndroidManifest.xml"):
            if names.count(entry) != 1:
                raise ValueError(f"expected one APK entry for {entry}")
        for entry, source in expected.items():
            if archive.read(entry) != source.read_bytes():
                raise ValueError(f"{entry} differs from {source}")
    print(f"{apk.name} SHA-256 {hashlib.sha256(apk.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--wasm", type=Path, default=WASM)
    args = parser.parse_args()
    check(args.apk, args.wasm)
