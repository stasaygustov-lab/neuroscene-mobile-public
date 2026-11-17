#!/usr/bin/env python3
"""Capture NeuroScene Android smoke-test screenshots with ADB retry and health checks."""
from pathlib import Path
import hashlib
import re
import subprocess
import time
import xml.etree.ElementTree as ET

OUT = Path("screenshots")
DIAGNOSTICS = Path("artifacts/diagnostics")
REMOTE = "/data/local/tmp"
OUT.mkdir(parents=True, exist_ok=True)
DIAGNOSTICS.mkdir(parents=True, exist_ok=True)


def run(args, timeout=30, **kwargs):
    return subprocess.run(args, check=True, timeout=timeout, **kwargs)


def diagnostic(name):
    try:
        result = subprocess.run(
            ["adb", "logcat", "-d", "-v", "threadtime"],
            check=True, timeout=45, capture_output=True, text=True,
        )
        (DIAGNOSTICS / name).write_text(result.stdout, encoding="utf-8")
    except Exception as exc:
        (DIAGNOSTICS / f"{name}.error.txt").write_text(str(exc), encoding="utf-8")


def app_pid():
    result = subprocess.run(
        ["adb", "shell", "pidof", "com.neuroscene.app"],
        check=False, timeout=20, capture_output=True, text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def assert_app_running():
    pid = app_pid()
    if not pid:
        diagnostic("crash-logcat.txt")
        raise RuntimeError("NeuroScene process is not running; see crash-logcat.txt")
    print(f"NeuroScene process is alive: PID {pid}", flush=True)
    return pid


def capture(name):
    remote = f"{REMOTE}/{name}"
    last_error = None
    for attempt in range(1, 4):
        assert_app_running()
        try:
            run(["adb", "shell", "screencap", "-p", remote], timeout=100)
            run(["adb", "pull", remote, str(OUT / name)], timeout=60)
            target = OUT / name
            if not target.is_file() or target.stat().st_size < 1000:
                raise RuntimeError(f"Screenshot is missing or too small: {target}")
            print(f"Captured {name} ({target.stat().st_size} bytes), attempt {attempt}", flush=True)
            return
        except Exception as exc:
            last_error = exc
            print(f"Capture {name} attempt {attempt}/3 failed: {exc}", flush=True)
            diagnostic(f"capture-attempt-{name.replace('.png', '')}-{attempt}.txt")
            if attempt < 3:
                time.sleep(5 * attempt)
    raise RuntimeError(f"Could not capture {name} after 3 attempts: {last_error}")


def screen_size():
    value = subprocess.check_output(["adb", "shell", "wm", "size"], text=True, timeout=20)
    match = re.search(r"(\d+)x(\d+)", value)
    if not match:
        raise RuntimeError(f"Cannot read emulator screen size: {value}")
    return int(match.group(1)), int(match.group(2))


def hierarchy():
    run(
        ["adb", "shell", "uiautomator", "dump", f"{REMOTE}/window.xml"],
        timeout=70, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    raw = subprocess.check_output(
        ["adb", "shell", "cat", f"{REMOTE}/window.xml"],
        text=True, timeout=20,
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
            def bottom_edge(node):
                bounds = list(map(
                    int, node.attrib["bounds"].replace("][", ",").strip("[]").split(",")
                ))
                return bounds[3], bounds
            _, bounds = max((bottom_edge(node) for node in candidates), key=lambda item: item[0])
            x = (bounds[0] + bounds[2]) // 2
            y = (bounds[1] + bounds[3]) // 2
            run(["adb", "shell", "input", "tap", str(x), str(y)], timeout=20)
            print(f"Tapped {label!r} using accessibility bounds", flush=True)
            return
    except Exception as exc:
        print(f"Accessibility lookup for {label!r} unavailable; coordinate fallback: {exc}", flush=True)
    run(["adb", "shell", "input", "tap", str(fallback_x), str(fallback_y)], timeout=20)


deadline = time.monotonic() + 180
while time.monotonic() < deadline:
    try:
        boot = subprocess.check_output(
            ["adb", "shell", "getprop", "sys.boot_completed"], text=True, timeout=15
        ).strip()
        if boot == "1":
            break
    except Exception:
        pass
    time.sleep(3)
else:
    diagnostic("boot-timeout-logcat.txt")
    raise SystemExit("Android framework did not report sys.boot_completed=1")

# The splash is brief: capture it immediately after the app process appears.
pid_deadline = time.monotonic() + 60
while time.monotonic() < pid_deadline and not app_pid():
    time.sleep(1)
assert_app_running()
capture("00-splash.png")
diagnostic("before-capture-logcat.txt")
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
    "00-splash.png", "01-create.png", "02-gallery.png",
    "03-credits.png", "04-profile.png", "05-email-login.png",
]
missing = [
    name for name in required
    if not (OUT / name).is_file() or (OUT / name).stat().st_size < 1000
]
if missing:
    raise SystemExit(f"Missing or invalid screenshots: {missing}")

hashes = {name: hashlib.sha256((OUT / name).read_bytes()).hexdigest() for name in required}
duplicates = {}
for name, digest in hashes.items():
    duplicates.setdefault(digest, []).append(name)
duplicates = [names for names in duplicates.values() if len(names) > 1]
if duplicates:
    raise SystemExit(f"Some screen captures are identical; navigation may have failed: {duplicates}")

diagnostic("after-capture-logcat.txt")
assert_app_running()
print(f"Successfully captured {len(required)} distinct screenshots", flush=True)
