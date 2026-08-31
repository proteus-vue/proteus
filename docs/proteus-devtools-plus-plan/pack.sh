#!/bin/bash
# Proteus HMR & DevTools 打包脚本
set -euo pipefail
cd "$(dirname "$0")"
OUTPUT="proteus-devtools"
rm -f "${OUTPUT}.zip"
zip -r "${OUTPUT}.zip" \
  README.md \
  01-hmr-devtools.md \
  02-hmr-runtime.md \
  03-devtools-protocol.md \
  04-batches.md \
  architecture-update.md \
  CHECKSUM.md \
  pack.sh
echo "---"
unzip -t "${OUTPUT}.zip"
echo "---"
shasum -a 256 "${OUTPUT}.zip"
