#!/usr/bin/env bash
# G-47 pack.sh — 安全打包（沿用 G-45/G-46 修复后的模板）
# 防递归 + 完整性断言 + 引号安全（数组累积）
set -u
cd "$(dirname "$0")"

ZIP_NAME="proteus-combined-conformance.zip"
rm -f "$ZIP_NAME"

# ★ 用数组累积，不外展开（引号安全）
PACK_LIST=()
PACK_LIST+=("MANIFEST")
PACK_LIST+=("01-problem.md" "02-architecture.md" "03-spi.md" "04-security.md")
PACK_LIST+=("conformance.md" "rules.md" "architecture-update.md")
PACK_LIST+=("reference-impl.cjs" "verify.sh" "pack.sh" "README.md")

# ★ 完整性断言：逐一确认存在后再打包
MISSING=0
for f in "${PACK_LIST[@]}"; do
  [[ -f "$f" ]] || { echo "MISSING: $f" >&2; MISSING=$((MISSING+1)); }
done
[[ $MISSING -gt 0 ]] && { echo "ABORT: $MISSING 文件缺失，不产出残缺包" >&2; exit 1; }

# store 模式（可 diff），显式白名单（禁止通配符 = 防递归）
zip -X -0 -q "$ZIP_NAME" "${PACK_LIST[@]}"

# ★ 防递归：断言包内无嵌套 zip（排除表头行 Archive:）
if unzip -l "$ZIP_NAME" | awk 'NR>3 && /\.zip$/' | grep -q .; then
  echo "ABORT: 包内存在递归 zip" >&2
  rm -f "$ZIP_NAME"
  exit 1
fi

# ★ 校验完整性：逐文件断言 PACK_LIST 全部在 zip 内（不依赖扩展名计数）
ZIP_LIST=$(unzip -l "$ZIP_NAME" | awk 'NR>3 && $4!="" {print $4}')
MISSING_F=0
for f in "${PACK_LIST[@]}"; do
  if ! printf '%s\n' "$ZIP_LIST" | grep -qx "$f"; then
    echo "MISSING IN ZIP: $f" >&2
    MISSING_F=$((MISSING_F+1))
  fi
done
EXPECTED=${#PACK_LIST[@]}
echo "packed: $ZIP_NAME (store mode, ${EXPECTED} entries)"
[[ "$MISSING_F" -eq 0 ]] || { echo "ABORT: $MISSING_F 文件未打入 zip" >&2; rm -f "$ZIP_NAME"; exit 1; }

# SHA256
if command -v shasum >/dev/null; then
  shasum -a 256 "$ZIP_NAME" > CHECKSUM.md
elif command -v sha256sum >/dev/null; then
  sha256sum "$ZIP_NAME" > CHECKSUM.md
fi
echo "CHECKSUM written"
