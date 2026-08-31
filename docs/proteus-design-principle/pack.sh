#!/bin/bash
# 打包 + 完整性校验（对齐其他 plan 的双通道交付模式）
set -euo pipefail

cd "$(dirname "$0")"
OUT="proteus-design-principle"
rm -f "${OUT}.zip" CHECKSUMS.md5

zip -q "${OUT}.zip" \
  README.md \
  architecture-principle.md \
  app-renderer-layout.md \
  component-layout-semantics.md \
  config-update.md \
  pack.sh

echo "=== 校验 ==="
unzip -t "${OUT}.zip" | tail -2

echo "=== 文件清单（md5）==="
md5sum *.md > CHECKSUMS.md5 2>/dev/null || md5 -r *.md > CHECKSUMS.md5
cat CHECKSUMS.md5

echo "=== 非空检查 ==="
find . -maxdepth 1 -name "*.md" -size 0 -print | grep -q . && { echo "ERROR: 存在空文件"; exit 1; } || echo "OK: 无空文件"

echo ""
echo "=== 完成: ${OUT}.zip ==="
