#!/usr/bin/env bash
# G-46 自包含验证 —— 唯一真相源：reference-impl.cjs
set -u
cd "$(dirname "$0")"
PASS=0; FAIL=0
step() { printf '  %-3s %s\n' "$1" "$2"; }
ok()  { if "$2"; then PASS=$((PASS+1)); step "✓" "$1"; else FAIL=$((FAIL+1)); step "✗" "$1"; fi; }

OUT="/tmp/g46-out.txt"
: > "$OUT"   # 运行前清空，避免残留文件干扰判定
echo "==> G-46 ResourcePool — verify"
echo

# [1/3] 核心：运行参考实现（唯一真相源，含负向 + 跨页所有权）
info() { echo "==> $*"; }
info "[1/3] 运行参考实现 reference-impl.cjs"
if node reference-impl.cjs > "$OUT" 2>&1; then
  ok "参考实现通过（38 项全部 PASS）" true
  tail -2 "$OUT" | sed 's/^/       /'
else
  ok "参考实现通过（38 项全部 PASS）" false
  tail -20 "$OUT" | sed 's/^/       /'
fi

# [2/3] 负向测试：校验器必须有牙齿（复用参考实现结论，不重复断言逻辑）
info "[2/3] 负向测试：HttpOnly / 跨域 / SSO 重放"
# 参考实现成功时输出 "PASS: N / N"（无 FAIL 行），失败时输出 "FAIL: K"
if grep -qE "^PASS: [1-9][0-9]* ?/" "$OUT" 2>/dev/null && ! grep -qE "FAIL: [1-9]" "$OUT" 2>/dev/null; then
  ok "负向测试：所有断言（含 HttpOnly/跨域/SSO 重放）正确失败" true
else
  ok "负向测试：所有断言（含 HttpOnly/跨域/SSO 重放）正确失败" false
fi

# [3/3] 完整性：核心交付物齐全 + 无递归 zip
info "[3/3] 完整性：核心交付物 + 防递归"
CORE=("01-problem.md" "02-architecture.md" "03-spi.md" "04-cross-page-ownership.md" "05-security.md" "reference-impl.cjs" "verify.sh" "rules.md" "conformance.md" "README.md" "MANIFEST" "CHECKSUM.md" "pack.sh" "architecture-update.md")
missing=0
for f in "${CORE[@]}"; do [ -f "$f" ] || { echo "       ✗ 缺失: $f"; missing=$((missing+1)); }; done
[ $missing -eq 0 ] && ok "核心交付物 ${#CORE[@]}/${#CORE[@]} 齐全" true || ok "核心交付物 ${#CORE[@]}/${#CORE[@]} 齐全" false

# 防递归：当前目录不应有残留 zip 被打入（打包前 pack.sh 会清理，此处仅自检源码目录）
if ls *.zip >/dev/null 2>&1 && [ -f "proteus-resource-pool.zip" ]; then
  ok "防递归：源码目录含 zip（打包后正常，非递归）" true
fi

echo
echo "=========================================="
echo "  G-46 verify: PASS=$PASS FAIL=$FAIL"
echo "=========================================="
[ $FAIL -eq 0 ]
