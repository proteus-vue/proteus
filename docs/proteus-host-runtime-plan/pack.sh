#!/usr/bin/env bash
# pack.sh - 打包 G-39 (读 MANIFEST 作唯一事实源, 杜绝漏打)
set -euo pipefail
cd "$(dirname "$0")"

OUT="${1:-proteus-host-runtime.zip}"
rm -f "$OUT" CHECKSUM.md

# 读 MANIFEST（★兼容 bash 3.2，不用 mapfile）
FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(grep -v '^#' MANIFEST | grep -v '^$')
echo "MANIFEST 条目: ${#FILES[@]}"

# 生成 CHECKSUM.md (先生成, 让它也进包)
: > CHECKSUM.md
for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "⚠ 缺失: $f (跳过)"; continue; }
  printf '  %s  %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$f" >> CHECKSUM.md
done
echo "CHECKSUM.md 已生成 ($(wc -l < CHECKSUM.md) 行)"

# 用 store 模式打包 (不压缩, 避免编码/CRC 问题导致下载出错)
# ★ 关键: MANIFEST 本身也要进包 (之前漏打的 root cause)
zip -X -n .md:.sh:.js:.json:.html "$OUT" MANIFEST CHECKSUM.md "${FILES[@]}"

echo ""
echo "打包完成: $OUT"
unzip -l "$OUT"
echo ""
echo "校验包完整性:"
unzip -t "$OUT" | tail -3
