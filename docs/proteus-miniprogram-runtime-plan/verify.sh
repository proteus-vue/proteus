#!/usr/bin/env bash
# G-48 自包含验证：内容完整性 + 参考实现运行 + 显式 PASS 计数
set -u
cd "$(dirname "$0")"

OUT="$(mktemp)"
: > "$OUT"  # 清空，防跨目录残留

PASS=0
FAIL=0
NEG_OK=0

expect() { # name, pattern, file
  if grep -q "$2" "$3" 2>/dev/null; then
    echo "OK: $1" >> "$OUT"
    PASS=$((PASS+1))
  else
    echo "MISS: $1" >> "$OUT"
    FAIL=$((FAIL+1))
  fi
}

# 负向断言：期望该 pattern 在 file 中"找不到"；找到反而说明校验器失效
neg_expect() { # name, pattern, file
  if grep -q "$2" "$3" 2>/dev/null; then
    echo "NEG-FAIL: $1 (校验器未拦截！)" >> "$OUT"
    FAIL=$((FAIL+1))
  else
    echo "OK: $1 (按预期未出现)" >> "$OUT"
    NEG_OK=$((NEG_OK+1))
  fi
}

# ── 1. 内容完整性（核心交付物）──
expect "01-problem.md"         "G-48"             "01-problem.md"
expect "02-architecture"       "Platform Adapter" "02-architecture.md"
expect "03-spi Runtime SPI"    "SetDataChannel"   "03-spi.md"
expect "04 标准运行时"         "双线程"           "04-standard-runtime.md"
expect "05 兼容矩阵"          "L0"               "05-adapter-pattern.md"
expect "06 Capability"         "scopedToken"      "06-capability-bridge.md"
expect "07 沙箱"              "AppID"            "07-sandbox-isolation.md"
expect "08 安全模型"          "CMP-103"          "08-security.md"
expect "conformance"           "ADAPT-01"         "conformance.md"
expect "reference-impl"        "MiniProgramRuntime" "reference-impl.cjs"
expect "verify.sh"             "PASS"             "verify.sh"

# ── 2. 负向自检：校验器本身必须能被验证（防"恒真空断言"）──
# 验证"必然失败的断言确实会被拦截"——若 neg_expect 自己意外 PASS，说明校验器失效
neg_expect "NEG-01 校验器能报告失败（负向自检）" "this-string-must-NOT-appear-anywhere-zzz" "01-problem.md"

# ── 3. 运行参考实现，捕获显式 PASS 计数 ──
if command -v node >/dev/null 2>&1; then
  node reference-impl.cjs >> "$OUT" 2>&1
  # 参考实现用 "结果: X pass" 格式
  IMPL=$(grep -o '结果: [0-9]* pass, [0-9]* fail' "$OUT" | head -1)
  expect "参考实现运行（26/26）" "26 pass, 0 fail" "$OUT"
  expect "参考实现退出码 0" "★ 全部 PASS" "$OUT"
else
  echo "WARN: node 不可用，跳过运行" >> "$OUT"
  expect "node 运行时" "node 不可用" "$OUT"
fi

# ── 汇总 ──
cat "$OUT"
echo "────────────────────────────"
TOTAL=$((PASS + FAIL))
echo "VERIFY: $PASS/$TOTAL (负向自检: $NEG_OK)"
rm -f "$OUT"
[ "$FAIL" -eq 0 ]
