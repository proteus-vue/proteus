#!/usr/bin/env bash
# G-42 三场景独立校验
# 场景 1: 工作区（zip + 脚本同在）
# 场景 2: 包内（解压到 extract 子目录后运行）
# 场景 3: 隔离目录（仅有 zip，模拟用户下载后解压）
# 修改: 按步骤结算统计，任一场景失败即退出 1

set -u
cd "$(dirname "$0")" || exit 1

ZIP="proteus-host-container.zip"
TMPROOT=$(mktemp -d)
PASS=0; FAIL=0

cleanup() { rm -rf "$TMPROOT"; }
trap cleanup EXIT

run_scene() {
  local n="$1" d="$2"
  echo "########## 场景 $n ##########"
  echo "目录: $d"

  if [ ! -f "$d/verify.sh" ]; then
    echo "✗ verify.sh 不存在于 $d"
    ls -A "$d" 2>/dev/null | sed 's/^/    /'
    return 1
  fi

  local out
  out=$(cd "$d" && bash verify.sh 2>&1)
  local rc=$?
  echo "$out" | sed 's/^/  /'

  if [ $rc -eq 0 ] && echo "$out" | grep -q "VERIFY: PASS"; then
    echo "  → 场景 $n: PASS"
    return 0
  else
    echo "  → 场景 $n: FAIL (rc=$rc)"
    echo "$out" | grep -E '✗|❌|FAIL' | head -10 | sed 's/^/    /'
    return 1
  fi
}

# ---------- 场景 1: 工作区 ----------
if run_scene 1 "$(pwd)"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
echo ""

# ---------- 准备 zip ----------
if [ ! -f "$ZIP" ]; then
  echo "zip 不存在，先打包..."
  bash pack.sh || { echo "打包失败"; exit 1; }
fi

# ---------- 场景 2: 包内（解压到 extract 子目录）----------
SC2="$TMPROOT/scene2"
mkdir -p "$SC2/extract"
unzip -q -o "$ZIP" -d "$SC2/extract" 2>/dev/null
if [ $? -ne 0 ]; then
  echo "场景 2: 解压失败"; FAIL=$((FAIL+1))
else
  if run_scene 2 "$SC2/extract"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
fi
echo ""

# ---------- 场景 3: 隔离目录（仅有 zip）----------
SC3="$TMPROOT/scene3"
mkdir -p "$SC3"
cp "$ZIP" "$SC3/" 2>/dev/null
(
  cd "$SC3" || exit 1
  unzip -q -o "$ZIP" 2>/dev/null || { echo "场景 3 解压失败"; exit 1; }
  rm -f "$ZIP"   # 完全隔离：只剩解压出来的内容
  echo "解压后文件:"
  ls -A . | sed 's/^/    /'
)
if [ -f "$SC3/verify.sh" ]; then
  if run_scene 3 "$SC3"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
else
  echo "场景 3: verify.sh 未解压出来"; FAIL=$((FAIL+1))
fi

echo ""
echo "=========================================="
echo "三场景汇总: PASS=$PASS  FAIL=$FAIL"
echo "=========================================="

if [ "$FAIL" -eq 0 ]; then
  echo "全部通过 ✅"
  exit 0
else
  echo "存在失败场景 ❌"
  exit 1
fi
