#!/usr/bin/env python3
"""Android UI smoke test: assert real app content, preserve diagnostics."""
from pathlib import Path
import hashlib
import subprocess
import time
import xml.etree.ElementTree as ET

OUT = Path("screenshots")
REMOTE = "/data/local/tmp"
OUT.mkdir(parents=True, exist_ok=True)

def run(args, timeout=45, **kwargs):
    return subprocess.run(args, check=True, timeout=timeout, **kwargs)

def adb(*args, timeout=30):
    return subprocess.check_output(["adb", *args], text=True, timeout=timeout, stderr=subprocess.STDOUT)

def dump_hierarchy():
    run(["adb", "shell", "uiautomator", "dump", f"{REMOTE}/window.xml"], timeout=60,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    raw = adb("shell", "cat", f"{REMOTE}/window.xml")
    (OUT / "window.xml").write_text(raw, encoding="utf-8")
    root = ET.fromstring(raw)
    return root, " ".join(
        " ".join((n.attrib.get("text", ""), n.attrib.get("content-desc", ""))).strip()
        for n in root.iter("node")
    )

def save_diagnostics(tag):
    try:
        log = adb("logcat", "-d", "-v", "threadtime", "-t", "5000", timeout=60)
        (OUT / f"logcat-{tag}.txt").write_text(log, encoding="utf-8")
    except Exception as exc:
        (OUT / f"logcat-{tag}.txt").write_text(f"logcat collection failed: {exc}", encoding="utf-8")

def wait_for_text(expected, timeout=35):
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        try:
            _, last = dump_hierarchy()
            if expected in last:
                return last
            if "isn't responding" in last or "не отвечает" in last.lower():
                raise RuntimeError(f"Android ANR dialog detected: {last[:1200]}")
        except RuntimeError:
            raise
        except Exception:
            pass
        time.sleep(2)
    save_diagnostics("failure")
    raise RuntimeError(f"Expected visible UI text {expected!r} not found within {timeout}s. Last hierarchy: {last[:2000]}")

def capture(name):
    remote = f"{REMOTE}/{name}"
    run(["adb", "shell", "screencap", "-p", remote])
    run(["adb", "pull", remote, str(OUT / name)])
    print(f"Captured {name}", flush=True)

def tap_text(label):
    root, _ = dump_hierarchy()
    matches = []
    for node in root.iter("node"):
        if node.attrib.get("text") == label or node.attrib.get("content-desc") == label:
            bounds = [int(x) for x in node.attrib["bounds"].replace("][", ",").strip("[]").split(",")]
            matches.append((bounds[3], bounds))
    if not matches:
        raise RuntimeError(f"Navigation control {label!r} not found in accessibility hierarchy")
    _, b = max(matches, key=lambda x: x[0])
    run(["adb", "shell", "input", "tap", str((b[0]+b[2])//2), str((b[1]+b[3])//2)])

# Launch and wait for actual splash, not just an arbitrary screenshot.
wait_for_text("Нейро", timeout=45)
capture("00-splash.png")
wait_for_text("Создать видео", timeout=45)
capture("01-create.png")

for label, expected, filename in [
    ("Галерея", "Галерея", "02-gallery.png"),
    ("Кредиты", "Кредиты", "03-credits.png"),
    ("Профиль", "Профиль", "04-profile.png"),
]:
    tap_text(label)
    wait_for_text(expected, timeout=25)
    capture(filename)
    if label == "Профиль":
        wait_for_text("Войти по email", timeout=15)
        tap_text("Войти по email")
        wait_for_text("ВОЙТИ ПО EMAIL", timeout=20)
        capture("05-email-login.png")

save_diagnostics("success")
required = ["00-splash.png", "01-create.png", "02-gallery.png", "03-credits.png", "04-profile.png", "05-email-login.png"]
for name in required:
    path = OUT / name
    if not path.is_file() or path.stat().st_size < 1000:
        raise RuntimeError(f"Missing/invalid screenshot: {name}")
hashes = {name: hashlib.sha256((OUT/name).read_bytes()).hexdigest() for name in required}
if len(set(hashes.values())) != len(required):
    raise RuntimeError(f"Duplicate screen captures: {hashes}")
print("PASS: all six screens contain their expected visible text; diagnostics saved.", flush=True)
