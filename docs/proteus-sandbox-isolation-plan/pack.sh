#!/usr/bin/env bash
# G-49 pack.sh —— 安全打包（沿用 G-46/G-47/G-48 修复后的写法）
set -u
cd "$(dirname "$0")"
ZIP="proteus-sandbox-isolation.zip"
rm -f "$ZIP"

# 白名单（防递归：仅打包清单内文件，禁止通配符）
PACK_LIST=(
  01-problem.md
  03-spi.md
  conformance.md
  reference-impl.cjs
  verify.sh
  rules.md
  architecture-update.md
  README.md
  MANIFEST
  pack.sh
)

# 逐文件断言（不用脆弱的扩展名计数）
for f in "${PACK_LIST[@]}"; do
  if [ ! -f "$f" ]; then
    echo "FAIL: 缺少 $f —— 中止打包（防残缺包）"
    rm -f "$ZIP"
    exit 1
  fi
done

# 打包（store 模式，便于 diff）
zip -X -n .cjs "$ZIP" "${PACK_LIST[@]}"

# 防递归：检测包内是否含嵌套 zip（排除表头行 Archive: ...）
# awk 逻辑：匹配到嵌套 zip → exit 1（失败）；全无匹配 → exit 0（通过）
if unzip -l "$ZIP" | awk 'NR>3 && /\.zip$/{found=1} END{if(found) exit 1; exit 0}'; then
  echo "OK: 无嵌套 zip（防递归通过）"
else
  echo "FAIL: 包内检测到嵌套 zip —— 中止（防递归）"
  rm -f "$ZIP"
  exit 1
fi

# 完整性断言：清单内每个文件确实在包中
for f in "${PACK_LIST[@]}"; do
  if ! unzip -l "$ZIP" | awk -v f="$f" 'NR>3 && index($0, f){found=1} END{exit !found}'; then
    echo "FAIL: $f 未进入包 —— 中止（完整性断言）"
    rm -f "$ZIP"
    exit 1
  fi
done

echo
echo "== 打包完成 =="
unzip -t "$ZIP"
echo
echo "SHA256: $(sha256sum "$ZIP" | awk '{print $1}')"
