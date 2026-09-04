#!/usr/bin/env bash
# G-46 安全打包：数组累积（不外展开）+ 完整性断言 + 防递归 + 排除表头
set -u
cd "$(dirname "$0")"

ZIP_NAME="proteus-resource-pool.zip"
CORE=("01-problem.md" "02-architecture.md" "03-spi.md" "04-cross-page-ownership.md" "05-security.md" "reference-impl.cjs" "verify.sh" "rules.md" "conformance.md" "README.md" "MANIFEST" "CHECKSUM.md" "pack.sh" "architecture-update.md")

# 防递归：打包前删除可能残留的旧 zip
rm -f "$ZIP_NAME"

# 引号安全：用数组累积，绝不在命令中外展开 $CORE
PACK_LIST=("${CORE[@]}")

echo "==> 打包 $ZIP_NAME （store 模式，可 diff）"
zip -X -0 -q "$ZIP_NAME" "${PACK_LIST[@]}"
RC=$?
[ $RC -ne 0 ] && { echo "✗ zip 失败 (rc=$RC)"; exit 1; }

# 完整性断言：逐文件检查是否在包内
echo "==> 完整性断言"
missing=0
for f in "${CORE[@]}"; do
  if ! unzip -l "$ZIP_NAME" | grep -q "$f"; then
    echo "  ✗ 缺失: $f"
    missing=$((missing+1))
  fi
done

# 防递归断言：包内不得含 .zip（排除 unzip 表头 Archive: 行）
ZIP_INSIDE=$(unzip -l "$ZIP_NAME" | awk 'NR>3 && /\.zip$/ {print $NF}' | wc -l)
[ "$ZIP_INSIDE" -gt 0 ] && { echo "  ✗ 递归：$ZIP_INSIDE 个 zip 被打入"; missing=$((missing+1)); }

if [ $missing -gt 0 ]; then
  echo "✗ 完整性失败，${missing} 项缺失/异常 — 删除残缺包"
  rm -f "$ZIP_NAME"
  exit 1
fi

# 生成 CHECKSUM（不含 zip 自身）
sha256sum "${CORE[@]}" 2>/dev/null | sha256sum | awk '{print $1}' > CHECKSUM.md
echo "✓ 完整性断言通过（${#CORE[@]} 项）"
ls -la "$ZIP_NAME"
