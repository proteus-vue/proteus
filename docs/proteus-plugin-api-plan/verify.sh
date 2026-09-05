#!/usr/bin/env bash
# G-58 verify — 动态计数 + 文件存在性 + 编号一致性
# 注意：FAIL 统计只匹配行首，避免误命中用例名中的字样（G-52 踩坑清单 #3）
set -u
OUT="$(pwd)/.g58-verify.out"; : > "$OUT"
say() { echo "OK: $1" | tee -a "$OUT"; }
miss() { echo "MISSING: $1" | tee -a "$OUT"; }

# ---- 1. 参考实现 ----
if node reference-impl.cjs > /tmp/g58-run.out 2>&1; then
  say "reference-impl.cjs 运行成功 (exit 0)"
else
  echo "FAILRUN: reference-impl.cjs 非零退出" | tee -a "$OUT"
fi
SELF=$(grep -oE 'self-test: [0-9]+/[0-9]+' /tmp/g58-run.out | head -1 || true)
say "自测结果: ${SELF:-未捕获}"
grep -E '^OK: ' /tmp/g58-run.out | sed 's/^/  /' >> "$OUT"

# ---- 2. 文件存在性 ----
for f in 01-problem.md 02-architecture.md 03-spi.md 04-capability-model.md \
         05-api-versioning.md 06-risks-degradation.md conformance.md rules.md \
         architecture-update.md reference-impl.cjs verify.sh README.md CHECKSUM.sha256; do
  if [ -f "$f" ]; then say "存在: $f"; else miss "$f"; fi
done

# ---- 3. 编号一致性 ----
for n in 187 188 189 190 191 192 193 194; do
  if grep -q "CMP-$n" conformance.md rules.md 2>/dev/null; then
    say "CMP-$n 已登记"
  else
    miss "CMP-$n 未登记"
  fi
done

for i in 1 2 3 4 5 6 7 8; do
  if grep -q "G-58.$i" rules.md 2>/dev/null; then
    say "铁律 G-58.$i 已定义"
  else
    miss "铁律 G-58.$i 缺失"
  fi
done

for i in 01 02 03 04 05 06 07; do
  if grep -q "AP-EX-$i" rules.md 2>/dev/null; then
    say "反模式 AP-EX-$i 已定义"
  else
    miss "反模式 AP-EX-$i 缺失"
  fi
done

# ---- 4. 红线断言 ----
if grep -q "G-58.1" rules.md && grep -q "不给降级路径" rules.md; then
  say "G-58.1 红线未被违反（明确无降级）"
else
  miss "G-58.1 红线声明"
fi

# ---- 5. CHECKSUM 自校验 ----
if [ -f CHECKSUM.sha256 ]; then
  if shasum -a 256 -c CHECKSUM.sha256 > /tmp/g58-sum.out 2>&1; then
    say "CHECKSUM 全部匹配"
  else
    echo "MISMATCH: CHECKSUM 校验失败" | tee -a "$OUT"
  fi
  echo "  $(grep -c 'OK$' /tmp/g58-sum.out) 个文件哈希匹配"
fi

# ---- 6. 统计（只统计行首，避免误命中）----
PASS=$(grep -cE '^OK: ' "$OUT" || true)
FAIL=$(grep -cE '^(MISSING|MISMATCH|FAILRUN): ' "$OUT" || true)
echo "PASS=$PASS FAIL=$FAIL"
test "${FAIL:-0}" = 0
