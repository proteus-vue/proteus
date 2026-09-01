#!/bin/bash
# 校验脚本：.md 非空 + zip 完整性（双通道兜底一致性检查）
set -e
cd "$(dirname "$0")"

echo "=== [1/3] 独立文件非空校验 ==="
fail=0
for f in *.md; do
  [[ -s "$f" ]] || { echo "❌ $f 为空"; fail=$((fail+1)); }
done
[[ $fail -eq 0 ]] && echo "  ✅ 全部 .md 非空"

echo ""
echo "=== [2/3] zip 完整性（unzip -t）==="
ZIP="/data/workspace/proteus-compiler-plugin.zip"
[[ -f "$ZIP" ]] || { echo "❌ zip 不存在：$ZIP"; exit 1; }
unzip -t "$ZIP"

echo ""
echo "=== [3/3] SHA256 ==="
sha256sum "$ZIP"
echo ""
echo "✅ 校验完成"
