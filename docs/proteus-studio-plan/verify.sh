#!/usr/bin/env bash
set -u
OUT="$(pwd)/.g56-verify.out"; : > "$OUT"
say() { echo "OK: $1" | tee -a "$OUT"; }
die() { echo "MISSING: $1" | tee -a "$OUT"; }

node reference-impl.cjs 2>&1 | tee -a "$OUT"

SELF=$(grep -oE 'self-test: [0-9]+/[0-9]+' "$OUT" | head -1 || true)
say "自测: $SELF"

# 核心文件齐全性
for f in 01-problem.md 02-architecture.md 03-spi.md \
         04-editor-integration.md 05-mobile-companion.md 06-risks-degradation.md \
         07-ecosystem-compat.md conformance.md rules.md architecture-update.md \
         README.md reference-impl.cjs verify.sh CHECKSUM.sha256; do
  test -f "$f" && say "存在: $f" || die "$f"
done

# 编号连续性（排除表头与命名空间误匹配）
echo "--- 编号检查 ---"
IRON=$(grep -cE '^### G-56\.[0-9]+' rules.md)
say "铁律条数: $IRON"
CMP=$(grep -oE 'CMP-1[0-9]{2}' conformance.md rules.md | grep -oE 'CMP-1[0-9]{2}' | sort -u | wc -l)
say "CMP 唯一编号数: $CMP"
AP=$(grep -cE '^\| \*\*AP-ST-' rules.md)
say "反模式条数: $AP"

# 红线检查：文档不得出现"自研编辑器内核"的允许表述
if grep -qE '允许自研编辑器|decision.*build.*editor-core' reference-impl.cjs conformance.md 2>/dev/null; then
  echo "MISSING: 检测到违反 G-56.1 红线的表述" | tee -a "$OUT"
else
  say "G-56.1 红线未被违反"
fi

PASS=$(grep -cE '^OK: ' "$OUT"); FAIL=$(grep -cE '^MISSING: ' "$OUT")
echo "PASS=$PASS FAIL=$FAIL"
test "$FAIL" = 0
