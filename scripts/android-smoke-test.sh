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

# Allow the native activity and React Native bundle to initialize before
# checking the process. The capture script performs its own bounded wait too.
sleep 3
if ! adb shell pidof com.neuroscene.app > artifacts/diagnostics/app-pid.txt 2>&1; then
  adb logcat -d -v threadtime > artifacts/diagnostics/android-logcat-no-process.txt 2>&1 || true
  cat artifacts/diagnostics/launch.txt
  exit 1
fi

if ! python3 scripts/capture-android-screens.py; then
  adb logcat -d -v threadtime > artifacts/diagnostics/android-logcat-capture-failure.txt 2>&1 || true
  adb shell pidof com.neuroscene.app > artifacts/diagnostics/app-pid-after-failure.txt 2>&1 || true
  exit 1
fi
