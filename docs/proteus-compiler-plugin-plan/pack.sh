#!/bin/bash
# Proteus Compiler Plugin (G-21) — 双通道交付打包脚本
set -e
cd "$(dirname "$0")"
DIR_NAME="proteus-compiler-plugin"
ZIP_PATH="/data/workspace/${DIR_NAME}.zip"
rm -f "$ZIP_PATH"

# 收集所有 .md（排除隐藏文件）
mapfile -t MDS < <(ls *.md)

echo "=== 待打包文件（${#MDS[@]} 个）==="
printf '%s\n' "${MDS[@]}"

# 校验所有 .md 非空
echo ""
echo "=== 非空校验 ==="
for f in "${MDS[@]}"; do
  if [[ ! -s "$f" ]]; then
    echo "❌ $f 为空或不存在"
    exit 1
  fi
  echo "  ✅ $f ($(wc -l < "$f") 行)"
done

# 打包（不含隐藏文件）
zip -r "$ZIP_PATH" . -x ".*" >/dev/null
echo ""
echo "=== zip 内容清单 ==="
unzip -l "$ZIP_PATH"

# 校验 zip 完整性
echo ""
echo "=== zip 完整性校验（unzip -t）==="
if ! unzip -t "$ZIP_PATH"; then
  echo "❌ zip 完整性校验失败"
  exit 1
fi

# SHA256
echo ""
SHA=$(sha256sum "$ZIP_PATH" | awk '{print $1}')
echo "SHA256: $SHA"
{
  echo "SHA256: $SHA"
  echo "Files:  ${#MDS[@]}"
  echo "---"
  ls -la "$ZIP_PATH"
} > CHECKSUM.md
echo "CHECKSUM.md 已生成"

echo ""
echo "=== ✅ 打包完成：$ZIP_PATH ==="
