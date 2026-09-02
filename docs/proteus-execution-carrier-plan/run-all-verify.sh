#!/usr/bin/env bash
# G-40 三场景独立校验
#   场景1: 工作区（zip + 脚本同在）
#   场景2: 解压到临时目录后的包内
#   场景3: 全新隔离目录（仅有 zip，模拟用户下载后解压）
#
# 任何场景失败 → 打印日志尾部并退出 1

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP="$DIR/proteus-execution-carrier.zip"

if [ ! -f "$ZIP" ]; then
  echo "❌ zip 不存在: $ZIP"
  echo "   请先运行: bash pack.sh"
  exit 1
fi

SC1="$DIR"
SC2=$(mktemp -d)/extract
SC3=$(mktemp -d)/extract
mkdir -p "$SC2" "$SC3"

PASS_CNT=0
FAIL_CNT=0

run_scene() {
  local name="$1"
  local dir="$2"
  echo
  echo "########## $name ##########"
  echo "目录: $dir"
  ( cd "$dir" && bash verify.sh )
  local rc=$?
  if [ $rc -eq 0 ]; then
    echo ">>> $name: PASS"
    PASS_CNT=$((PASS_CNT+1))
  else
    echo ">>> $name: FAIL (rc=$rc)"
    FAIL_CNT=$((FAIL_CNT+1))
  fi
  return 0
}

# 场景 2：解压到独立目录（避免 find 扫到 zip 本体）
unzip -q -o "$ZIP" -d "$SC2"
# 场景 3：全新隔离目录，仅有解压内容
unzip -q -o "$ZIP" -d "$SC3"

run_scene "场景1/3 工作区"      "$SC1"
run_scene "场景2/3 包内(extract)" "$SC2"
run_scene "场景3/3 隔离目录(仅zip)" "$SC3"

echo
echo "=========================================="
echo "总计: PASS=$PASS_CNT  FAIL=$FAIL_CNT"
echo "=========================================="

if [ "$FAIL_CNT" -eq 0 ]; then
  exit 0
else
  exit 1
fi
