"""Verify an APK and compare its signing certificate with a recorded identity."""
import argparse
from pathlib import Path
import re
import subprocess


def fingerprint(apksigner, apk):
    result = subprocess.run([str(apksigner), "verify", "--print-certs", str(apk)],
                            capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise ValueError("APK signature verification failed")
    matches = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})\s*$",
                         result.stdout, re.MULTILINE | re.IGNORECASE)
    if len(matches) != 1:
        raise ValueError("Expected one APK signing certificate")
    return matches[0].lower()


def verify_certificate(apksigner, apk, expected):
    expected = expected.replace(":", "").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError("Expected a SHA-256 certificate fingerprint")
    actual = fingerprint(apksigner, apk)
    if actual != expected:
        raise ValueError(f"Unexpected APK signer certificate: {actual}")
    return actual


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apksigner", type=Path, required=True)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--expected", required=True)
    args = parser.parse_args()
    actual = verify_certificate(args.apksigner, args.apk, args.expected)
    print(f"APK signing certificate SHA-256 {actual}")
