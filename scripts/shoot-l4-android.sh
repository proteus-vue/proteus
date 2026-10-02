#!/usr/bin/env bash
# L4 screenshot capture (Android device): `shot-l4` scene -> device screen -> l4.android.png
#
# Condition-based wait (no blind sleep):
#   The app writes l4-scene.json from scene.postOnAnimation only AFTER the first frame
#   is actually drawn (onDrawCount>0). This script waits for that report file to appear
#   (bounded polling, one real adb call per round). Same discipline as the iOS side
#   (PROTEUS_EXIT_AFTER_REPORT) and the mini-program side (route + probe colors):
#   the wait is attached to "the subject really did the thing", not to wall clock time.
#
# Clean the old report first -- otherwise a stale report makes the condition
# instantly true (false green).
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
HERE="$ROOT/hosts/android"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$HERE/build/proteus-layoutcore.apk"
OUT="${PROTEUS_L4_OUT:-$ROOT/docs/generated/consistency-samples/pixels}"
REPORT="/sdcard/Android/data/$PKG/files/l4-scene.json"

[ -x "$ADB" ] || { echo "FAIL: adb not found at ${ADB}"; exit 2; }
[ -f "$APK" ] || { echo "FAIL: APK missing -- run: bash hosts/android/build-and-run.sh --no-install"; exit 2; }

echo "==> 1. install"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

echo "==> 2. clear old report + trigger scene"
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path shot-l4 -p $PKG" >/dev/null 2>&1

echo "==> 3. wait for report (bounded, no sleep)"
ready=0
for _i in $(seq 1 60); do
  if "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then ready=1; break; fi
done
if [ "$ready" != "1" ]; then
  echo "FAIL: report not written within 60 rounds ($REPORT)" >&2
  exit 1
fi

RPT="$("$ADB" shell "cat $REPORT" 2>/dev/null | tr -d '\r')"
NDRAW="$(printf '%s' "$RPT" | sed -n 's/.*"on_draw":[[:space:]]*\([0-9]*\).*/\1/p' | head -1)"
if [ -z "$NDRAW" ] || [ "$NDRAW" -le 0 ] 2>/dev/null; then
  echo "FAIL: on_draw=$NDRAW (first frame not drawn -- screenshot meaningless)" >&2
  exit 1
fi

echo "==> 4. screenshot (report already guarantees a drawn frame)"
"$ADB" exec-out screencap -p > "$OUT/l4.android.png" 2>/dev/null || true
[ -s "$OUT/l4.android.png" ] || { echo "FAIL: screenshot not captured" >&2; exit 1; }

echo "==> 5. probe colors (anti false-green)"
node "$ROOT/scripts/probe-png-colors.mjs" "$OUT/l4.android.png" "47,111,237" "124,92,255" "255,154,108" >/dev/null 2>&1 \
  || { echo "FAIL: probe colors missed (blank/error screenshot?)" >&2; exit 1; }

echo "  [l4.android] on_draw=$NDRAW size=$(ls -l "$OUT/l4.android.png" | awk '{print $5}')B sha=$(shasum -a 256 "$OUT/l4.android.png" | awk '{print substr($1,1,12)}')"
