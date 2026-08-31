#!/bin/bash
# Proteus CLI 打包脚本
set -euo pipefail
cd "$(dirname "$0")"
OUTPUT="proteus-cli"
rm -f "${OUTPUT}.zip"
zip -r "${OUTPUT}.zip" \
  README.md \
  01-cli.md \
  02-build-pipeline.md \
  03-strict-cli.md \
  architecture-update.md \
  CHECKSUM.md \
  pack.sh
echo "---"
unzip -t "${OUTPUT}.zip"
echo "---"
shasum -a 256 "${OUTPUT}.zip"
