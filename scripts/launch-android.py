#!/usr/bin/env python3
"""Wait for Android system services and reliably launch NeuroScene."""
import subprocess
import time

PACKAGE = "com.neuroscene.app"


def adb(*args, timeout=45):
    return subprocess.run(
        ["adb", *args],
        text=True,
        capture_output=True,
        timeout=timeout,
    )


deadline = time.monotonic() + 240
ready = False
last_state = ""
while time.monotonic() < deadline:
    boot = adb("shell", "getprop", "sys.boot_completed")
    activity = adb("shell", "service", "check", "activity")
    package = adb("shell", "pm", "path", PACKAGE)
    last_state = (
        f"boot={boot.stdout.strip()!r}; "
        f"activity={activity.stdout.strip()!r}; "
        f"package={package.stdout.strip()!r}"
    )
    if (
        boot.returncode == 0
        and boot.stdout.strip() == "1"
        and activity.returncode == 0
        and "found" in activity.stdout.lower()
        and package.returncode == 0
        and "package:" in package.stdout
    ):
        ready = True
        break
    print(f"Waiting for Android services: {last_state}", flush=True)
    time.sleep(10)

if not ready:
    logs = adb("logcat", "-d", "-t", "500", timeout=60).stdout
    raise RuntimeError(f"Android services did not become ready: {last_state}\n{logs[-12000:]}")

print(f"Android services ready: {last_state}", flush=True)
launched = False
for attempt in range(1, 4):
    result = adb(
        "shell", "am", "start",
        "-a", "android.intent.action.MAIN",
        "-c", "android.intent.category.LAUNCHER",
        "-p", PACKAGE,
        timeout=90,
    )
    print(
        f"Launch attempt {attempt}: exit={result.returncode}; "
        f"stdout={result.stdout.strip()!r}; stderr={result.stderr.strip()!r}",
        flush=True,
    )
    time.sleep(12)
    pid = adb("shell", "pidof", PACKAGE)
    if pid.returncode == 0 and pid.stdout.strip():
        print(f"NeuroScene process started: {pid.stdout.strip()}", flush=True)
        launched = True
        break
    time.sleep(8)

if not launched:
    logs = adb("logcat", "-d", "-t", "1000", timeout=60).stdout
    raise RuntimeError(f"NeuroScene did not start. Recent Android logs:\n{logs[-16000:]}")
