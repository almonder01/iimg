"""Smoke-test content URI handoff on a selected Android test device."""

import argparse
import hashlib
from pathlib import Path
import subprocess
import time
from zipfile import ZIP_STORED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
APP = "org.iimg.viewer"
SENDER = "org.iimg.handoff"


def run(adb, serial, apk, sender_apk, advanced=False, viewer_package=APP, sender_package=SENDER):
    cases = [("VIEW", "v0.2/two-controls.iimg", "scripted"), ("SEND", "v0.2/two-controls.iimg", "scripted")]
    if advanced:
        cases.extend([("VIEW", "motion/motion.iimg", "motion"), ("SEND", "drag/drag.iimg", "drag")])
    fixtures = {}
    with ZipFile(sender_apk) as archive:
        for _, fixture, _ in cases:
            path = ROOT / "tests/fixtures" / fixture
            data = path.read_bytes()
            asset = archive.getinfo(f"assets/{path.name}")
            if asset.compress_type != ZIP_STORED or archive.read(asset) != data:
                raise RuntimeError(f"Sender APK must contain original uncompressed {path.name}")
            fixtures[fixture] = (path.name, hashlib.sha256(data).hexdigest())

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

    def expect_controls(mode):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                pid = text("pidof", viewer_package)
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
            subprocess.run(["node", ROOT / "scripts/test_android_webview.mjs", port, mode],
                           check=True, timeout=60)
        finally:
            device("forward", "--remove", f"tcp:{port}")

    print(f"Android API {text('getprop', 'ro.build.version.sdk')}")
    print(device("install", "-r", apk).decode().strip())
    print(device("install", "-r", sender_apk).decode().strip())
    for action, fixture, mode in cases:
        name, expected = fixtures[fixture]
        shell("am", "force-stop", viewer_package)
        # The viewer can occupy the sender's previous task after the sender
        # finishes. Start a fresh sender task for each fixture and app variant.
        sender = f"{sender_package}/org.iimg.handoff.SendFixture"
        launch = text("am", "start", "-f", "0x10008000", "-n", sender, "--es", "fixture_action", action,
                      "--es", "fixture_name", name, "--es", "expected_sha256", expected,
                      "--es", "viewer_package", viewer_package)
        if "Error:" in launch or "Starting: Intent" not in launch:
            raise RuntimeError(f"{action} fixture sender failed to start: {launch}")
        expect_controls(mode)
        print(f"{action} {name} matched SHA-256 {expected} and passed WebView checks.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", type=Path, required=True)
    parser.add_argument("--serial", required=True, help="Explicit test emulator or device serial")
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--sender-apk", type=Path, required=True)
    parser.add_argument("--advanced", action="store_true", help="Also exercise bounded motion and DRAG fixtures")
    parser.add_argument("--viewer-package", choices=[APP, APP + ".rc"], default=APP)
    parser.add_argument("--sender-package", choices=[SENDER, SENDER + ".rc"], default=SENDER)
    args = parser.parse_args()
    run(args.adb, args.serial, args.apk, args.sender_apk, args.advanced, args.viewer_package, args.sender_package)
