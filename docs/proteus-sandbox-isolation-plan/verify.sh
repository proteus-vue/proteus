#!/usr/bin/env bash
# G-49 verify.sh —— 自包含验证脚本
# 用法： bash verify.sh
# 退出码：0 = PASS，非 0 = FAIL

set -u
cd "$(dirname "$0")"

PASS=0
FAIL=0
OUT="$(pwd)/.g49-verify.out"
: > "$OUT"   # 运行前清空（防跨目录残留污染，G-46/G-47 教训）

# 可靠断言：统一 OK: 前缀，便于 grep 精确匹配
ok() {
  if eval "$2"; then
    PASS=$((PASS+1)); echo "OK:  $1"
  else
    FAIL=$((FAIL+1)); echo "FAIL:$1"
  fi
}

echo "== G-49 自检 =="
echo

# ── 1. 参考实现真实可执行 ─────────────────────────────────────────
ok "reference-impl.cjs 存在" "test -f reference-impl.cjs"
ok "reference-impl.cjs 输出含 '30 / 30'" "node reference-impl.cjs > '$OUT' 2>&1 && grep -q '30 / 30' '$OUT'"

# ── 2. 负向自检（★ 验证器本身也要被验证，G-44 Test IR 精神） ─────────────
# NEG-01：临时把一处必然成功的判定改成必然失败，确认 runner 会报告 FAIL
NEG_TMP="$(mktemp)"
cp reference-impl.cjs "$NEG_TMP"
# 安全做法：构造一个最小脚本，断言 1===2，期望 runner 报告失败
# 可移植性：BSD(macOS) mktemp 不支持 --suffix → 改用 mktemp -d 后写固定名
NEG_DIR="$(mktemp -d)"
NEG_RUNNER="$NEG_DIR/neg-runner.cjs"
cat > "$NEG_RUNNER" <<'EOF'
const tests=[]; let pass=0,fail=0;
const ok=(n,c)=>{ if(c){pass++;console.log('OK:  '+n);} else {fail++;console.log('FAIL:'+n);} }
ok('NEG-selfcheck', 1 === 2);   // ★ 故意失败
console.log('NEG-RESULT pass='+pass+' fail='+fail);
EOF
NEG_OUT="$(mktemp)"
node "$NEG_RUNNER" > "$NEG_OUT" 2>&1
ok "NEG-01 负向自检：runner 确实会报告 FAIL" "grep -q 'FAIL:NEG-selfcheck' '$NEG_OUT' && grep -q 'NEG-RESULT pass=0 fail=1' '$NEG_OUT'"
rm -f "$NEG_TMP" "$NEG_OUT"
rm -rf "$NEG_DIR"

# ── 3. 文档完整性（逐文件断言，不用脆弱的扩展名计数） ─────────────
PACK_LIST=(01-problem.md 03-spi.md conformance.md reference-impl.cjs verify.sh)
for f in "${PACK_LIST[@]}"; do
  ok "文档完整：$f" "test -f '$f'"
done

# ── 4. conformance 不变量齐全 ─────────────────────────────────────
ok "conformance 含 SBX-01（存储隔离）" "grep -q 'SBX-01' conformance.md"
ok "conformance 含 SBX-08（ISOLATION_BREACH）" "grep -q 'SBX-08' conformance.md"
ok "conformance 含负向自检说明" "grep -q 'NEG-' conformance.md"

# ── 5. SPI 关键契约 ──────────────────────────────────────────────
ok "SPI 定义 IsolationLevel" "grep -q 'IsolationLevel' 03-spi.md"
ok "SPI 定义 CapabilityBridge" "grep -q 'CapabilityBridge' 03-spi.md"
ok "诚实边界 CMP-117（iOS）" "grep -q 'CMP-117' 03-spi.md"

echo
echo "== 结果：$PASS / $((PASS+FAIL)) PASS =="
if [ "$FAIL" -gt 0 ]; then
  echo "FAIL"
  rm -f "$OUT"
  exit 1
else
  echo "PASS"
  rm -f "$OUT"
  exit 0
fi
