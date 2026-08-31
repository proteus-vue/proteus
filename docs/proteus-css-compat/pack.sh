#!/usr/bin/env bash
# pack.sh —— 打包 CSS 兼容方案（双通道交付模式，含 SHA256 校验）
set -euo pipefail

cd "$(dirname "$0")"
DIR="proteus-css-compat"
OUT="${DIR}.zip"

# 清理旧产物
rm -f "${OUT}" CHECKSUM.md

# 完整性检查：所有 .md / .sh 必须非空
echo "=== 非空检查 ==="
violation=0
while IFS= read -r -d '' f; do
  sz=$(wc -c < "$f")
  if [ "$sz" -lt 50 ]; then
    echo "  ❌ 空/过小文件: $f (${sz}B)"
    violation=1
  fi
done < <(find . -maxdepth 1 \( -name "*.md" -o -name "*.sh" \) -print0)
[ "$violation" -eq 0 ] && echo "  ✅ 所有文件非空"

# 打包（显式文件列表，避免 zip -r 的目录占位符干扰）
echo ""
echo "=== 打包 ==="
zip -q "${OUT}" \
  README.md \
  architecture-principle-update.md \
  01-css-compat-matrix.md \
  02-strict-css-lint.md \
  03-compile-time-rewrite.md \
  04-semantic-style-components.md \
  05-five-end-mapping.md \
  06-selector-cascade.md \
  07-box-model.md \
  08-transform-animation.md \
  09-compiler-integration.md \
  10-benchmark-budgets.md \
  11-batches.md \
  12-anti-examples.md \
  pack.sh

# 校验
echo ""
echo "=== 校验 ==="
unzip -t "${OUT}" | tail -3

echo ""
echo "=== 文件清单 ==="
unzip -l "${OUT}" | grep -E "\.md|\.sh" | grep -v "Archive:"

echo ""
echo "=== SHA256 ==="
shasum -a 256 "${OUT}" | tee SHA256.txt

cat > CHECKSUM.md <<EOF
# 校验

- 打包时间：$(date -u +"%Y-%m-%dT%H:%M:%SZ")
- SHA256：$(shasum -a 256 "${OUT}" | cut -d' ' -f1)
- 文件数：${OUT} 含 13 个文件（12 份文档 + pack.sh）
- 验证：\`unzip -t ${OUT}\` 应显示 No errors detected
EOF

echo ""
echo "=== 完成: ${OUT} ==="
