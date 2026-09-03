#!/usr/bin/env bash
# G-43 三场景独立校验
#   场景1：工作区（zip + 脚本同在）
#   场景2：包内（解压到 extract 子目录）
#   场景3：隔离目录（仅有 zip，模拟用户下载后解压）
set -u
cd "$(dirname "$0")" || exit 1

ZIP="proteus-ownership.zip"
TOTAL_PASS=0
TOTAL_FAIL=0
TMPBASE=$(mktemp -d)

cleanup() { rm -rf "$TMPBASE"; }
trap cleanup EXIT

run_scene() {
  local name="$1" dir="$2"
  echo ""
  echo "########## 场景：$name ##########"
  if [ ! -f "$dir/verify.sh" ]; then
    echo "  ✗ verify.sh 不存在于 $dir"; TOTAL_FAIL=$((TOTAL_FAIL+1)); return
  fi
  local out rc
  out=$(cd "$dir" && bash verify.sh 2>&1); rc=$?
  echo "$out" | sed 's/^/  /'
  if [ $rc -eq 0 ]; then
    echo "  >>> 场景 PASS"
    TOTAL_PASS=$((TOTAL_PASS+1))
  else
    echo "  >>> 场景 FAIL (rc=$rc)"
    TOTAL_FAIL=$((TOTAL_FAIL+1))
  fi
}

# 场景1：工作区
run_scene "1/3 工作区" "$(pwd)"

# 场景2：包内 extract
S2="$TMPBASE/s2"
mkdir -p "$S2"
if [ -f "$ZIP" ]; then
  unzip -q -o "$ZIP" -d "$S2" 2>/dev/null
  run_scene "2/3 包内(extract)" "$S2"
else
  echo "  ✗ zip 不存在"; TOTAL_FAIL=$((TOTAL_FAIL+1))
fi

# 场景3：隔离目录（仅有 zip）
S3="$TMPBASE/s3"
mkdir -p "$S3"
if [ -f "$ZIP" ]; then
  cp "$ZIP" "$S3/"
  ( cd "$S3" && unzip -q -o "$ZIP" >/dev/null 2>&1 )
  run_scene "3/3 隔离目录(仅zip)" "$S3"
fi

echo ""
echo "======================================"
echo "三场景汇总：PASS=$TOTAL_PASS  FAIL=$TOTAL_FAIL"
echo "======================================"
[ "$TOTAL_FAIL" -eq 0 ] || exit 1
exit 0
