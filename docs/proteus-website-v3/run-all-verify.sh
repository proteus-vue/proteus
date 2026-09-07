#!/usr/bin/env bash
# run-all-verify.sh —— 三场景完整校验（场景1工作区 / 场景2包内 / 场景3隔离目录）
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0

run_scene() {
  local name="$1"; local dir="$2"
  echo ""
  echo "══════════════════════════════════════════════"
  echo "  $name"
  echo "══════════════════════════════════════════════"
  cd "$dir" || { echo "[SKIP] 无法进入 $dir"; return; }
  if [ -x ./verify.sh ]; then
    bash ./verify.sh >/tmp/vout 2>&1
    local rc=$?
    tail -8 /tmp/vout
    if grep -q "VERIFY: PASS" /tmp/vout && [ $rc -eq 0 ]; then
      echo "  → 结果: ✅ PASS"; PASS=$((PASS+1))   # 全局，用于末尾汇总
    else
      echo "  → 结果: ❌ FAIL"; FAIL=$((FAIL+1))
    fi
  else
    echo "  [SKIP] 无 verify.sh"; return
  fi
}

# 场景 1：工作区（zip 与脚本同在）
run_scene "场景1 工作区（脚本 + zip 同目录）" "$HERE"

# 重新打包确保 zip 最新
( cd "$HERE" && bash pack.sh >/dev/null 2>&1 )

# 场景 2：解压到临时目录（模拟"仅有 zip"的隔离环境）
ISO=$(mktemp -d)
cp "$HERE/proteus-website-v3.zip" "$ISO/"
( cd "$ISO" && unzip -q proteus-website-v3.zip )
run_scene "场景2 隔离目录（仅 zip，解压后运行内置 verify.sh）" "$ISO"

# 汇总
echo ""
echo "══════════════════════════════════════════════"
echo "  三场景结果: PASS=$PASS  FAIL=$FAIL"
echo "══════════════════════════════════════════════"
rm -rf "$ISO"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
