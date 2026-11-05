"""Smoke-test content URI handoff on a selected Android test device."""

import argparse
import hashlib
from pathlib import Path
import subprocess
import time
from zipfile import ZIP_STORED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
APP = "org.iimg.viewer"
SENDER = "org.iimg.handoff/.SendFixture"


def run(adb, serial, apk, sender_apk):
    fixture_path = ROOT / "tests/fixtures/v0.2/two-controls.iimg"
    fixture = fixture_path.read_bytes()
    with ZipFile(sender_apk) as archive:
        asset = archive.getinfo("assets/two-controls.iimg")
        if asset.compress_type != ZIP_STORED or archive.read(asset) != fixture:
            raise RuntimeError("Sender APK must contain the original fixture as an uncompressed asset")

    def device(*args):
        result = subprocess.run([str(adb), "-s", serial, *map(str, args)],
                                capture_output=True, timeout=60)
        if result.returncode:
            raise RuntimeError(result.stderr.decode(errors="replace"))
        return result.stdout

    def shell(*args):
        return device("shell", "-T", *args)

    def text(*args):
        return shell(*args).decode(errors="replace").strip()

    def expect_controls():
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                pid = text("pidof", APP)
            except RuntimeError:
                time.sleep(0.5)
                continue
            if pid.isdigit():
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("viewer activity process did not start")
        port = device("forward", "tcp:0", f"localabstract:webview_devtools_remote_{pid}").decode().strip()
        try:
            subprocess.run(["node", ROOT / "scripts/test_android_webview.mjs", port],
                           check=True, timeout=60)
        finally:
            device("forward", "--remove", f"tcp:{port}")

    print(f"Android API {text('getprop', 'ro.build.version.sdk')}")
    print(device("install", "-r", apk).decode().strip())
    print(device("install", "-r", sender_apk).decode().strip())
    expected = hashlib.sha256(fixture).hexdigest()
    for action in ("VIEW", "SEND"):
        shell("am", "force-stop", APP)
        launch = text("am", "start", "-n", SENDER, "--es", "fixture_action", action,
                      "--es", "expected_sha256", expected)
        if "Error:" in launch or "Starting: Intent" not in launch:
            raise RuntimeError(f"{action} fixture sender failed to start: {launch}")
        expect_controls()
        print(f"{action} resolved to IIMG and passed the WebView pixel and activation checks.")
    print(f"Provider fixture SHA-256 verified by sender: {expected}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", type=Path, required=True)
    parser.add_argument("--serial", required=True, help="Explicit test emulator or device serial")
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--sender-apk", type=Path, required=True)
    args = parser.parse_args()
    run(args.adb, args.serial, args.apk, args.sender_apk)
