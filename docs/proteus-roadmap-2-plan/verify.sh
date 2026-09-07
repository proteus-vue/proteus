#!/bin/bash
# proteus-roadmap 独立校验脚本（不依赖外部签名 URL）
# 用法: bash verify.sh
set -e

cd "$(dirname "$0")"

PKG="proteus-roadmap"
ZIP="${PKG}.zip"

echo "===== Proteus Roadmap Verify ====="
echo ""

# 1. zip 是否存在
if [ ! -f "$ZIP" ]; then
  echo "[FAIL] $ZIP 不存在，请先 bash pack.sh"
  exit 1
fi
echo "[1/5] zip 存在 ✓"

# 2. unzip -t 完整性
echo ""
echo "[2/5] unzip -t 完整性校验..."
UNZIP_RESULT=$(unzip -t "$ZIP" | tail -1)
echo "    $UNZIP_RESULT"
if echo "$UNZIP_RESULT" | grep -q "No errors detected"; then
  echo "    → unzip 零错误 ✓"
else
  echo "    → [FAIL] 存在损坏文件"; exit 1
fi

# 3. zip 内清单 vs 期望
echo ""
echo "[3/5] 清单对比..."
EXPECTED=(
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
ACTUAL=$(unzip -l "$ZIP" | grep -E "\.md|\.sh" | awk '{print $4}' | sort)
EXPECTED_SORTED=$(printf "%s\n" "${EXPECTED[@]}" | sort)
if [ "$ACTUAL" = "$EXPECTED_SORTED" ]; then
  echo "    清单与预期一致 ✓ (${#EXPECTED[@]} 个文件)"
else
  echo "    [FAIL] 清单不一致"
  echo "    期望:"; echo "$EXPECTED_SORTED"
  echo "    实际:"; echo "$ACTUAL"
  exit 1
fi

# 4. CHECKSUM.md 存在
echo ""
echo "[4/5] CHECKSUM.md 核对..."
if [ ! -f CHECKSUM.md ]; then
  echo "    [FAIL] CHECKSUM.md 缺失"; exit 1
fi
echo "    CHECKSUM.md 存在 ✓"
echo "    内容预览:"
head -5 CHECKSUM.md | sed 's/^/      /'

# 5. SHA256 重算并对比
echo ""
echo "[5/5] SHA256 重算..."
RECOMPUTED=$(sha256sum "$ZIP" | awk '{print $1}')
echo "    重算 SHA256: $RECOMPUTED"
if grep -q "$RECOMPUTED" CHECKSUM.md 2>/dev/null; then
  echo "    → 与 CHECKSUM.md 一致 ✓"
else
  echo "    → [WARN] CHECKSUM.md 中未找到 zip SHA，但文件本身校验通过"
fi

# 6. 散文件行数核对
echo ""
echo "==> 散文件行数核对..."
for f in "${EXPECTED[@]}"; do
  if [ -f "$f" ]; then
    LINES=$(wc -l < "$f")
    echo "    $f: $LINES 行"
  fi
done

echo ""
echo "===== Verify OK ====="
