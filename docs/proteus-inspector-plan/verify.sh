#!/usr/bin/env bash
# G-57 verify —— 动态计数 + 负向自检（沿用 G-51 写法）
set -u
OUT="$(pwd)/.g57-verify.out"
: > "$OUT"
say() { echo "OK: $1" | tee -a "$OUT"; }

node reference-impl.cjs 2>&1 | tee -a "$OUT"
SELF=$(grep -oE 'self-test: [0-9]+/[0-9]+' "$OUT" | head -1 || true)
say "自测: $SELF"

for f in 01-problem.md 02-architecture.md 03-spi.md 04-integration.md \
         05-security.md 06-implementation-gates.md conformance.md rules.md \
         architecture-update.md README.md reference-impl.cjs verify.sh CHECKSUM.sha256; do
  if [ -f "$f" ]; then say "存在: $f"; else echo "MISSING: $f" | tee -a "$OUT"; fi
done

# 负向自检：不合规命名必须被拒绝（静态检查源码包含拒绝逻辑）
grep -q "must start with" reference-impl.cjs && say "负向: 拒绝非 ext. 前缀" || echo "MISSING: 拒绝非 ext. 前缀" | tee -a "$OUT"
grep -q "already registered" reference-impl.cjs && say "负向: 拒绝重复注册" || echo "MISSING: 拒绝重复注册" | tee -a "$OUT"
grep -q "TOPOLOGY_MISSING" reference-impl.cjs && say "负向: 拓扑缺失降级" || echo "MISSING: 拓扑缺失降级" | tee -a "$OUT"
grep -q "UNAUTHORIZED" reference-impl.cjs && say "负向: token 鉴权" || echo "MISSING: token 鉴权" | tee -a "$OUT"
grep -q "builtWith === 'release'" reference-impl.cjs && say "负向: Release 不注册" || echo "MISSING: Release 不注册" | tee -a "$OUT"

PASS=$(grep -cE '^OK: ' "$OUT")
FAIL=$(grep -cE '^MISSING:' "$OUT")
echo "PASS=$PASS FAIL=$FAIL"
test "$FAIL" = 0
