#!/usr/bin/env bash
# G-40 打包脚本
# 关键规则（吸取历史教训）：
#   1. 直接读 MANIFEST 白名单打包 —— 杜绝"磁盘有但 zip 缺"
#   2. MANIFEST 本身必须进包 —— 否则隔离目录无法双向比对
#   3. CHECKSUM.md 在其中 —— 否则步骤2 会报"多余文件"
#   4. store 模式 —— 避免压缩编码导致的下载损坏

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR" || exit 1

ZIP="proteus-execution-carrier.zip"
rm -f "$ZIP" CHECKSUM.md

# 1. 收集 MANIFEST 清单（过滤注释/空行，排除 CHECKSUM.md 自身）
FILES=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ "$f" = "CHECKSUM.md" ] && continue
  [ -f "$f" ] && FILES+=("$f")
done < <(grep -v '^[[:space:]]*#' MANIFEST | grep -v '^[[:space:]]*$' | sed 's/[[:space:]]*$//')

echo "== 打包 ${#FILES[@]} 个内容文件 =="
printf '  %s\n' "${FILES[@]}"

# 2. 生成 CHECKSUM.md（含内容文件 + MANIFEST 自身）
{
  echo "# G-40 SHA256 校验和"
  echo
  sha256sum "${FILES[@]}" MANIFEST
} > CHECKSUM.md
echo "== 生成 CHECKSUM.md（$(grep -c '^[0-9a-f]\{64\}' CHECKSUM.md) 条）=="

# 3. 打包：内容文件 + MANIFEST + CHECKSUM.md（store 模式）
zip -X -0 -q "$ZIP" "${FILES[@]}" MANIFEST CHECKSUM.md
RC=$?

if [ $RC -ne 0 ]; then
  echo "❌ zip 失败 (rc=$RC)"
  exit 1
fi

# 4. 自检
echo
echo "== unzip -t 完整性 =="
unzip -t "$ZIP" 2>&1 | tail -2

echo
N=$(unzip -l "$ZIP" | tail -n +4 | head -n -2 | wc -l | tr -d ' ')
echo "== zip 内文件清单（$N 条）=="
unzip -l "$ZIP" | tail -n +4 | head -n -2 | awk '{print "  "$4}'

echo
echo "== zip SHA256 =="
sha256sum "$ZIP"

echo
echo "== 运行 verify.sh 自检 =="
bash verify.sh 2>&1 | tail -5
