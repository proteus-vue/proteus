#!/bin/bash
# Proteus Router 打包脚本（双通道交付，含 SHA256 校验）
set -euo pipefail
cd "$(dirname "$0")"

OUTPUT="proteus-router"
rm -f "${OUTPUT}.zip"

# 打包（含 CHECKSUM.md）
zip -r "${OUTPUT}.zip" \
  README.md \
  01-router.md \
  02-navigation-mapping.md \
  03-transition-transactions.md \
  04-deep-link.md \
  05-strict-router.md \
  06-benchmark-budgets.md \
  07-batches.md \
  architecture-update.md \
  CHECKSUM.md \
  pack.sh

echo "---"
unzip -t "${OUTPUT}.zip"
echo "---"
shasum -a 256 "${OUTPUT}.zip"
