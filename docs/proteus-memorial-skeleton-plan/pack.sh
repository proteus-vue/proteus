#!/bin/bash
# pack.sh —— 打包纪念日置灰 & 骨架屏方案（含 SHA256 校验，可秒级重建）
set -euo pipefail

cd "$(dirname "$0")"
DIR="proteus-memorial-skeleton"
OUT="${DIR}.zip"

# 清理旧产物
rm -f "${OUT}" CHECKSUM.md

# 完整性检查：所有 .md / .sh 必须非空
echo "=== 非空检查 ==="
violation=0
while IFS= read -r -d '' f; do
  sz=$(wc -c < "$f")
  if [ "$sz" -lt 50 ]; then
    echo "  ❌ 空/过小文件: $f (${sz}B)"
    violation=1
  fi
done < <(find . -maxdepth 1 \( -name "*.md" -o -name "*.sh" \) -print0)
[ "$violation" -eq 0 ] && echo "  ✅ 所有文件非空"

# 打包（显式文件列表）
echo ""
echo "=== 打包 ==="
zip -q "${OUT}" \
  README.md \
  architecture-update.md \
  01-memorial-gray.md \
  02-skeleton-auto.md \
  03-api-design.md \
  04-compiler-integration.md \
  05-synergy.md \
  06-five-end-mapping.md \
  07-strict-rules.md \
  08-benchmark-budgets.md \
  09-migration-anti.md \
  10-batches.md \
  pack.sh

# 校验
echo ""
echo "=== 校验 ==="
unzip -t "${OUT}" | tail -3

echo ""
echo "=== SHA256（sha256sum -c 兼容）==="
sha256sum *.md > CHECKSUM.md 2>/dev/null || shasum -a 256 *.md > CHECKSUM.md
cat CHECKSUM.md

echo ""
echo "=== 完成: ${OUT} ==="
