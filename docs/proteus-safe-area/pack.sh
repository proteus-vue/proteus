#!/bin/bash
# Proteus 安全区与灵动岛方案 打包脚本
set -e

cd "$(dirname "$0")"
rm -f proteus-safe-area.zip CHECKSUM.md

# 计算 SHA256
sha256sum *.md > CHECKSUM.md 2>/dev/null || shasum -a 256 *.md > CHECKSUM.md

zip -r proteus-safe-area.zip \
  README.md \
  01-safe-area-island.md \
  02-ios-dynamic-island.md \
  03-android-harmony-insets.md \
  04-web-skyline-env.md \
  05-compiler-integration.md \
  06-glass-integration.md \
  07-api-design.md \
  08-strict-css-rules.md \
  09-benchmark-budgets.md \
  10-batches.md \
  CHECKSUM.md \
  pack.sh

echo "=== 校验 ==="
unzip -t proteus-safe-area.zip
echo "=== SHA256 ==="
sha256sum proteus-safe-area.zip
echo "=== 文件清单 ==="
unzip -l proteus-safe-area.zip
