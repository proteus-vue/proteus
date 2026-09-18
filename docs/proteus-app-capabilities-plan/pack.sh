#!/bin/bash
# pack.sh —— 打包应用级能力方案（主题/字体/缓存，含 SHA256 校验）
set -euo pipefail

cd "$(dirname "$0")"
DIR="proteus-app-capabilities"
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
  01-app-capabilities.md \
  02-theme-five-end.md \
  03-font-scale-five-end.md \
  04-cache-layers.md \
  05-api-design.md \
  06-compiler-integration.md \
  07-benchmark-comparison.md \
  08-migration-anti.md \
  09-strict-rules.md \
  10-benchmark-budgets.md \
  11-batches.md \
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
