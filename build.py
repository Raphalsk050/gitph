#!/usr/bin/env python3
"""Builds gitph: typecheck + compile + electron-builder installer in release/."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

if __name__ == "__main__":
    result = subprocess.run("npm run dist", cwd=ROOT, shell=True)
    sys.exit(result.returncode)
