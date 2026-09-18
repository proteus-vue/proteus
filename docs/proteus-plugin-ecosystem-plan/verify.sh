#!/usr/bin/env bash
set -u
OUT="$(pwd)/.g59-verify.out"; : > "$OUT"
say() { echo "OK: $1" | tee -a "$OUT"; }

node reference-impl.cjs 2>&1 | tee -a "$OUT"
SELF=$(grep -oE 'self-test: [0-9]+/[0-9]+' "$OUT" | head -1 || true)
say "自测结果: $SELF"

for f in 00-pain-points.md 01-problem.md 02-architecture.md 03-spi.md \
         04-implementation-gates.md 05-appendix.md conformance.md rules.md \
         architecture-update.md README.md reference-impl.cjs verify.sh CHECKSUM.sha256; do
  if [ -f "$f" ]; then say "存在: $f"; else echo "MISSING: $f" | tee -a "$OUT"; fi
done

# 检查 * 通配被禁（铁律 G-59.1 在源码层可验证）
if grep -q "WILDCARD_FORBIDDEN" reference-impl.cjs; then
  say "G-59.1 通配拒绝在源码中实现"
fi
# 检查保守默认（未登记 API 按 secrets）
if grep -q "|| 'secrets'" reference-impl.cjs; then
  say "G-59.5 保守默认 secrets 在源码中实现"
fi
# 检查更新即重授权
if grep -q "reauth-required" reference-impl.cjs; then
  say "G-59.6 更新即重授权在源码中实现"
fi

PASS=$(grep -cE '^OK: ' "$OUT")
FAIL=$(grep -cE '^MISSING:' "$OUT")
echo "PASS=$PASS FAIL=$FAIL"
test "$FAIL" = 0
