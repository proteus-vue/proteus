#!/usr/bin/env bash
# G-43 打包脚本（store 模式，MANIFEST + CHECKSUM 本身进包）
set -u
cd "$(dirname "$0")" || exit 1

ZIP_NAME="proteus-ownership.zip"
rm -f "$ZIP_NAME" CHECKSUM.md

# 1. 生成 CHECKSUM.md（依 MANIFEST 顺序）
: > CHECKSUM.md
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in \#*) continue;; esac
  if [ -f "$f" ]; then
    sha256sum "$f" | awk -v p="$f" '{print $1"  "p}' >> CHECKSUM.md
  else
    echo "警告：MANIFEST 中缺失 $f" >&2
  fi
done < MANIFEST
echo "$(basename "$0")" >> /dev/null
sha256sum verify.sh   | awk '{print $1"  verify.sh"}'   >> CHECKSUM.md
sha256sum run-all-verify.sh | awk '{print $1"  run-all-verify.sh"}' >> CHECKSUM.md
sha256sum pack.sh     | awk '{print $1"  pack.sh"}'     >> CHECKSUM.md

# 2. 打包：MANIFEST + 内容 + CHECKSUM + 脚本（全进包）
CONTENT=$(grep -v '^#' MANIFEST | grep -v '^$')
# shellcheck disable=SC2086
zip -X -0 -q "$ZIP_NAME" MANIFEST $CONTENT CHECKSUM.md verify.sh run-all-verify.sh pack.sh

echo "已生成: $ZIP_NAME"
unzip -t "$ZIP_NAME" | tail -2
echo "SHA256: $(sha256sum "$ZIP_NAME" | awk '{print $1}')"
