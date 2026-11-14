#!/usr/bin/env python3
"""Launch verification and semantic UI smoke test for NeuroScene on Android."""
from pathlib import Path
import re
import hashlib
import subprocess
import time
import xml.etree.ElementTree as ET

OUT = Path("screenshots")
REMOTE = "/data/local/tmp"
PACKAGE = "com.neuroscene.app"
OUT.mkdir(parents=True, exist_ok=True)


def run(args, timeout=45, **kwargs):
    return subprocess.run(args, check=True, timeout=timeout, **kwargs)


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


def visible_text():
    root = hierarchy()
    return {
        value
        for node in root.iter("node")
        for value in (node.attrib.get("text", ""), node.attrib.get("content-desc", ""))
        if value
    }


def assert_visible(*expected):
    actual = visible_text()
    missing = [label for label in expected if label not in actual]
    if missing:
        raise RuntimeError(
            f"Expected UI text not visible: {missing}. "
            f"Visible text: {sorted(actual)}"
        )
    print(f"Verified visible UI text: {', '.join(expected)}", flush=True)


def capture(name):
    target = OUT / name
    # exec-out avoids the remote-file + adb-pull round trip, which can stall
    # on heavily loaded hosted emulators.
    last_error = None
    for attempt in range(3):
        try:
            with target.open("wb") as output:
                subprocess.run(
                    ["adb", "exec-out", "screencap", "-p"],
                    check=True,
                    timeout=120,
                    stdout=output,
                    stderr=subprocess.PIPE,
                )
            if target.stat().st_size < 1000 or target.read_bytes()[:8] != b"\\x89PNG\\r\\n\\x1a\\n":
                raise RuntimeError(f"Invalid PNG data captured for {name}")
            print(f"Captured {name} ({target.stat().st_size} bytes)", flush=True)
            return
        except Exception as exc:
            last_error = exc
            print(f"Screenshot attempt {attempt + 1}/3 failed for {name}: {exc}", flush=True)
            subprocess.run(["adb", "reconnect"], capture_output=True, timeout=30)
            time.sleep(5)
    raise RuntimeError(f"Unable to capture {name}: {last_error}")


def screen_size():
    value = subprocess.check_output(["adb", "shell", "wm", "size"], text=True, timeout=15)
    match = re.search(r"(\d+)x(\d+)", value)
    if not match:
        raise RuntimeError(f"Cannot read emulator screen size: {value}")
    return int(match.group(1)), int(match.group(2))


def tap_text(label, fallback_x, fallback_y):
    try:
        root = hierarchy()
        candidates = [
            node for node in root.iter("node")
            if node.attrib.get("text") == label
            or node.attrib.get("content-desc") == label
        ]
        if candidates:
            # Duplicate tab labels can occur in both the heading and bottom nav.
            def bottom_edge(node):
                bounds = list(map(
                    int,
                    node.attrib["bounds"].replace("][", ",").strip("[]").split(","),
                ))
                return bounds[3], bounds

            _, bounds = max((bottom_edge(node) for node in candidates), key=lambda item: item[0])
            x = (bounds[0] + bounds[2]) // 2
            y = (bounds[1] + bounds[3]) // 2
            run(["adb", "shell", "input", "tap", str(x), str(y)], timeout=15)
            print(f"Tapped {label!r} through accessibility tree", flush=True)
            return
    except Exception as exc:
        print(f"Accessibility lookup for {label!r} failed; using coordinate fallback: {exc}", flush=True)
    run(["adb", "shell", "input", "tap", str(fallback_x), str(fallback_y)], timeout=15)


# Confirm the package process survived the initial launch and inspect fatal errors.
pid = subprocess.run(
    ["adb", "shell", "pidof", PACKAGE],
    text=True,
    capture_output=True,
    timeout=15,
)
if pid.returncode != 0 or not pid.stdout.strip():
    logcat = subprocess.run(
        ["adb", "logcat", "-d"],
        text=True,
        capture_output=True,
        timeout=30,
    ).stdout
    print(logcat[-20000:], flush=True)
    raise RuntimeError("NeuroScene process is not running after launch")

runtime_log = subprocess.run(
    ["adb", "logcat", "-d", "-s", "AndroidRuntime:E"],
    text=True,
    capture_output=True,
    timeout=30,
).stdout
if "FATAL EXCEPTION" in runtime_log or f"Process: {PACKAGE}" in runtime_log:
    raise RuntimeError(f"Fatal Android runtime exception detected:\n{runtime_log[-12000:]}")
print(f"Android process is alive: {pid.stdout.strip()}", flush=True)

# Splash is captured before waiting for the restored startup screen.
time.sleep(1)
capture("00-splash.png")
time.sleep(5)
assert_visible("Создать видео")
capture("01-create.png")

width, height = screen_size()
nav_y = height - 180
for label, index, filename, expected in [
    ("Галерея", 1, "02-gallery.png", ("Галерея", "Мои видео")),
    ("Кредиты", 2, "03-credits.png", ("Кредиты", "Пакеты кредитов")),
    ("Профиль", 3, "04-profile.png", ("Профиль", "Гость", "Войти по email")),
]:
    x = width * (2 * index + 1) // 8
    tap_text(label, x, nav_y)
    time.sleep(3)
    assert_visible(*expected)
    capture(filename)
    if label == "Профиль":
        tap_text("Войти по email", width // 2, int(height * 0.70))
        time.sleep(2)
        assert_visible("Электронная почта", "ВХОД ПО EMAIL")
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

print(f"Successfully captured {len(required)} distinct screenshots with semantic UI checks", flush=True)
