#!/usr/bin/env python3
"""Capture NeuroScene Android smoke-test screenshots using adb."""
from pathlib import Path
import re
import hashlib
import subprocess
import time
import xml.etree.ElementTree as ET

OUT = Path("screenshots")
OUT.mkdir(parents=True, exist_ok=True)


def run(args, timeout=45, **kwargs):
    return subprocess.run(args, check=True, timeout=timeout, **kwargs)


def capture(name):
    """Capture PNG directly from adb; avoid a second remote-file/pull round trip."""
    destination = OUT / name
    last_error = None

    for attempt in range(1, 4):
        try:
            with destination.open("wb") as image_file:
                run(
                    ["adb", "exec-out", "screencap", "-p"],
                    timeout=75,
                    stdout=image_file,
                    stderr=subprocess.PIPE,
                )
            size = destination.stat().st_size
            if size < 1000:
                raise RuntimeError(f"Screenshot is unexpectedly small ({size} bytes)")
            with destination.open("rb") as image_file:
                if image_file.read(8) != b"\x89PNG\r\n\x1a\n":
                    raise RuntimeError("adb screencap did not return a valid PNG")
            print(f"Captured {name} ({size} bytes)", flush=True)
            return
        except (subprocess.SubprocessError, OSError, RuntimeError) as exc:
            last_error = exc
            destination.unlink(missing_ok=True)
            print(f"Screenshot {name}: attempt {attempt}/3 failed: {exc}", flush=True)
            if attempt < 3:
                try:
                    run(["adb", "wait-for-device"], timeout=30)
                except subprocess.SubprocessError:
                    pass
                time.sleep(8 * attempt)

    raise RuntimeError(f"Unable to capture {name} after 3 attempts: {last_error}")


def screen_size():
    value = subprocess.check_output(
        ["adb", "shell", "wm", "size"], text=True, timeout=20
    )
    match = re.search(r"(\d+)x(\d+)", value)
    if not match:
        raise RuntimeError(f"Cannot read emulator screen size: {value}")
    return int(match.group(1)), int(match.group(2))


def hierarchy():
    run(
        ["adb", "shell", "uiautomator", "dump", "/data/local/tmp/window.xml"],
        timeout=30,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    raw = subprocess.check_output(
        ["adb", "shell", "cat", "/data/local/tmp/window.xml"],
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
            # Tab labels can also appear as screen headings. Choose the lowest
            # matching node so duplicate labels resolve to the bottom navigation.
            def bottom_edge(node):
                bounds = list(map(
                    int,
                    node.attrib["bounds"].replace("][", ",").strip("[]").split(","),
                ))
                return bounds[3], bounds

            _, bounds = max(
                (bottom_edge(node) for node in candidates),
                key=lambda item: item[0],
            )
            x = (bounds[0] + bounds[2]) // 2
            y = (bounds[1] + bounds[3]) // 2
            run(["adb", "shell", "input", "tap", str(x), str(y)], timeout=20)
            print(
                f"Tapped {label!r} using lowest accessibility match "
                f"({len(candidates)} matching node(s))",
                flush=True,
            )
            return
    except Exception as exc:
        print(
            f"Accessibility lookup for {label!r} unavailable; "
            f"using coordinate fallback: {exc}",
            flush=True,
        )
    run(
        ["adb", "shell", "input", "tap", str(fallback_x), str(fallback_y)],
        timeout=20,
    )


# Let Android finish booting and the app complete its initial splash transition.
time.sleep(8)
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
    time.sleep(4)
    capture(filename)
    if label == "Профиль":
        tap_text("Войти по email", width // 2, int(height * 0.70))
        time.sleep(3)
        capture("05-email-login.png")

required = [
    "00-splash.png",
    "01-create.png",
    "02-gallery.png",
    "03-credits.png",
    "04-profile.png",
    "05-email-login.png",
]
missing = [
    name for name in required
    if not (OUT / name).is_file() or (OUT / name).stat().st_size < 1000
]
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
    raise SystemExit(
        f"Some screen captures are identical; navigation may have failed: {duplicates}"
    )

print(f"Successfully captured {len(required)} distinct screenshots", flush=True)
