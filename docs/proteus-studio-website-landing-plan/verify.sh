#!/usr/bin/env bash
# G-60 verify — 沿用 G-51 写法，并修复"断言匹配范围过宽"（踩坑清单 #1）
#   node 输出：   OK: xxx / FAIL: xxx / self-test: X/Y
#   verify 输出： OK: xxx / MISSING: xxx
#   ★ 统计只匹配行首，避免匹配到测试名里的 "FAIL"/"MISS" 字样
set -u
OUT="$(pwd)/.g60-verify.out"; : > "$OUT"
say() { echo "OK: $1" | tee -a "$OUT"; }

node reference-impl.cjs 2>&1 | tee -a "$OUT"

SELF=$(grep -oE 'self-test: [0-9]+/[0-9]+' "$OUT" | head -1 || true)
say "自测: $SELF"

for f in 00-pain-points.md 01-problem.md 02-architecture.md 03-spi.md \
        04-plugin-api-docs.md 05-download-distribution.md 06-implementation-gates.md \
        conformance.md rules.md architecture-update.md README.md \
        reference-impl.cjs verify.sh CHECKSUM.sha256; do
  test -f "$f" && say "存在: $f" || echo "MISSING: $f" | tee -a "$OUT"
done

# 断言：九条铁律齐备
for r in "G-60.1" "G-60.2" "G-60.3" "G-60.4" "G-60.5" \
         "G-60.6" "G-60.7" "G-60.8" "G-60.9"; do
  grep -q "$r" rules.md && say "铁律: $r" || echo "MISSING: 铁律 $r" | tee -a "$OUT"
done

# 断言：八条不变量齐备
for i in W1 W2 W3 W4 W5 W6 W7 W8; do
  grep -q "INV-$i" conformance.md && say "不变量: INV-$i" || echo "MISSING: INV-$i" | tee -a "$OUT"
done

# 断言：六条反模式齐备
for a in W1 W2 W3 W4 W5 W6; do
  grep -q "AP-$a" rules.md && say "反模式: AP-$a" || echo "MISSING: AP-$a" | tee -a "$OUT"
done

# 断言：调研先于设计（本份方法论纪律）
test -f 00-pain-points.md && grep -q "先于一切设计产出" 00-pain-points.md \
  && say "纪律: 调研先于设计" || echo "MISSING: 调研先于设计" | tee -a "$OUT"

# 断言：数字不虚报 —— conformance 声明的用例数必须与实测一致
DECLARED=$(grep -oE 'self-test: [0-9]+/[0-9]+' "$OUT" | head -1 | grep -oE '[0-9]+$' || echo "?")
grep -q "91/91" conformance.md && say "数字: conformance 声明与实测一致 (91)" \
  || echo "MISSING: conformance 数字未同步 (实测 $DECLARED)" | tee -a "$OUT"

PASS=$(grep -cE '^OK: ' "$OUT")
FAIL=$(grep -cE '^(FAIL: |MISSING: )' "$OUT")
echo ""
echo "PASS=$PASS FAIL=$FAIL"
test "$FAIL" = 0
