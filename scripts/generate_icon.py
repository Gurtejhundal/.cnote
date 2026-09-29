#!/usr/bin/env python3
"""Use the approved .cnote logo as the extension icon."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'assets' / 'cnote-logo.png'
OUT = ROOT / 'media' / 'cnote-icon.png'

if not SRC.exists():
    raise SystemExit(f'missing logo source: {SRC}')

OUT.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(SRC, OUT)
print(f'copied {SRC} -> {OUT}')
