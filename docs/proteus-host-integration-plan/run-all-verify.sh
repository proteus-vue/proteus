#!/usr/bin/env bash
# G-41 三场景独立校验
# 场景1 工作区 / 场景2 包内 extract / 场景3 隔离目录仅有 zip
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP="$ROOT/proteus-host-integration.zip"
PASS=0; FAILN=0

run_case() {
  local name="$1" dir="$2"
  printf '\n########## 场景 %s ##########\n' "$name"
  if [ ! -f "$dir/verify.sh" ]; then
    echo "  verify.sh not found in $dir"; return 1
  fi
  ( cd "$dir" && bash verify.sh )
  local rc=$?
  if [ $rc -eq 0 ]; then echo "  --> 场景 $name: PASS"; return 0
  else echo "  --> 场景 $name: FAIL (rc=$rc)"; return 1; fi
}

# 场景 1：工作区
if run_case "1 (工作区)" "$ROOT"; then PASS=$((PASS+1)); else FAILN=$((FAILN+1)); fi

# 准备 zip
if [ ! -f "$ZIP" ]; then echo "zip not found, packing..."; ( cd "$ROOT" && bash pack.sh ) >/dev/null; fi

# 场景 2：解压到 extract 子目录
TMP2=$(mktemp -d)
rm -rf "$ROOT/extract"; mkdir -p "$ROOT/extract"
unzip -q -o "$ZIP" -d "$ROOT/extract"
if run_case "2 (包内 extract)" "$ROOT/extract"; then PASS=$((PASS+1)); else FAILN=$((FAILN+1)); fi

# 场景 3：隔离目录（仅有 zip）
TMP3=$(mktemp -d)
cp "$ZIP" "$TMP3/"
( cd "$TMP3" && unzip -q -o "$ZIP" )
if run_case "3 (隔离目录仅有 zip)" "$TMP3"; then PASS=$((PASS+1)); else FAILN=$((FAILN+1)); fi

rm -rf "$ROOT/extract" "$TMP2" "$TMP3"
printf '\n========================================\n'
printf '  三场景汇总: PASS=%s  FAIL=%s\n' "$PASS" "$FAILN"
printf '========================================\n'
[ "$FAILN" -eq 0 ] || exit 1
exit 0
