#!/usr/bin/env bash
# 三场景独立校验：场景1(工作区) / 场景2(包内) / 场景3(隔离目录仅有zip)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP="$(cd "$ROOT/.." && pwd)/proteus-compiler-backend-spi.zip"

TMP="$(mktemp -d)"
trap "rm -rf $TMP" EXIT

run_scenario() {
  local name="$1"; shift
  echo ""
  echo "########## 场景 $name ##########"
  ( "$@" )
  local rc=$?
  if [ $rc = 0 ]; then
    echo "  → $name: PASS"
    return 0
  else
    echo "  → $name: FAIL (rc=$rc)"
    return 1
  fi
}

# 场景 1：工作区
scenario_1() {
  cd "$ROOT"
  bash verify.sh
}

# 场景 2：包内（解压到子目录，zip 本体不留在扫描根）
SC2="$TMP/scene2"
mkdir -p "$SC2/extract"
cp "$ZIP" "$SC2/"
( cd "$SC2/extract" && unzip -o -q "$SC2/$(basename "$ZIP")" && bash verify.sh )

# 场景 3：隔离目录仅有 zip（解压到子目录，避免 zip 本体被 find 判为多余）
SC3="$TMP/scene3"
mkdir -p "$SC3/extract"
cp "$ZIP" "$SC3/"
( cd "$SC3/extract" && unzip -o -q "$SC3/$(basename "$ZIP")" && bash verify.sh )

pass=0; fail=0
run_scenario 1 scenario_1 && pass=$((pass+1)) || fail=$((fail+1))
run_scenario 2 bash -c "cd $SC2/extract && bash verify.sh" && pass=$((pass+1)) || fail=$((fail+1))
run_scenario 3 bash -c "cd $SC3/extract && bash verify.sh" && pass=$((pass+1)) || fail=$((fail+1))

echo ""
echo "─────────────────────────────"
echo "总计：3 场景 · PASS=$pass · FAIL=$fail"
[ $fail = 0 ] && exit 0 || exit 1
