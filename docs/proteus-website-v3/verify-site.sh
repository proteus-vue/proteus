#!/bin/bash
# 校验官网首页产物
set -e
cd "$(dirname "$0")"
f="index.html"
if [ ! -f "$f" ]; then echo "MISSING: $f"; exit 1; fi
lines=$(wc -l < "$f" | tr -d ' ')
bytes=$(wc -c < "$f" | tr -d ' ')
echo "index.html: ${lines} lines, ${bytes} bytes"
# 关键内容在位检查
for kw in "One semantic model" "sel-render" "sel-compiler" "sel-device" "sel-cap" \
          "UICollectionView" "GridView" "SkCanvas" "scanQR" "Proteus" "dogfooding"; do
  if grep -q "$kw" "$f"; then
    echo "  ✓ $kw"
  else
    echo "  ✗ MISSING: $kw"
    exit 1
  fi
done
echo "VERIFY: PASS"
