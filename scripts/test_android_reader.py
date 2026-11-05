"""Compile and execute the platform-independent Android reader contract tests."""

import argparse
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]

def run(java_bin):
    suffix = ".exe" if (java_bin / "java.exe").is_file() else ""
    java, javac = java_bin / f"java{suffix}", java_bin / f"javac{suffix}"
    with tempfile.TemporaryDirectory(prefix="iimg-reader-") as temporary:
        sources = [ROOT / "viewers/android/app/src/main/java/org/iimg/viewer/DocumentReader.java",
                   ROOT / "viewers/android/app/src/testStandalone/java/org/iimg/viewer/DocumentReaderTest.java"]
        subprocess.run([str(javac), "--release", "17", "-Xlint:all", "-Werror", "-d", temporary,
                        *map(str, sources)], check=True)
        subprocess.run([str(java), "-cp", temporary, "org.iimg.viewer.DocumentReaderTest"],
                       check=True, timeout=20)

if __name__ == "__main__":
    import os
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--java-bin", type=Path,
                        default=Path(os.environ.get("JAVA_HOME", "")) / "bin")
    run(parser.parse_args().java_bin)
