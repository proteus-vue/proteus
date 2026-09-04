#!/usr/bin/env bash
# G-48 安全打包：引号安全（数组累积）+ 完整性断言（缺一即 fail）+ 防递归（白名单）
set -euo pipefail
cd "$(dirname "$0")"

NAME="proteus-miniprogram-runtime"
ZIP="${NAME}.zip"

# 白名单：只打包显式声明的文件（禁止通配符，防递归/防误打包 zip 自身）
PACK_LIST=()
PACK_LIST+=("MANIFEST")
PACK_LIST+=("README.md")
PACK_LIST+=("01-problem.md" "02-architecture.md" "03-spi.md" "04-standard-runtime.md")
PACK_LIST+=("05-adapter-pattern.md" "06-capability-bridge.md" "07-sandbox-isolation.md" "08-security.md")
PACK_LIST+=("conformance.md" "rules.md" "architecture-update.md")
PACK_LIST+=("reference-impl.cjs" "verify.sh" "pack.sh")

# 完整性断言：先确认每个文件存在
echo "== 完整性检查（${#PACK_LIST[@]} 项）=="
for f in "${PACK_LIST[@]}"; do
  if [ ! -f "$f" ]; then
    echo "FAIL: 缺失 $f —— 拒绝产出残缺包"
    rm -f "$ZIP"
    exit 1
  fi
done
echo "OK: 全部文件就绪"

# 防递归：若已有 zip（来自其他目录），先删除，避免打包自身
rm -f "$ZIP"

# 打包（store 模式，零压缩，便于 diff 校验；引号安全，不外展开数组）
zip -X -0 -q "$ZIP" "${PACK_LIST[@]}"

# 断言：清单中每个文件确实在包内（逐文件检查，不依赖扩展名计数）
for f in "${PACK_LIST[@]}"; do
  if ! unzip -l "$ZIP" | grep -q "[[:space:]]$f$"; then
    echo "FAIL: 包内缺失 $f —— 拒绝产出残缺包"
    rm -f "$ZIP"
    exit 1
  fi
done

# 防递归：确认包内不含嵌套 zip
# 用 awk 排除表头行（"Archive: xxx.zip" 本身以 .zip 结尾，会误报），
# 只检查真实文件条目 —— G-45/G-46 同类坑的修正版
if unzip -l "$ZIP" | awk 'NR>3 && /\.zip$/{found=1} END{exit !found}'; then
  echo "FAIL: 包内存在嵌套 zip（递归！）"
  rm -f "$ZIP"
  exit 1
fi
echo "OK: 无嵌套 zip（防递归通过）"

# 生成 SHA256 + 大小
shasum -a 256 "$ZIP" > CHECKSUM
SIZE=$(stat -c%s "$ZIP" 2>/dev/null || stat -f%z "$ZIP")
echo "== 打包完成 =="
echo "  文件: $ZIP"
echo "  大小: $SIZE bytes"
echo "  文件数: ${#PACK_LIST[@]}"
cat CHECKSUM
