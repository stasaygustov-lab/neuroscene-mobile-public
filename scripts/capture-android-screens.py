#!/usr/bin/env python3
"""Capture NeuroScene Android smoke-test screenshots using adb."""
from pathlib import Path
import re
import hashlib
import subprocess
import time
import xml.etree.ElementTree as ET

OUT = Path("screenshots")
REMOTE = "/data/local/tmp"
OUT.mkdir(parents=True, exist_ok=True)

def run(args, timeout=45, **kwargs):
    return subprocess.run(args, check=True, timeout=timeout, **kwargs)

def capture(name):
    remote = f"{REMOTE}/{name}"
    run(["adb", "shell", "screencap", "-p", remote], timeout=45)
    run(["adb", "pull", remote, str(OUT / name)], timeout=45)
    print(f"Captured {name}", flush=True)

def screen_size():
    value = subprocess.check_output(["adb", "shell", "wm", "size"], text=True, timeout=15)
    match = re.search(r"(\d+)x(\d+)", value)
    if not match:
        raise RuntimeError(f"Cannot read emulator screen size: {value}")
    return int(match.group(1)), int(match.group(2))

def hierarchy():
    run(
        ["adb", "shell", "uiautomator", "dump", f"{REMOTE}/window.xml"],
        timeout=50,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    raw = subprocess.check_output(
        ["adb", "shell", "cat", f"{REMOTE}/window.xml"],
        text=True,
        timeout=15,
    )
    return ET.fromstring(raw)

def tap_text(label, fallback_x, fallback_y):
    try:
        root = hierarchy()
        candidates = [
            node for node in root.iter("node")
            if node.attrib.get("text") == label
            or node.attrib.get("content-desc") == label
        ]
        if candidates:
            bounds = list(map(
                int,
                candidates[0].attrib["bounds"].replace("][", ",").strip("[]").split(","),
            ))
            x = (bounds[0] + bounds[2]) // 2
            y = (bounds[1] + bounds[3]) // 2
            run(["adb", "shell", "input", "tap", str(x), str(y)], timeout=15)
            print(f"Tapped {label!r} using accessibility bounds", flush=True)
            return
    except Exception as exc:
        print(f"Accessibility lookup for {label!r} unavailable; using coordinate fallback: {exc}", flush=True)
    run(["adb", "shell", "input", "tap", str(fallback_x), str(fallback_y)], timeout=15)

# The app splash animation is intentionally left enabled.
time.sleep(1)
capture("00-splash.png")
time.sleep(5)
capture("01-create.png")

width, height = screen_size()
nav_y = height - 180
for label, index, filename in [
    ("Галерея", 1, "02-gallery.png"),
    ("Кредиты", 2, "03-credits.png"),
    ("Профиль", 3, "04-profile.png"),
]:
    x = width * (2 * index + 1) // 8
    tap_text(label, x, nav_y)
    time.sleep(3)
    capture(filename)
    if label == "Профиль":
        tap_text("Войти по email", width // 2, int(height * 0.70))
        time.sleep(2)
        capture("05-email-login.png")

required = [
    "00-splash.png",
    "01-create.png",
    "02-gallery.png",
    "03-credits.png",
    "04-profile.png",
    "05-email-login.png",
]
missing = [name for name in required if not (OUT / name).is_file() or (OUT / name).stat().st_size < 1000]
if missing:
    raise SystemExit(f"Missing or invalid screenshots: {missing}")

hashes = {
    name: hashlib.sha256((OUT / name).read_bytes()).hexdigest()
    for name in required
}
duplicates = {}
for name, digest in hashes.items():
    duplicates.setdefault(digest, []).append(name)
duplicates = [names for names in duplicates.values() if len(names) > 1]
if duplicates:
    raise SystemExit(f"Some screen captures are identical; navigation may have failed: {duplicates}")

print(f"Successfully captured {len(required)} distinct screenshots", flush=True)
