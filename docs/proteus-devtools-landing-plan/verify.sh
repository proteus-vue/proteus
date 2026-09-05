#!/usr/bin/env bash
# G-55 自包含验证（沿用 G-51/G-52 修复后的断言写法）
set -u
OUT="$(pwd)/.g55-verify.out"; : > "$OUT"
say() { echo "OK: $1" | tee -a "$OUT"; }

node reference-impl.cjs 2>&1 | tee -a "$OUT"

SELF=$(grep -oE 'self-test: [0-9]+/[0-9]+' "$OUT" | head -1 || true)
say "自测: $SELF"

for f in 01-problem.md 02-architecture.md 03-spi.md 04-host-adapters.md \
         05-performance-budget.md 06-kernel-daemon.md conformance.md rules.md \
         architecture-update.md README.md reference-impl.cjs verify.sh CHECKSUM.sha256; do
  test -f "$f" && say "存在: $f" || echo "MISSING: $f" | tee -a "$OUT"
done

say "自测计数已抓取: $SELF"

PASS=$(grep -cE '^OK: ' "$OUT"); FAIL=$(grep -cE '^MISSING:' "$OUT")
echo "PASS=$PASS FAIL=$FAIL"
test "$FAIL" = 0
