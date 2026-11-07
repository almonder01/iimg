"""Exercise Android release signing and optional updates on a disposable emulator."""
import argparse
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile

from check_android_certificate import fingerprint, verify_certificate

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "org.iimg.viewer"
VARIABLES = ("IIMG_ANDROID_KEYSTORE", "IIMG_ANDROID_STORE_PASSWORD",
             "IIMG_ANDROID_KEY_ALIAS", "IIMG_ANDROID_KEY_PASSWORD")


def exercise_update(args, env, directory, signed):
    old_signed = directory / "baseline-test.apk"
    signed_baseline = subprocess.run([
        str(args.apksigner), "sign", "--ks", env["IIMG_ANDROID_KEYSTORE"],
        "--ks-key-alias", env["IIMG_ANDROID_KEY_ALIAS"],
        "--ks-pass", "env:IIMG_ANDROID_STORE_PASSWORD", "--key-pass", "env:IIMG_ANDROID_KEY_PASSWORD",
        "--out", str(old_signed), str(args.baseline_apk),
    ], env=env, capture_output=True, timeout=45)
    if signed_baseline.returncode:
        raise RuntimeError("Could not sign baseline with the disposable test key")
    verify_certificate(args.apksigner, old_signed, fingerprint(args.apksigner, signed))

    def device(*command):
        return subprocess.run([str(args.adb), "-s", args.serial, *map(str, command)],
                              capture_output=True, text=True, timeout=60)

    def installed_version():
        result = device("shell", "dumpsys", "package", PACKAGE)
        match = re.search(r"versionCode=(\d+)", result.stdout)
        return int(match[1]) if match else None

    if installed_version() is not None:
        raise RuntimeError("Use a disposable emulator with the base viewer package absent")
    assert "Success" in device("install", old_signed).stdout
    before = installed_version()
    assert "Success" in device("install", "-r", signed).stdout
    after = installed_version()
    assert before is not None and after is not None and before < after
    different = device("install", "-r", args.different_signer_apk)
    assert "INSTALL_FAILED_UPDATE_INCOMPATIBLE" in different.stdout + different.stderr
    assert installed_version() == after
    print(f"Android accepted a same-certificate update from versionCode {before} to {after} and rejected a different signer.")


def test(args):
    base = {name: value for name, value in os.environ.items() if name not in VARIABLES}
    gradle = [str(args.gradle), "-p", str(ROOT / "viewers/android"), "--no-daemon"]
    if args.offline:
        gradle.append("--offline")
    with tempfile.TemporaryDirectory(prefix="iimg-signing-test-") as temporary:
        directory = Path(temporary)
        build_directory = directory / "app-build"

        def assemble(env, success=True):
            result = subprocess.run([
                *gradle, f"-PiimgBuildDirectory={build_directory}", ":app:assembleRelease",
            ], cwd=ROOT, env=env, capture_output=True, timeout=300)
            log = (result.stdout + result.stderr).decode(errors="replace")
            if (result.returncode == 0) != success:
                for name in VARIABLES:
                    if env.get(name):
                        log = log.replace(env[name], "[redacted]")
                raise RuntimeError(f"Unexpected signing test result. {log[-4000:]}")
            return log

        assert "Release signing requires all" in assemble(base, success=False)
        key = directory / "ephemeral-test.jks"
        password = secrets.token_urlsafe(32)
        env = {**base, "IIMG_ANDROID_KEYSTORE": str(key), "IIMG_ANDROID_STORE_PASSWORD": password,
               "IIMG_ANDROID_KEY_ALIAS": "iimg-ephemeral-test", "IIMG_ANDROID_KEY_PASSWORD": password}
        generated = subprocess.run([
            str(args.keytool), "-genkeypair", "-keystore", str(key), "-storetype", "PKCS12",
            "-storepass:env", "IIMG_ANDROID_STORE_PASSWORD", "-keypass:env", "IIMG_ANDROID_KEY_PASSWORD",
            "-alias", "iimg-ephemeral-test", "-keyalg", "RSA", "-keysize", "2048",
            "-validity", "2", "-dname", "CN=IIMG disposable automation test",
        ], env=env, capture_output=True, timeout=45)
        if generated.returncode:
            raise RuntimeError("Could not create disposable signing-test key")
        assemble(env)
        apk = build_directory / "outputs/apk/release/app-release.apk"
        certificate = fingerprint(args.apksigner, apk)
        verify_certificate(args.apksigner, apk, certificate)
        try:
            verify_certificate(args.apksigner, apk, "0" * 64)
        except ValueError as error:
            assert "Unexpected APK signer" in str(error)
        else:
            raise AssertionError("Certificate verification accepted an unrelated fingerprint")
        if args.adb:
            exercise_update(args, env, directory, apk)
    print("Release signing rejected absent credentials and a mismatched certificate. Disposable signing inputs and build outputs were removed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gradle", type=Path, required=True)
    parser.add_argument("--keytool", type=Path, required=True)
    parser.add_argument("--apksigner", type=Path, required=True)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--adb", type=Path)
    parser.add_argument("--serial")
    parser.add_argument("--baseline-apk", type=Path)
    parser.add_argument("--different-signer-apk", type=Path)
    args = parser.parse_args()
    update = (args.adb, args.serial, args.baseline_apk, args.different_signer_apk)
    if any(update) and (not all(update) or not re.fullmatch(r"emulator-\d+", args.serial)):
        parser.error("Update testing requires all four update options and an explicit emulator serial")
    test(args)
