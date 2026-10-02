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

echo "==> 2. clear old report + launch L4Activity"
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
# Launch the dedicated L4Activity (not MainActivity + broadcast):
# its Manifest theme Theme.NoTitleBar.Fullscreen removes status bar + ActionBar at COLD START,
# matching the other four ends' framing. (The runtime-hide approach introduced a relayout race:
# over-corrected to 7.4% + first-frame screenshot still showed old chrome.)
"$ADB" shell "am start -n $PKG/dev.proteus.layoutcore.L4Activity" >/dev/null 2>&1

echo "==> 3. wait for report (bounded wait, real interval -- see wait_for.sh)"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
if [ -x "$WAIT" ]; then
  # wait_for.sh is the only allowed sleep primitive in this repo (bounded poll + total timeout).
  bash "$WAIT" --cmd "$ADB shell test -f $REPORT" --timeout 90 --interval 1 || true
else
  echo "FAIL: wait_for.sh not found at $WAIT" >&2; exit 2
fi
if ! "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then
  echo "FAIL: report not written (bounded wait timed out): $REPORT" >&2
  exit 1
fi

RPT="$("$ADB" shell "cat $REPORT" 2>/dev/null | tr -d '\r')"
NDRAW="$(printf '%s' "$RPT" | sed -n 's/.*"on_draw":[[:space:]]*\([0-9]*\).*/\1/p' | head -1)"
if [ -z "$NDRAW" ] || [ "$NDRAW" -le 0 ] 2>/dev/null; then
  echo "FAIL: on_draw=$NDRAW (first frame not drawn -- screenshot meaningless)" >&2
  exit 1
fi

# ★取景判据（机器可判，不靠肉眼）: the content view must start at screen (0,0) --
# this is the direct evidence of "no system bars occupying space, framing aligned with the
# other four ends" (user report "安卓看着整体位置偏下" was exactly a framing mismatch).
ORIGIN="$(printf '%s' "$RPT" | tr -d ' \n' | sed -n 's/.*"view_origin":\[\([0-9-]*\),\([0-9-]*\)\].*/\1,\2/p')"
if [ "$ORIGIN" != "0,0" ]; then
  echo "FAIL: view_origin=${ORIGIN:-missing} (expected 0,0 -- system bars still occupying space?)" >&2
  exit 1
fi

echo "==> 4. screenshot (report already guarantees a drawn frame)"
"$ADB" exec-out screencap -p > "$OUT/l4.android.png" 2>/dev/null || true
[ -s "$OUT/l4.android.png" ] || { echo "FAIL: screenshot not captured" >&2; exit 1; }

echo "==> 5. probe colors (anti false-green)"
node "$ROOT/scripts/probe-png-colors.mjs" "$OUT/l4.android.png" "47,111,237" "124,92,255" "255,154,108" >/dev/null 2>&1 \
  || { echo "FAIL: probe colors missed (blank/error screenshot?)" >&2; exit 1; }

echo "  [l4.android] on_draw=$NDRAW size=$(ls -l "$OUT/l4.android.png" | awk '{print $5}')B sha=$(shasum -a 256 "$OUT/l4.android.png" | awk '{print substr($1,1,12)}')"
