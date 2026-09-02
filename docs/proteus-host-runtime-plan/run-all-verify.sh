#!/usr/bin/env bash
# run-all-verify.sh - 三场景独立校验 (模拟用户下载解压的真实环境)
# 场景1: 工作区 (zip + 脚本同在)
# 场景2: 包内 (解压到 extract/ 子目录)
# 场景3: 隔离目录 (仅有 zip)
set -uo pipefail
cd "$(dirname "$0")"
ROOT=$(pwd)
RC=0

# 先打包 (确保 zip 最新)
bash pack.sh >/dev/null 2>&1

run_scenario() {
  local name="$1"; shift
  echo ""
  echo "########## $name ##########"
  "$@"
  local s=$?
  if [ $s -eq 0 ]; then echo "  → PASS"; else echo "  → FAIL (rc=$s)"; RC=$((RC+1)); fi
}

# === 场景 1: 工作区 ===
sc1() {
  bash verify.sh >/dev/null 2>&1 && [ -f proteus-host-runtime.zip ]
}
run_scenario "场景 1/3 工作区" sc1

# === 场景 2: 包内 (解压到 extract/) ===
SC2="$ROOT/__sc2"
rm -rf "$SC2"; mkdir -p "$SC2"
unzip -q proteus-host-runtime.zip -d "$SC2/extract"
sc2() { ( cd "$SC2/extract" && bash verify.sh >/dev/null 2>&1 ); }
run_scenario "场景 2/3 包内" sc2

# === 场景 3: 隔离目录 (仅有 zip) ===
SC3="$ROOT/__sc3"
rm -rf "$SC3"; mkdir -p "$SC3"
cp proteus-host-runtime.zip "$SC3/"
sc3() { ( cd "$SC3" && unzip -q proteus-host-runtime.zip -d extract && cd extract && bash verify.sh >/dev/null 2>&1 ); }
run_scenario "场景 3/3 隔离目录(仅zip)" sc3

# 清理
rm -rf "$ROOT/__sc2" "$ROOT/__sc3"

echo ""
echo "########## 总计 ##########"
echo "  PASS=3  FAIL=$RC"
if [ "$RC" -gt 0 ]; then exit 1; else exit 0; fi
