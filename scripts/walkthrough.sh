#!/usr/bin/env bash
# Walks through the app on the emulator like a first-time user (demo data):
# onboarding → Today → Calendar → Settings → Diagnostics, with a screenshot
# of every step in shots/. Run after smoke-test.sh, with the app open.
set -euo pipefail
PKG=com.dailyspark.app
UI="python3 scripts/ui.py"

alive() { adb shell pidof "$PKG" >/dev/null || { echo "APP DIED after: $1"; exit 1; }; }

# Avoid the Android 13+ notification permission dialog covering the app.
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true

$UI shot 01-onboarding
$UI tap "Try with demo data"
$UI wait "✅ Using demo data"
alive "choosing demo data"

$UI tap-input 0
adb shell input text 40
# Hide the keyboard (BACK only while it is showing, so we don't leave the screen).
if adb shell dumpsys input_method | grep -q "mInputShown=true"; then adb shell input keyevent 4; sleep 1; fi
$UI wait "Estimated max heart rate"
$UI shot 02-onboarding-filled

$UI scroll-to "Start my plan"
$UI wait "day streak" 40
alive "starting the plan"
$UI shot 03-today

$UI tap "Calendar"
$UI wait "Saved by a freeze"
alive "opening Calendar"
$UI shot 04-calendar

$UI tap "Settings"
$UI wait "Rest days"
alive "opening Settings"
$UI shot 05-settings

$UI scroll-to "Diagnostics"
$UI wait "Data source" 30
alive "opening Diagnostics"
$UI shot 06-diagnostics

echo "===== WALKTHROUGH PASSED ====="
