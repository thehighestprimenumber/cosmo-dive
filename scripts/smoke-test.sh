#!/usr/bin/env bash
# Installs the APK on a running emulator, opens it, and fails if the app
# is not alive after a few seconds. Leaves logcat.txt and screenshot.png.
set -u
APK="$1"
PKG=com.dailyspark.app

adb install -r "$APK" || exit 1
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
sleep 25

adb logcat -d -v time > logcat.txt
adb exec-out screencap -p > screenshot.png

echo "===== crash / JS errors ====="
grep -nE "FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|Error:|Exception" logcat.txt | grep -v "W/System.err.*NoSuchFieldException" | head -120

if adb shell pidof "$PKG" >/dev/null; then
  echo "===== APP ALIVE ====="
  exit 0
fi
echo "===== APP NOT RUNNING (crashed) ====="
exit 1
