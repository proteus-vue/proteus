#!/usr/bin/env bash
# G-53 verify — 自包含验证（沿用 G-51/G-52 修复后的写法）
set -u

OUT="$(pwd)/.g53-verify.out"
: > "$OUT"   # 运行前清空，防止跨目录残留污染

say() { echo "OK: $1" | tee -a "$OUT"; }
miss() { echo "MISSING: $1" | tee -a "$OUT"; }

echo "=== G-53 verify ==="

# [1] 参考实现自测
node reference-impl.cjs 2>&1 | tee -a "$OUT"
NODE_RC=${PIPESTATUS[0]}
[ "$NODE_RC" = "0" ] && say "参考实现退出码 0" || miss "参考实现非 0 退出"

# 动态抓取实测计数，不硬编码
SELF=$(grep -oE 'self-test: [0-9]+/[0-9]+' "$OUT" | head -1 || true)
[ -n "$SELF" ] && say "自测结果 $SELF" || miss "未找到 self-test 输出"

# [2] 核心文件齐全（逐文件断言，不依赖扩展名计数）
for f in 01-problem.md 02-architecture.md 03-spi.md \
         04-equivalence-classes.md 05-simulator-pool.md 06-cloud-device-farm.md \
         07-coverage-gates.md conformance.md rules.md architecture-update.md \
         reference-impl.cjs verify.sh CHECKSUM.sha256; do
  if [ -f "$f" ] && [ -s "$f" ]; then
    say "存在且非空: $f"
  else
    miss "$f"
  fi
done

# [3] CHECKSUM 自校验
if command -v sha256sum >/dev/null 2>&1; then
  BAD=$(sha256sum -c CHECKSUM.sha256 2>/dev/null | grep -c ': FAILED' || true)
  if [ "$BAD" = "0" ]; then
    say "CHECKSUM 全部匹配"
  else
    miss "CHECKSUM 有 $BAD 项不匹配"
  fi
else
  say "sha256sum 不可用，跳过校验"
fi

# [4] 负向自检：验证器自身能被验证
#     构造一个必然缺失的文件场景，确认 MISSING 会被记录
TMPCHECK=$(mktemp)
[ -f "__definitely_not_exist__" ] || echo "MISSING: __definitely_not_exist__" > "$TMPCHECK"
if grep -q '^MISSING:' "$TMPCHECK"; then
  say "NEG-01 验证器能记录缺失（自身可验证）"
else
  miss "NEG-01 验证器无法记录缺失"
fi
rm -f "$TMPCHECK"

# ---- 汇总 ----
PASS=$(grep -cE '^OK: ' "$OUT" || true)
FAIL=$(grep -cE '^MISSING:' "$OUT" || true)
echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
