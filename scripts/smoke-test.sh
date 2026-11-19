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

if ! adb shell pidof "$PKG" >/dev/null; then
  echo "===== APP NOT RUNNING (crashed) ====="
  exit 1
fi
echo "===== APP ALIVE ====="

# The first screen (onboarding) must actually render, not just a blank window.
adb shell uiautomator dump /sdcard/ui.xml >/dev/null && adb pull /sdcard/ui.xml ui.xml >/dev/null
if grep -q "Daily Spark" ui.xml; then
  echo "===== ONBOARDING RENDERED ====="
  exit 0
fi
echo "===== APP RUNNING BUT ONBOARDING NOT FOUND ON SCREEN ====="
grep -o 'text="[^"]*"' ui.xml | head -40
exit 1
