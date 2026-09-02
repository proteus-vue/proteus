#!/usr/bin/env bash
# 打包脚本：先生成 CHECKSUM.md，再按 MANIFEST 白名单打包（MANIFEST 本身也进包）
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

OUT="${1:-../proteus-compiler-backend-spi.zip}"

# 1) 生成 CHECKSUM.md
: > CHECKSUM.md
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ "$f" = "CHECKSUM.md" ] && continue
  [ ! -f "$f" ] && { echo "WARN: MANIFEST 引用 $f 不存在"; continue; }
  sha256sum "$f" >> CHECKSUM.md
done < MANIFEST
echo "CHECKSUM.md 已生成（$(wc -l < CHECKSUM.md) 条）"

# 2) 打包：MANIFEST 本身 + 其内容 + CHECKSUM.md
rm -f "$OUT"
CONTENT=$(grep -v '^#' MANIFEST | grep -v '^$' | tr '\n' ' ')
zip -X -r "$OUT" MANIFEST $CONTENT CHECKSUM.md
echo ""
echo "打包完成：$OUT"
echo "条目数：$(unzip -l "$OUT" | grep -cE '[^ ]+\.md$|[^ ]+\.sh$|MANIFEST|CHECKSUM.md')"
