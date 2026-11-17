#!/bin/sh
# Run the complete Android smoke test as one process. The emulator-runner
# action executes each line of its script input separately, so compound shell
# control flow must live in a checked-in script file.
set -eu

mkdir -p artifacts/diagnostics screenshots
trap 'adb logcat -d -v threadtime > artifacts/diagnostics/android-logcat-final.txt 2>&1 || true' EXIT

adb wait-for-device
adb logcat -c

if ! adb install -r artifacts/app-release.apk > artifacts/diagnostics/install.txt 2>&1; then
  cat artifacts/diagnostics/install.txt
  adb logcat -d -v threadtime > artifacts/diagnostics/android-logcat-install-failure.txt 2>&1 || true
  exit 1
fi

if ! adb shell monkey -p com.neuroscene.app -c android.intent.category.LAUNCHER 1 > artifacts/diagnostics/launch.txt 2>&1; then
  cat artifacts/diagnostics/launch.txt
  adb logcat -d -v threadtime > artifacts/diagnostics/android-logcat-launch-failure.txt 2>&1 || true
  exit 1
fi

# Give a slow emulator up to 60 seconds to start the app before declaring
# that the process failed. Save the PID once it appears.
pid=""
attempt=0
while [ "$attempt" -lt 60 ]; do
  pid="$(adb shell pidof com.neuroscene.app 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    printf '%s\n' "$pid" > artifacts/diagnostics/app-pid.txt
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ -z "$pid" ]; then
  adb logcat -d -v threadtime > artifacts/diagnostics/android-logcat-no-process.txt 2>&1 || true
  cat artifacts/diagnostics/launch.txt
  exit 1
fi

if ! python3 scripts/capture-android-screens.py; then
  adb logcat -d -v threadtime > artifacts/diagnostics/android-logcat-capture-failure.txt 2>&1 || true
  adb shell pidof com.neuroscene.app > artifacts/diagnostics/app-pid-after-failure.txt 2>&1 || true
  exit 1
fi
