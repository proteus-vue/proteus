#!/usr/bin/env bash
# G-41 打包脚本：严格按 MANIFEST 白名单打包（MANIFEST 本身进包）
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

ZIP_NAME="proteus-host-integration.zip"
[ -f MANIFEST ] || { echo "FATAL: MANIFEST not found"; exit 1; }

# 1) 生成 CHECKSUM.md（先于打包，内容不含 zip 自身）
: > CHECKSUM.md
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in \#*) continue;; esac
  [ "$f" = "CHECKSUM.md" ] && continue
  [ -f "$f" ] || { echo "FATAL: MANIFEST lists missing file: $f"; exit 1; }
  sha256sum "$f" >> CHECKSUM.md
done < MANIFEST

# 2) 打包：MANIFEST + 全部白名单文件（store 模式，零压缩兼容问题）
CONTENT=$(grep -v '^#' MANIFEST | grep -v '^[[:space:]]*$')
rm -f "$ZIP_NAME"
# shellcheck disable=SC2086
zip -X -0 -q "$ZIP_NAME" MANIFEST $CONTENT

# 3) 自检
unzip -t "$ZIP_NAME" >/dev/null 2>&1 && echo "unzip -t: OK" || { echo "unzip -t: FAILED"; exit 1; }
echo "packed: $ZIP_NAME ($(unzip -l "$ZIP_NAME" | tail -1 | awk '{print $2}') files)"
sha256sum "$ZIP_NAME"
