#!/bin/bash
# proteus-roadmap 打包脚本（双通道交付：zip + 散文件）
# 用法: bash pack.sh
set -e

cd "$(dirname "$0")"

PKG="proteus-roadmap"
ZIP="${PKG}.zip"
TARGETS=(
  "01-master-roadmap.md"
  "02-dependency-graph.md"
  "03-milestones.md"
  "04-critical-path.md"
  "05-risk-horizon.md"
  "01-website-skeleton.md"
  "README.md"
  "pack.sh"
  "verify.sh"
)

# 清理旧产物
rm -f "$ZIP" CHECKSUM.md

# 校验所有目标文件存在且非空
echo "==> 校验目标文件..."
for f in "${TARGETS[@]}"; do
  if [ ! -s "$f" ]; then
    echo "ERROR: $f 缺失或为空"; exit 1
  fi
done
echo "    所有目标文件存在且非空 ✓"

# 打包：store 模式(-0) + 去额外属性(-X)，最大跨平台兼容
echo "==> 打包 (store 模式)..."
zip -X -0 "$ZIP" "${TARGETS[@]}"

# 校验完整性
echo "==> unzip -t 完整性校验..."
UNZIP_RESULT=$(unzip -t "$ZIP" | tail -1)
echo "    $UNZIP_RESULT"

# 计算 SHA256（排除 zip 自身与 CHECKSUM，避免循环嵌套）
echo "==> 计算 SHA256..."
find . -maxdepth 1 -type f \( -name "*.md" -o -name "*.sh" \) -print0 \
  | sort -z \
  | xargs -0 sha256sum \
  | grep -v "${ZIP}" \
  | grep -v "CHECKSUM.md" \
  > CHECKSUM.md

SHA=$(sha256sum "$ZIP" | awk '{print $1}')
echo "    SHA256: $SHA"

# 更新 README 校验区
sed -i "s/^> 校验（生成时填写）/> 校验（自动生成）/" README.md 2>/dev/null || true
{
  echo ""
  echo "---"
  echo ""
  echo "## 校验（自动生成）"
  echo ""
  echo "- SHA256: \`${SHA}\`"
  echo "- \`unzip -t\`: ${UNZIP_RESULT}"
  echo "- 文件数: ${#TARGETS[@]}"
  echo "- 生成时间: $(date '+%Y-%m-%d %H:%M:%S')"
} >> README.md

echo ""
echo "==> 完成: $ZIP (SHA256: $SHA)"

# 自动跑一遍 verify
bash verify.sh
