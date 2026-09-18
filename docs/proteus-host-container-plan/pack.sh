#!/usr/bin/env bash
# G-42 打包脚本
# 关键修复：
#   1. 严格按 MANIFEST 白名单打包，遗漏一目了然
#   2. MANIFEST 与 CHECKSUM.md 本身进包（根治"解压缺文件"）
#   3. store 模式（不压缩）——规避编码/CRC/deflate 导致的下载损坏

set -eu
cd "$(dirname "$0")" || exit 1

ZIP_NAME="proteus-host-container.zip"
rm -f "$ZIP_NAME" CHECKSUM.md

# 1. 生成 CHECKSUM.md（排除自身）
: > CHECKSUM.md
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in \#*) continue;; esac
  [ "$f" = "CHECKSUM.md" ] && continue
  if [ ! -f "$f" ]; then
    echo "✗ MANIFEST 列了但文件不存在: $f" >&2
    exit 1
  fi
  sha256sum "$f" >> CHECKSUM.md
done < MANIFEST

echo "CHECKSUM.md 已生成 ($(wc -l < CHECKSUM.md | tr -d ' ') 项)"

# 2. 按白名单打包（含 MANIFEST 与 CHECKSUM.md 自身）
zip -X -0 "$ZIP_NAME" $(cat MANIFEST) > /dev/null

echo "打包完成: $ZIP_NAME"
ls -l "$ZIP_NAME" | awk '{print "  大小:", $5, "bytes"}'

# 3. 完整性检查
echo ""
echo "unzip -t:"
unzip -t "$ZIP_NAME" 2>&1 | tail -2

echo ""
echo "zip 内文件清单:"
unzip -l "$ZIP_NAME" | tail -n +4 | head -n -2 | awk '{print "  " $4}'
