#!/usr/bin/env bash
set -u
OUT="$(pwd)/.g54-verify.out"; : > "$OUT"
say() { echo "OK: $1" | tee -a "$OUT"; }

node reference-impl.cjs 2>&1 | tee -a "$OUT"

SELF=$(grep -oE 'self-test: [0-9]+/[0-9]+' "$OUT" | head -1 || true)
say "自测: $SELF"

for f in 01-problem.md 02-architecture.md 03-spi.md 04-capabilities.md \
        05-ide-adapters.md 06-integration.md conformance.md rules.md \
        architecture-update.md reference-impl.cjs verify.sh README.md CHECKSUM.sha256; do
  test -f "$f" && say "存在: $f" || echo "MISSING: $f" | tee -a "$OUT"
done

# 内核唯一性：只允许一处 class FrameworkKnowledgeProvider
KERNEL=$(grep -c 'class FrameworkKnowledgeProvider' reference-impl.cjs)
say "内核定义处数: $KERNEL (应为 1)"

# G-54.2 适配器零业务逻辑：LspAdapter/RpcAdapter 内不得出现业务判定
if grep -qE 'LAYER_VIOLATION' <(sed -n '/class LspAdapter/,/^}/p' reference-impl.cjs); then
  echo "MISSING: 适配器混入业务逻辑" | tee -a "$OUT"
else
  say "G-54.2 适配器零业务逻辑"
fi

# 编号连续性
say "CMP 编号: $(grep -oE 'CMP-1[0-9]+' conformance.md | sort -u | tr '\n' ' ')"

PASS=$(grep -cE '^OK: ' "$OUT")
FAIL=$(grep -cE '^(MISSING:|FAIL:)' "$OUT")
echo "PASS=$PASS FAIL=$FAIL"
test "$FAIL" = 0
