#!/usr/bin/env bash
# G-44 打包脚本（store 模式，MANIFEST + CHECKSUM 本身进包）
#
# 安全性修复：
#   1. 所有变量展开加引号，避免 $CONTENT 按空格拆参导致只打包部分文件
#   2. 显式白名单（MANIFEST 为准），禁止用通配符（避免把 .zip 自身打进去）
#   3. 打包后立刻断言核心交付物全部在包内，缺一即 fail
set -euo pipefail
cd "$(dirname "$0")" || exit 1

ZIP_NAME="proteus-testing-framework.zip"
rm -f "$ZIP_NAME" CHECKSUM.md

# 0. 必须先存在 MANIFEST
if [ ! -f MANIFEST ]; then
  echo "✗ MANIFEST 不存在，无法打包" >&2
  exit 1
fi

# 1. 生成 CHECKSUM.md（严格按 MANIFEST 顺序，跳过注释与空行）
: > CHECKSUM.md
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in \#*) continue;; esac
  if [ -f "$f" ]; then
    sha256sum "$f" >> CHECKSUM.md
  else
    echo "✗ MANIFEST 中缺失文件: $f" >&2
    exit 1
  fi
done < MANIFEST

# 2. 组装打包文件列表（引号安全，逐行读取，绝不展开为单词）
PACK_LIST=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in \#*) continue;; esac
  PACK_LIST+=("$f")
done < MANIFEST
# CHECKSUM.md 与 MANIFEST 自身也要进包（放在末尾）
PACK_LIST+=("CHECKSUM.md")

# 3. 打包（store 模式 -0，保留时间戳 -X）
#    注意：必须在干净目录执行，ZIP_NAME 已先删除，不会递归打进自身
zip -X -0 -q "$ZIP_NAME" "${PACK_LIST[@]}"

# 4. ★ 完整性断言：核心交付物必须全部在包内
CORE_REQUIRED=(
  "G-44-testing-framework.md"
  "test-ir.md"
  "test-backend-spi.md"
  "breakpoint-3d-testing.md"
  "testing-reference.js"
  "verify.sh"
  "MANIFEST"
  "CHECKSUM.md"
)
ZIP_ENTRIES=$(unzip -l "$ZIP_NAME" | awk '{print $4}')
for req in "${CORE_REQUIRED[@]}"; do
  if ! echo "$ZIP_ENTRIES" | grep -qx "$req"; then
    echo "✗ 打包失败：核心交付物 [$req] 未进入 $ZIP_NAME" >&2
    echo "  当前包内条目：" >&2
    echo "$ZIP_ENTRIES" >&2
    rm -f "$ZIP_NAME"
    exit 1
  fi
done

# 5. 校验：不得把 .zip 自身打进去（递归打包检查）
if echo "$ZIP_ENTRIES" | grep -qx "$ZIP_NAME"; then
  echo "✗ 检测到递归打包（$ZIP_NAME 被包含自身），中止" >&2
  rm -f "$ZIP_NAME"
  exit 1
fi

echo "已生成: $ZIP_NAME"
unzip -t "$ZIP_NAME" | tail -2
echo "文件数: $(echo "$ZIP_ENTRIES" | grep -cv '^$\|^Archive\|^Length\|^-----\|^Total')"
echo "SHA256: $(sha256sum "$ZIP_NAME" | awk '{print $1}')"
